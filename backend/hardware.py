"""Omnia AI — Hardware detection and training capability profiling.

This is real detection, not a mock: it inspects the actual machine so the
training screen can tell a clinician whether their laptop or workstation can
realistically fine-tune the grading model, and with what settings.

Uses only the standard library plus platform-native shell tools, so it adds no
dependency to the packaged app.
"""
import os
import platform
import re
import shutil
import subprocess
import multiprocessing


def _run(cmd) -> str:
    try:
        return subprocess.run(
            cmd, capture_output=True, text=True, timeout=4, check=False
        ).stdout.strip()
    except Exception:
        return ""


def _macos_info() -> dict:
    brand = _run(["sysctl", "-n", "machdep.cpu.brand_string"]) or platform.processor()
    mem = _run(["sysctl", "-n", "hw.memsize"])
    perf = _run(["sysctl", "-n", "hw.perflevel0.physicalcpu"])
    gpu_raw = _run(["system_profiler", "SPDisplaysDataType"])

    gpu_name, gpu_cores = "", None
    m = re.search(r"Chipset Model:\s*(.+)", gpu_raw)
    if m:
        gpu_name = m.group(1).strip()
    c = re.search(r"Total Number of Cores:\s*(\d+)", gpu_raw)
    if c:
        gpu_cores = int(c.group(1))

    apple_silicon = platform.machine() == "arm64"
    return {
        "cpu_name": brand,
        "ram_bytes": int(mem) if mem.isdigit() else None,
        "performance_cores": int(perf) if perf.isdigit() else None,
        "gpu_name": gpu_name or ("Apple integrated GPU" if apple_silicon else ""),
        "gpu_cores": gpu_cores,
        # Apple Silicon exposes GPU training through Metal (MPS) in PyTorch.
        "accelerator": "Apple Metal (MPS)" if apple_silicon else "",
    }


def _linux_info() -> dict:
    cpu_name = ""
    try:
        with open("/proc/cpuinfo") as f:
            for line in f:
                if line.lower().startswith("model name"):
                    cpu_name = line.split(":", 1)[1].strip()
                    break
    except OSError:
        pass

    ram = None
    try:
        with open("/proc/meminfo") as f:
            for line in f:
                if line.startswith("MemTotal"):
                    ram = int(re.sub(r"\D", "", line)) * 1024
                    break
    except OSError:
        pass

    gpu_name = _run(["nvidia-smi", "--query-gpu=name", "--format=csv,noheader"])
    return {
        "cpu_name": cpu_name or platform.processor(),
        "ram_bytes": ram,
        "performance_cores": None,
        "gpu_name": gpu_name.splitlines()[0] if gpu_name else "",
        "gpu_cores": None,
        "accelerator": "NVIDIA CUDA" if gpu_name else "",
    }


def _windows_info() -> dict:
    ram = _run(["wmic", "computersystem", "get", "TotalPhysicalMemory"])
    digits = re.findall(r"\d+", ram)
    gpu = _run(["wmic", "path", "win32_VideoController", "get", "name"])
    gpu_lines = [l.strip() for l in gpu.splitlines()[1:] if l.strip()]
    name = gpu_lines[0] if gpu_lines else ""
    return {
        "cpu_name": platform.processor(),
        "ram_bytes": int(digits[0]) if digits else None,
        "performance_cores": None,
        "gpu_name": name,
        "gpu_cores": None,
        "accelerator": "NVIDIA CUDA" if "nvidia" in name.lower() else "",
    }


def detect_hardware() -> dict:
    system = platform.system()
    if system == "Darwin":
        info = _macos_info()
    elif system == "Linux":
        info = _linux_info()
    elif system == "Windows":
        info = _windows_info()
    else:
        info = {"cpu_name": platform.processor(), "ram_bytes": None,
                "performance_cores": None, "gpu_name": "", "gpu_cores": None,
                "accelerator": ""}

    logical = multiprocessing.cpu_count()
    try:
        free_bytes = shutil.disk_usage(os.path.expanduser("~")).free
    except OSError:
        free_bytes = None

    ram_gb = round(info["ram_bytes"] / 1024 ** 3, 1) if info.get("ram_bytes") else None
    return {
        "os": f"{system} {platform.release()}",
        "arch": platform.machine(),
        "cpu_name": info.get("cpu_name") or "Unknown CPU",
        "cpu_cores_logical": logical,
        "cpu_cores_performance": info.get("performance_cores"),
        "ram_gb": ram_gb,
        "gpu_name": info.get("gpu_name") or "",
        "gpu_cores": info.get("gpu_cores"),
        "accelerator": info.get("accelerator") or "CPU only",
        "free_disk_gb": round(free_bytes / 1024 ** 3, 1) if free_bytes else None,
    }


# Tiers describe what this machine can realistically fine-tune. Throughput is
# expressed as slide-tiles processed per second and is deliberately conservative.
TIERS = {
    "workstation": {
        "label": "Workstation class",
        "summary": "Comfortably fine-tunes the grading model on-device.",
        "tile_size": 512, "batch_size": 32, "epochs": 12, "precision": "mixed (fp16)",
        "tiles_per_sec": 46.0,
    },
    "capable": {
        "label": "Capable",
        "summary": "Suitable for on-device fine-tuning of moderate datasets.",
        "tile_size": 384, "batch_size": 16, "epochs": 10, "precision": "mixed (fp16)",
        "tiles_per_sec": 22.0,
    },
    "limited": {
        "label": "Limited",
        "summary": "Training will work but is slow. Consider running overnight, or on a workstation.",
        "tile_size": 256, "batch_size": 8, "epochs": 8, "precision": "fp32",
        "tiles_per_sec": 7.5,
    },
    "insufficient": {
        "label": "Not recommended",
        "summary": "This machine lacks the memory to fine-tune reliably. Use it for review only.",
        "tile_size": 256, "batch_size": 4, "epochs": 6, "precision": "fp32",
        "tiles_per_sec": 2.5,
    },
}


def assess_capability(hw: dict) -> dict:
    """Pick a training tier from the detected hardware."""
    ram = hw.get("ram_gb") or 0
    cores = hw.get("cpu_cores_logical") or 1
    accel = (hw.get("accelerator") or "").lower()
    has_accel = "cuda" in accel or "metal" in accel

    if ram >= 32 and cores >= 10 and has_accel:
        tier = "workstation"
    elif ram >= 16 and cores >= 8 and has_accel:
        tier = "capable"
    elif ram >= 8:
        tier = "limited"
    else:
        tier = "insufficient"

    profile = dict(TIERS[tier])
    profile["tier"] = tier

    notes = []
    if not has_accel:
        notes.append("No GPU accelerator detected — training runs on CPU and will be substantially slower.")
    if ram and ram < 16:
        notes.append(f"{ram} GB RAM limits batch size; a smaller tile size has been selected.")
    free = hw.get("free_disk_gb")
    if free is not None and free < 20:
        notes.append(f"Only {free} GB free disk — training checkpoints need roughly 5–10 GB.")
    profile["notes"] = notes
    return profile


def estimate_training(profile: dict, slide_count: int) -> dict:
    """Estimate wall-clock training time for a dataset of `slide_count` slides.

    Assumes a fixed number of usable tiles per whole-slide image; the real figure
    depends on tissue area, so this is presented to the user as an estimate.
    """
    tiles_per_slide = 220
    total_tiles = max(slide_count, 0) * tiles_per_slide * profile["epochs"]
    tps = profile["tiles_per_sec"] or 1
    seconds = total_tiles / tps
    return {
        "tiles_per_slide": tiles_per_slide,
        "total_tiles": total_tiles,
        "estimated_seconds": int(seconds),
        "estimated_human": _human_duration(seconds),
    }


def _human_duration(seconds: float) -> str:
    seconds = int(seconds)
    if seconds < 60:
        return f"{seconds}s"
    minutes, sec = divmod(seconds, 60)
    if minutes < 60:
        return f"{minutes}m {sec}s"
    hours, minutes = divmod(minutes, 60)
    if hours < 24:
        return f"{hours}h {minutes}m"
    days, hours = divmod(hours, 24)
    return f"{days}d {hours}h"
