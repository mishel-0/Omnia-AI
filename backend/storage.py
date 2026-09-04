"""Omnia AI — Safe JSON storage primitives.

Clinical trial data must survive crashes and power loss. Plain `write_text()`
truncates the target file before writing, so an interruption mid-write leaves a
corrupted (or empty) store and destroys every record in it.

These helpers:
  * write atomically (temp file in the same directory, fsync the file and the
    directory, then os.replace)
  * quarantine a corrupted file instead of crashing every subsequent request
  * serialise writes through a process-wide lock

The boundary this module depends on
-----------------------------------
The lock is a threading lock, so it only orders writers *inside one process*.
Every guarantee here holds because the backend runs as a single uvicorn
worker, which is how the desktop app launches it. Running `uvicorn --workers N`
would not fail loudly — it would simply void atomicity, and concurrent writers
in different processes would resume silently discarding each other's records.
If this ever needs to scale past one process, the answer is file locking
(fcntl.flock) or a real database, not a bigger threading lock.
"""
import json
import os
import tempfile
import threading
import datetime
import logging
from contextlib import contextmanager
from pathlib import Path

logger = logging.getLogger("omnia-pathology")

_LOCK = threading.RLock()


@contextmanager
def transaction():
    """Hold the store lock across a whole read-modify-write sequence.

    Individually-locked reads and writes are not enough: two requests can each
    read the same list, append their own record, and write back — silently
    discarding one of them. Route handlers run in a threadpool, so this is a
    real concurrency path, not a theoretical one.
    """
    with _LOCK:
        yield

# Filenames that may contain a path separator or traversal segments are rejected
# outright rather than silently rewritten, so a mismatch is visible to the user.
_UNSAFE_NAME_PARTS = ("..", "/", "\\", "\0")


def read_json(path: Path, default):
    """Read JSON, recovering gracefully if the file is missing or corrupted."""
    with _LOCK:
        if not path.exists():
            return default
        try:
            text = path.read_text()
            if not text.strip():
                return default
            return json.loads(text)
        except (json.JSONDecodeError, UnicodeDecodeError) as e:
            quarantine = path.with_suffix(
                path.suffix + f".corrupt-{datetime.datetime.now().strftime('%Y%m%d%H%M%S')}"
            )
            try:
                # Move, not copy. Copying left the unreadable original in
                # place, so the next read quarantined it again under a new
                # timestamp — and the dashboard polls. A corrupt patients.json
                # therefore produced a fresh full copy roughly every second,
                # indefinitely, until the disk filled: the recovery mechanism
                # became a worse outage than the corruption. Moving it means
                # this branch is taken exactly once.
                os.replace(path, quarantine)
            except OSError:
                quarantine = None
            logger.error(
                "Corrupted data file %s (%s). Quarantined to %s; starting from empty store.",
                path, e, quarantine,
            )
            return default


def write_json(path: Path, data):
    """Atomically write JSON so a crash can never leave a partial file."""
    with _LOCK:
        path.parent.mkdir(parents=True, exist_ok=True)
        fd, tmp = tempfile.mkstemp(dir=str(path.parent), prefix=path.name, suffix=".tmp")
        try:
            with os.fdopen(fd, "w") as f:
                json.dump(data, f, indent=2, default=str)
                f.flush()
                os.fsync(f.fileno())
            os.replace(tmp, path)
            # Syncing the file's contents makes the data durable; syncing the
            # directory is what makes the *rename* durable. Without it a power
            # cut can lose the replace even though the bytes were written —
            # which is precisely the failure this module claims to survive.
            try:
                dir_fd = os.open(str(path.parent), os.O_RDONLY)
                try:
                    os.fsync(dir_fd)
                finally:
                    os.close(dir_fd)
            except (OSError, AttributeError):
                pass  # not supported on this platform (notably Windows)
        except BaseException:
            try:
                os.unlink(tmp)
            except OSError:
                pass
            raise


def safe_filename(filename: str) -> str:
    """Return the bare filename, or raise ValueError if it looks like a traversal attempt."""
    name = (filename or "").strip()
    if not name:
        raise ValueError("Filename is required")
    for part in _UNSAFE_NAME_PARTS:
        if part in name:
            raise ValueError("Filename must not contain path separators")
    if name in (".", ".."):
        raise ValueError("Invalid filename")
    return name
