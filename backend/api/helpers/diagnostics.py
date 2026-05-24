import asyncio
import os
import subprocess
import time

import psutil

from api.helpers.log import log

_start_time: float = time.monotonic()

_error_counts = {
    "minor": 0,
    "normal": 0,
    "critical": 0,
}

_last_io_snapshot: psutil._common.sdiskio | None = None
_last_io_time: float | None = None

_CPU_WARN = 80.0
_CPU_CRIT = 95.0
_MEM_WARN = 85.0
_MEM_CRIT = 95.0
_DISK_WARN = 88.0
_DISK_CRIT = 95.0
_IO_WARN_MBPS = 400.0
_GPU_UTIL_WARN = 85
_GPU_UTIL_CRIT = 95
_GPU_MEM_WARN = 85.0
_GPU_MEM_CRIT = 95.0
_GPU_TEMP_WARN = 83
_GPU_TEMP_CRIT = 95
_LOAD_WARN_PER_CPU = 1.0
_LOAD_CRIT_PER_CPU = 2.0
_LOOP_LAG_WARN = 0.5
_LOOP_LAG_CRIT = 2.0


def record_error(level: str) -> None:
    if level in _error_counts:
        _error_counts[level] += 1


def get_error_counts() -> dict:
    return dict(_error_counts)


def get_uptime_seconds() -> float:
    return time.monotonic() - _start_time


def reset_error_counts() -> None:
    for key in _error_counts:
        _error_counts[key] = 0


def _check_cpu() -> None:
    usage = psutil.cpu_percent(interval=1)
    if usage >= _CPU_CRIT:
        log(f"CPU usage critical: {usage:.1f}%", "critical_diagnostic", "diag")
        record_error("critical")
    elif usage >= _CPU_WARN:
        log(f"CPU usage high: {usage:.1f}%", "warning_diagnostic", "diag")
        record_error("minor")
    else:
        log(f"CPU usage normal: {usage:.1f}%", "diag", "diag")


def _check_memory() -> None:
    mem = psutil.virtual_memory()
    if mem.percent >= _MEM_CRIT:
        log(f"Memory usage critical: {mem.percent:.1f}% ({mem.available // 1024 // 1024} MB free)", "critical_diagnostic", "diag")
        record_error("critical")
    elif mem.percent >= _MEM_WARN:
        log(f"Memory usage high: {mem.percent:.1f}%", "warning_diagnostic", "diag")
        record_error("normal")
    else:
        log(f"Memory usage normal: {mem.percent:.1f}% ({mem.available // 1024 // 1024} MB free)", "diag", "diag")


def _check_disk() -> None:
    try:
        disk = psutil.disk_usage("/")
        if disk.percent >= _DISK_CRIT:
            log(f"Disk usage critical: {disk.percent:.1f}% ({disk.free // 1024 // 1024 // 1024} GB free)", "critical_diagnostic", "diag")
            record_error("critical")
        elif disk.percent >= _DISK_WARN:
            log(f"Disk usage high: {disk.percent:.1f}%", "warning_diagnostic", "diag")
            record_error("normal")
        else:
            log(f"Disk usage normal: {disk.percent:.1f}% ({disk.free // 1024 // 1024 // 1024} GB free)", "diag", "diag")
    except Exception as e:
        log(f"Disk check failed: {e}", "error_diagnostic", "diag")
        record_error("normal")


def _check_io() -> None:
    global _last_io_snapshot, _last_io_time
    try:
        current = psutil.disk_io_counters()
        now = time.monotonic()

        if _last_io_snapshot is not None and _last_io_time is not None:
            elapsed = now - _last_io_time
            if elapsed > 0:
                read_mbps = (current.read_bytes - _last_io_snapshot.read_bytes) / elapsed / 1024 / 1024
                write_mbps = (current.write_bytes - _last_io_snapshot.write_bytes) / elapsed / 1024 / 1024

                if read_mbps > _IO_WARN_MBPS or write_mbps > _IO_WARN_MBPS:
                    log(f"High disk IO: read={read_mbps:.1f} MB/s write={write_mbps:.1f} MB/s", "warning_diagnostic", "diag")
                    record_error("minor")
                elif hasattr(current, "read_time") and hasattr(_last_io_snapshot, "read_time"):
                    read_time_delta = current.read_time - _last_io_snapshot.read_time
                    write_time_delta = current.write_time - _last_io_snapshot.write_time
                    if read_time_delta > elapsed * 900 or write_time_delta > elapsed * 900:
                        log("IO saturation detected: disk is under severe pressure", "critical_diagnostic", "diag")
                        record_error("critical")
                    else:
                        log(f"Disk IO normal: read={read_mbps:.1f} MB/s write={write_mbps:.1f} MB/s", "diag", "diag")
                else:
                    log(f"Disk IO normal: read={read_mbps:.1f} MB/s write={write_mbps:.1f} MB/s", "diag", "diag")
        else:
            log("Disk IO baseline snapshot taken", "diag", "diag")

        _last_io_snapshot = current
        _last_io_time = now
    except Exception as e:
        log(f"IO check failed: {e}", "error_diagnostic", "diag")
        record_error("normal")


def _check_gpu() -> None:
    try:
        result = subprocess.run(
            [
                "nvidia-smi",
                "--query-gpu=index,utilization.gpu,memory.used,memory.total,temperature.gpu",
                "--format=csv,noheader,nounits",
            ],
            capture_output=True,
            text=True,
            timeout=5,
        )
        if result.returncode != 0:
            log("No GPU detected or nvidia-smi unavailable", "diag", "diag")
            return

        for line in result.stdout.strip().splitlines():
            parts = [p.strip() for p in line.split(",")]
            if len(parts) < 5:
                continue

            idx = parts[0]
            util = int(parts[1])
            mem_used = int(parts[2])
            mem_total = int(parts[3])
            temp = int(parts[4])
            mem_pct = (mem_used / mem_total * 100) if mem_total > 0 else 0

            if util >= _GPU_UTIL_CRIT or mem_pct >= _GPU_MEM_CRIT:
                log(f"GPU {idx} critical: util={util}% mem={mem_pct:.0f}% ({mem_used}/{mem_total} MB) temp={temp}°C", "critical_diagnostic", "diag")
                record_error("critical")
            elif util >= _GPU_UTIL_WARN or mem_pct >= _GPU_MEM_WARN:
                log(f"GPU {idx} high load: util={util}% mem={mem_pct:.0f}% temp={temp}°C", "warning_diagnostic", "diag")
                record_error("normal")
            else:
                log(f"GPU {idx} normal: util={util}% mem={mem_pct:.0f}% ({mem_used}/{mem_total} MB) temp={temp}°C", "diag", "diag")

            if temp >= _GPU_TEMP_CRIT:
                log(f"GPU {idx} temperature critical: {temp}°C", "critical_diagnostic", "diag")
                record_error("critical")
            elif temp >= _GPU_TEMP_WARN:
                log(f"GPU {idx} temperature high: {temp}°C", "warning_diagnostic", "diag")
                record_error("minor")

    except FileNotFoundError:
        log("No GPU detected (nvidia-smi not found)", "diag", "diag")
    except subprocess.TimeoutExpired:
        log("GPU check timed out (nvidia-smi unresponsive)", "warning_diagnostic", "diag")
        record_error("minor")
    except Exception as e:
        log(f"GPU check failed: {e}", "error_diagnostic", "diag")


def _check_load() -> None:
    try:
        load1, load5, load15 = os.getloadavg()
        cpu_count = psutil.cpu_count(logical=True) or 1
        per_cpu = load1 / cpu_count

        if per_cpu >= _LOAD_CRIT_PER_CPU:
            log(f"System overloaded: load avg {load1:.2f} ({per_cpu:.2f}/cpu, 5m={load5:.2f}, 15m={load15:.2f})", "critical_diagnostic", "diag")
            record_error("critical")
        elif per_cpu >= _LOAD_WARN_PER_CPU:
            log(f"System under high load: load avg {load1:.2f} ({per_cpu:.2f}/cpu)", "warning_diagnostic", "diag")
            record_error("normal")
        else:
            log(f"System load normal: {load1:.2f} ({per_cpu:.2f}/cpu, 5m={load5:.2f}, 15m={load15:.2f})", "diag", "diag")
    except AttributeError:
        pass
    except Exception as e:
        log(f"Load check failed: {e}", "error_diagnostic", "diag")


def run_diagnostics() -> None:
    log("Running periodic system diagnostics", "diag", "diag")
    _check_cpu()
    _check_memory()
    _check_disk()
    _check_io()
    _check_gpu()
    _check_load()
    log("Diagnostics complete", "diag", "diag")


async def _loop_lag_monitor() -> None:
    while True:
        t0 = asyncio.get_event_loop().time()
        await asyncio.sleep(1)
        lag = asyncio.get_event_loop().time() - t0 - 1.0

        if lag >= _LOOP_LAG_CRIT:
            log(f"Severe event loop lag: {lag:.3f}s behind schedule", "critical_diagnostic", "diag")
            record_error("critical")
        elif lag >= _LOOP_LAG_WARN:
            log(f"Event loop lag detected: {lag:.3f}s behind schedule", "warning_diagnostic", "diag")
            record_error("minor")


async def _periodic_diagnostics(interval_seconds: int = 600) -> None:
    await asyncio.sleep(30)
    while True:
        run_diagnostics()
        await asyncio.sleep(interval_seconds)


def start_diagnostics(interval_seconds: int = 600) -> None:
    loop = asyncio.get_event_loop()
    loop.create_task(_loop_lag_monitor())
    loop.create_task(_periodic_diagnostics(interval_seconds))
    log("Diagnostics started", "diag", "diag")