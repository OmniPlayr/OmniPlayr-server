import os
import sys
import inspect
import threading
from datetime import datetime, timedelta
from pathlib import Path

_lock = threading.Lock()
_log_dir: Path | None = None
_retention_days: int = 7
_max_file_size_mb: int = 10
_initialized: bool = False

LEVEL_COLORS = {
    "debug": "\033[38;5;244m",
    "info": "\033[38;5;117m",
    "success": "\033[38;5;82m",
    "warning": "\033[38;5;214m",
    "warn": "\033[38;5;214m",
    "error": "\033[38;5;196m",
    "critical":"\033[38;5;201m",
}
RESET = "\033[0m"
BOLD  = "\033[1m"
DIM   = "\033[2m"

LEVEL_LABELS = {
    "debug": "DBG",
    "info": "INF",
    "success": "SUC",
    "warning": "WRN",
    "warn": "WRN",
    "error": "ERR",
    "critical": "CRT",
}


def _init_from_config():
    global _log_dir, _retention_days, _max_file_size_mb, _initialized
    if _initialized:
        return
    try:
        from api.helpers.config import get_config
        log_dir_str = get_config("logging.log_dir", "logs")
        _retention_days = get_config("logging.retention_days", 7)
        _max_file_size_mb = get_config("logging.max_file_size_mb", 10)
    except Exception:
        log_dir_str = "logs"
        _retention_days = 7
        _max_file_size_mb = 10
    _log_dir = Path(log_dir_str)
    _log_dir.mkdir(parents=True, exist_ok=True)
    _initialized = True


def _current_log_file() -> Path:
    date_str = datetime.now().strftime("%Y-%m-%d")
    return _log_dir / f"{date_str}.log"


def _rotate_if_needed(path: Path):
    if path.exists() and path.stat().st_size > _max_file_size_mb * 1024 * 1024:
        ts = datetime.now().strftime("%H-%M-%S")
        rotated = _log_dir / f"{path.stem}_{ts}.log"
        path.rename(rotated)


def _purge_old_logs():
    if _log_dir is None:
        return
    cutoff = datetime.now() - timedelta(days=_retention_days)
    for f in _log_dir.glob("*.log"):
        try:
            date_str = f.stem[:10]
            file_date = datetime.strptime(date_str, "%Y-%m-%d")
            if file_date < cutoff:
                f.unlink()
        except Exception:
            pass


def _caller_info() -> str:
    frame = inspect.stack()
    for entry in frame[2:]:
        module = entry[0].f_globals.get("__name__", "")
        if module and module != __name__ and not module.startswith("_"):
            filename = Path(entry[1]).name
            lineno = entry[2]
            return f"{filename}:{lineno}"
    return "unknown"


def log(message: str, level: str = "info", source: str | None = None) -> None:
    _init_from_config()

    level = level.lower()
    label = LEVEL_LABELS.get(level, level.upper()[:3])
    color = LEVEL_COLORS.get(level, "")

    if source is None:
        source = _caller_info()

    now = datetime.now()
    time_str = now.strftime("%H:%M:%S")
    date_str = now.strftime("%Y-%m-%d")

    console_line = (
        f"{DIM}{date_str} {time_str}{RESET} "
        f"{color}{BOLD}[{label}]{RESET} "
        f"{DIM}{source}{RESET} "
        f"{color}{message}{RESET}"
    )

    file_line = f"{date_str} {time_str} [{label}] [{source}] {message}\n"

    print(console_line, flush=True)

    if _log_dir is None:
        return

    with _lock:
        log_file = _current_log_file()
        _rotate_if_needed(log_file)
        try:
            with open(log_file, "a", encoding="utf-8") as f:
                f.write(file_line)
        except Exception as exc:
            print(f"[LOG WRITE ERROR] {exc}", file=sys.stderr, flush=True)
        _purge_old_logs()


def get_logs(since_hours: int = 24) -> list[dict]:
    _init_from_config()
    if _log_dir is None:
        return []

    cutoff = datetime.now() - timedelta(hours=since_hours)
    results: list[dict] = []

    log_files = sorted(_log_dir.glob("*.log"))
    for log_file in log_files:
        try:
            date_str = log_file.stem[:10]
            file_date = datetime.strptime(date_str, "%Y-%m-%d")
            if file_date < cutoff.replace(hour=0, minute=0, second=0, microsecond=0):
                continue
        except Exception:
            continue

        try:
            with open(log_file, "r", encoding="utf-8") as f:
                for line in f:
                    line = line.rstrip("\n")
                    if not line:
                        continue
                    try:
                        parts = line.split(" ", 3)
                        if len(parts) < 4:
                            continue
                        dt_str = f"{parts[0]} {parts[1]}"
                        dt = datetime.strptime(dt_str, "%Y-%m-%d %H:%M:%S")
                        if dt < cutoff:
                            continue
                        level_raw = parts[2].strip("[]")
                        rest = parts[3]
                        src_end = rest.find("] ")
                        if rest.startswith("[") and src_end != -1:
                            source = rest[1:src_end]
                            msg = rest[src_end + 2:]
                        else:
                            source = "unknown"
                            msg = rest
                        results.append({
                            "timestamp": dt_str,
                            "level": level_raw,
                            "source": source,
                            "message": msg,
                        })
                    except Exception:
                        continue
        except Exception:
            continue

    return results