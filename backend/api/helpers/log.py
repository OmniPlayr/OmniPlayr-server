import os
import sys
import inspect
import threading
import traceback
from datetime import datetime, timedelta
from pathlib import Path

_lock = threading.Lock()
_log_dir: Path | None = None
_retention_days: int = 7
_max_file_size_mb: int = 10
_initialized: bool = False
_initializing: bool = False

LEVEL_COLORS = {
    "debug": "\033[38;5;244m",
    "info": "\033[38;5;117m",
    "success": "\033[38;5;82m",
    "warning": "\033[38;5;214m",
    "warn": "\033[38;5;214m",
    "error": "\033[38;5;196m",
    "critical": "\033[38;5;201m",
    "diag": "\033[38;5;51m",
    "warning_diagnostic": "\033[38;5;220m",
    "error_diagnostic": "\033[38;5;208m",
    "critical_diagnostic": "\033[38;5;199m",
}
RESET = "\033[0m"
BOLD = "\033[1m"
DIM = "\033[2m"

LEVEL_LABELS = {
    "debug": "DBG",
    "info": "INF",
    "success": "SUC",
    "warning": "WRN",
    "warn": "WRN",
    "error": "ERR",
    "critical": "CRT",
    "diag": "DIG",
    "warning_diagnostic": "WDG",
    "error_diagnostic": "EDG",
    "critical_diagnostic": "CDG",
}

_SKIP_MODULE_ROOTS = frozenset({
    "uvicorn", "starlette", "fastapi", "anyio", "h11",
    "asyncio", "threading", "concurrent", "importlib",
    "encodings", "codecs", "abc", "typing",
})
_SKIP_FILEPATH_PARTS = ("site-packages", "<frozen", "<string>")


def _init_from_config():
    global _log_dir, _retention_days, _max_file_size_mb, _initialized, _initializing
    if _initialized or _initializing:
        return
    _initializing = True
    try:
        from api.helpers.config import get_config
        log_dir_str = get_config("logging.log_dir", Path("logs"))
        _retention_days = get_config("logging.retention_days", 7)
        _max_file_size_mb = get_config("logging.max_file_size_mb", 10)
    except Exception:
        log_dir_str = Path("logs")
        _retention_days = 7
        _max_file_size_mb = 10
    finally:
        _initializing = False
    _log_dir = log_dir_str
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


def _build_call_chain() -> list[str]:
    this_module = __name__
    chain = []
    for entry in inspect.stack()[2:22]:
        module = entry[0].f_globals.get("__name__", "")
        filepath = entry[1]
        if module == this_module:
            continue
        if module.split(".")[0] in _SKIP_MODULE_ROOTS:
            continue
        if any(part in filepath for part in _SKIP_FILEPATH_PARTS):
            continue
        filename = Path(filepath).name
        lineno = entry[2]
        chain.append(f"{filename}:{lineno}")
    chain.reverse()
    return chain[:8] if chain else ["unknown"]


def _parse_log_line(line: str) -> dict | None:
    try:
        parts = line.split(" ", 3)
        if len(parts) < 4:
            return None
        dt_str = f"{parts[0]} {parts[1]}"
        datetime.strptime(dt_str, "%Y-%m-%d %H:%M:%S")
        level_raw = parts[2].strip("[]")
        rest = parts[3]
        src_end = rest.find("] ")
        if rest.startswith("[") and src_end != -1:
            chain_str = rest[1:src_end]
            raw_msg = rest[src_end + 2:]
        else:
            chain_str = "unknown"
            raw_msg = rest
        msg = raw_msg.replace("\\n", "\n").replace("\\\\", "\\")
        call_chain = [f for f in chain_str.split(">") if f] or ["unknown"]
        return {
            "timestamp": dt_str,
            "level": level_raw,
            "source": call_chain[-1],
            "call_chain": call_chain,
            "message": msg,
        }
    except Exception:
        return None


_DEV_MODE: bool = os.environ.get("DEV_MODE", "").lower() == "true"


def log(message: str, level: str = "info", source: str | None = None) -> None:
    if level == "debug" and not _DEV_MODE:
        return

    _init_from_config()

    level = level.lower()
    label = LEVEL_LABELS.get(level, level.upper()[:3])
    color = LEVEL_COLORS.get(level, "")

    chain = _build_call_chain()
    display_source = chain[-1]
    chain_str = ">".join(chain)

    now = datetime.now()
    time_str = now.strftime("%H:%M:%S")
    date_str = now.strftime("%Y-%m-%d")

    console_line = (
        f"{DIM}{date_str} {time_str}{RESET} "
        f"{color}{BOLD}[{label}]{RESET} "
        f"{DIM}{display_source}{RESET} "
        f"{color}{message}{RESET}"
    )

    encoded_msg = message.replace("\\", "\\\\").replace("\n", "\\n")
    file_line = f"{date_str} {time_str} [{label}] [{chain_str}] {encoded_msg}\n"

    print(console_line, flush=True)

    if _log_dir is None:
        return

    with _lock:
        log_file = _current_log_file()
        _rotate_if_needed(log_file)
        try:
            _log_dir.mkdir(parents=True, exist_ok=True)
            with open(log_file, "a", encoding="utf-8") as f:
                f.write(file_line)
        except Exception as exc:
            print(f"[LOG WRITE ERROR] {exc}", file=sys.stderr, flush=True)
        _purge_old_logs()


def log_exception(exc: Exception, message: str = "", source: str | None = None) -> None:
    tb = traceback.format_exc()
    parts: list[str] = []
    if message:
        parts.append(message)
    parts.append(f"{type(exc).__name__}: {exc}")
    if tb and tb.strip() not in ("NoneType: None", "None"):
        parts.append(tb.strip())
    log("\n".join(parts), level="error", source=source)


def setup_exception_hook() -> None:
    _original = sys.excepthook

    def _hook(exc_type, exc_value, exc_tb):
        tb_text = "".join(traceback.format_tb(exc_tb)).strip()
        msg = f"Unhandled {exc_type.__name__}: {exc_value}"
        if tb_text:
            msg = f"{msg}\n{tb_text}"
        log(msg, level="critical", source="excepthook")
        _original(exc_type, exc_value, exc_tb)

    sys.excepthook = _hook


def get_logs(
    since_hours: int = 24,
    limit: int = 200,
    before: str | None = None,
    since: str | None = None,
) -> dict:
    _init_from_config()
    if _log_dir is None:
        return {"entries": [], "has_more": False}

    cutoff = datetime.now() - timedelta(hours=since_hours)
    before_dt = None
    since_dt = None

    if before:
        try:
            before_dt = datetime.strptime(before, "%Y-%m-%d %H:%M:%S")
        except Exception:
            pass
    if since:
        try:
            since_dt = datetime.strptime(since, "%Y-%m-%d %H:%M:%S")
        except Exception:
            pass

    all_entries: list[dict] = []
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
                    entry = _parse_log_line(line)
                    if entry is None:
                        continue
                    try:
                        dt = datetime.strptime(entry["timestamp"], "%Y-%m-%d %H:%M:%S")
                    except Exception:
                        continue
                    if dt < cutoff:
                        continue
                    if before_dt is not None and dt >= before_dt:
                        continue
                    if since_dt is not None and dt <= since_dt:
                        continue
                    all_entries.append(entry)
        except Exception:
            continue

    all_entries.sort(key=lambda e: e["timestamp"])

    if since_dt is not None:
        return {"entries": all_entries, "has_more": False}

    has_more = len(all_entries) > limit
    entries = all_entries[-limit:] if has_more else all_entries
    return {"entries": entries, "has_more": has_more}