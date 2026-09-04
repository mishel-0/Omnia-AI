"""Omnia AI — the fabricated-grading test hook, and the guards around it.

`OMNIA_TEST_FAKE_GRADING=1` makes `grading_model.predict()` return a fixed
grade without touching the model. The integration suite needs it: a real
whole-slide image is not something a test fixture can synthesise cheaply,
and the suite's dummy upload bytes are correctly rejected by real OpenSlide
I/O.

Two things were wrong with how it was honoured before.

It worked in the packaged clinical build. The flag is an environment
variable, so anything that set it — a misconfigured launcher, an inherited
shell environment, a deliberate act — turned a pathology workstation into
one that answers "grade group 3, 87% confident" for every slide.

And it was invisible. Nothing reported it: not /health, not the preflight
check, not the interface, not the audit trail. A fabricated grade flowed
into a signed PDF report indistinguishable from a real one.

So: refuse it in a frozen build outright, and everywhere else make it
impossible to miss. `active()` is what callers branch on; `warning()` is
what /health and preflight surface so the state is visible before anyone
reads a grade produced under it.
"""
import logging
import os
import sys

logger = logging.getLogger("omnia-pathology")

_ENV = "OMNIA_TEST_FAKE_GRADING"

# PyInstaller sets sys.frozen on the bundled backend, which is the only build
# a clinical site ever runs. A test hook has no reason to exist there, and
# the environment of a desktop launch is not something this process controls.
IS_FROZEN_BUILD = getattr(sys, "frozen", False)

_warned = False


def active() -> bool:
    """True when grading should return a fabricated result.

    Always False in a packaged build, whatever the environment says.
    """
    global _warned
    if os.environ.get(_ENV) != "1":
        return False

    if IS_FROZEN_BUILD:
        if not _warned:
            _warned = True
            logger.error(
                "%s is set but this is a packaged build — ignoring it. Grading will "
                "use the real model. This flag is for the test suite only and must "
                "never be set on a clinical installation.", _ENV,
            )
        return False

    if not _warned:
        _warned = True
        logger.warning(
            "%s=1 — grading is FABRICATED. Every slide will return a fixed grade "
            "without running the model. No result produced now is clinically "
            "meaningful.", _ENV,
        )
    return True


def warning() -> str | None:
    """A message for /health and preflight, or None when grading is real."""
    if not active():
        return None
    return (
        "Grading is running in test mode: results are fabricated, not produced "
        "by the model, and are not clinically meaningful."
    )
