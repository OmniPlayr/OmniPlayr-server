import json
import traceback
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

FATAL_STATE_PATH = Path("logs/backend-fatal.json")
FATAL_LOG_PATH = Path("logs/backend-fatal.log")


BACKEND_STARTUP_CODES = {
    "config": {
        "code": "OP-BACKEND-STARTUP-CONFIG-001",
        "message": "Backend failed while loading configuration",
    },
    "signature": {
        "code": "OP-BACKEND-STARTUP-UPDATE-001",
        "message": "Backend failed while verifying update state",
    },
    "database": {
        "code": "OP-BACKEND-STARTUP-DB-001",
        "message": "Backend failed while connecting to the database",
    },
    "plugins": {
        "code": "OP-BACKEND-STARTUP-PLUGIN-001",
        "message": "Backend failed while loading plugins",
    },
    "diagnostics": {
        "code": "OP-BACKEND-STARTUP-DIAG-001",
        "message": "Backend failed while starting diagnostics",
    },
    "proxy": {
        "code": "OP-BACKEND-STARTUP-PROXY-001",
        "message": "Backend failed while starting the HTTPS proxy",
    },
    "unknown": {
        "code": "OP-BACKEND-STARTUP-UNKNOWN-001",
        "message": "Backend failed during startup",
    },
}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def clear_fatal_state() -> None:
    try:
        FATAL_STATE_PATH.unlink(missing_ok=True)
    except Exception:
        pass


def record_fatal_state(code: str, message: str, exc: BaseException | None = None, stage: str | None = None) -> dict[str, Any]:
    details = ""
    if exc is not None:
        details = "".join(traceback.format_exception(type(exc), exc, exc.__traceback__)).strip()

    payload: dict[str, Any] = {
        "active": True,
        "code": code,
        "message": message,
        "stage": stage,
        "details": details,
        "created_at": _now(),
    }

    FATAL_STATE_PATH.parent.mkdir(parents=True, exist_ok=True)
    FATAL_STATE_PATH.write_text(json.dumps(payload, indent=2), encoding="utf-8")

    log_line = f"{payload['created_at']} [{code}] {message}"
    if stage:
        log_line += f" stage={stage}"
    if details:
        log_line += f"\n{details}"
    with FATAL_LOG_PATH.open("a", encoding="utf-8") as f:
        f.write(log_line + "\n\n")

    return payload


def record_startup_exception(stage: str, exc: BaseException) -> dict[str, Any]:
    info = BACKEND_STARTUP_CODES.get(stage, BACKEND_STARTUP_CODES["unknown"])
    return record_fatal_state(info["code"], info["message"], exc, stage)
