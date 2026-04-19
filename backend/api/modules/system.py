import asyncio
import os
import shlex
import subprocess
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from api.helpers.admin import verify_admin
from api.helpers.log import log

router = APIRouter()

_SAFE_MODE_FILE = ".safe_mode"


def _in_docker() -> bool:
    return os.path.exists("/.dockerenv") or os.path.exists("/proc/1/cgroup") and "docker" in open("/proc/1/cgroup").read()


def _is_safe_mode() -> bool:
    return os.path.exists(_SAFE_MODE_FILE)


@router.get("/status")
def system_status(admin=Depends(verify_admin)):
    return {
        "in_docker": _in_docker(),
        "safe_mode": _is_safe_mode(),
    }


@router.post("/shutdown")
def shutdown(admin=Depends(verify_admin)):
    log("System shutdown requested by admin", "warning", "system")
    if _in_docker():
        try:
            subprocess.Popen(
                ["docker", "compose", "down"],
                cwd=os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
        except Exception as exc:
            log(f"Shutdown docker compose failed: {exc}", "error", "system")
            raise HTTPException(status_code=500, detail=str(exc))
    else:
        try:
            subprocess.Popen(["shutdown", "-h", "now"])
        except Exception as exc:
            log(f"Shutdown host failed: {exc}", "error", "system")
            raise HTTPException(status_code=500, detail=str(exc))
    return {"status": "shutting_down"}


@router.post("/reboot")
def reboot(admin=Depends(verify_admin)):
    log("System reboot requested by admin", "warning", "system")
    if _in_docker():
        try:
            project_dir = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
            subprocess.Popen(
                ["sh", "-c", "docker compose restart"],
                cwd=project_dir,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
        except Exception as exc:
            log(f"Reboot docker compose failed: {exc}", "error", "system")
            raise HTTPException(status_code=500, detail=str(exc))
    else:
        try:
            subprocess.Popen(["reboot"])
        except Exception as exc:
            log(f"Reboot host failed: {exc}", "error", "system")
            raise HTTPException(status_code=500, detail=str(exc))
    return {"status": "rebooting"}


@router.post("/safe-mode/enable")
def enable_safe_mode(admin=Depends(verify_admin)):
    log("Safe mode enabled by admin - plugins will be disabled on next restart", "warning", "system")
    try:
        with open(_SAFE_MODE_FILE, "w") as f:
            f.write("1")
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))
    return {"status": "safe_mode_enabled", "note": "Restart required to take effect"}


@router.post("/safe-mode/disable")
def disable_safe_mode(admin=Depends(verify_admin)):
    log("Safe mode disabled by admin", "info", "system")
    if os.path.exists(_SAFE_MODE_FILE):
        try:
            os.remove(_SAFE_MODE_FILE)
        except Exception as exc:
            raise HTTPException(status_code=500, detail=str(exc))
    return {"status": "safe_mode_disabled", "note": "Restart required to take effect"}


class TerminalCommand(BaseModel):
    command: str


@router.post("/terminal")
def run_terminal(body: TerminalCommand, admin=Depends(verify_admin)):
    cmd = body.command.strip()
    if not cmd:
        raise HTTPException(status_code=400, detail="Command is required")

    blocked = ["rm -rf /", "mkfs", ":(){:|:&};:", "dd if=/dev/zero"]
    for danger in blocked:
        if danger in cmd:
            log(f"Blocked dangerous terminal command: {cmd}", "error", "system")
            raise HTTPException(status_code=400, detail="Command blocked for safety")

    log(f"Terminal command executed: {cmd}", "info", "system")

    try:
        result = subprocess.run(
            cmd,
            shell=True,
            capture_output=True,
            text=True,
            timeout=30,
        )
        return {
            "stdout": result.stdout,
            "stderr": result.stderr,
            "returncode": result.returncode,
        }
    except subprocess.TimeoutExpired:
        raise HTTPException(status_code=408, detail="Command timed out after 30 seconds")
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/terminal/stream")
async def stream_terminal(body: TerminalCommand, admin=Depends(verify_admin)):
    cmd = body.command.strip()
    if not cmd:
        raise HTTPException(status_code=400, detail="Command is required")

    blocked = ["rm -rf /", "mkfs", ":(){:|:&};:", "dd if=/dev/zero"]
    for danger in blocked:
        if danger in cmd:
            log(f"Blocked dangerous terminal stream command: {cmd}", "error", "system")
            raise HTTPException(status_code=400, detail="Command blocked for safety")

    log(f"Streaming terminal command: {cmd}", "info", "system")

    async def generate():
        proc = await asyncio.create_subprocess_shell(
            cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
        )
        async for line in proc.stdout:
            yield line.decode("utf-8", errors="replace")
        await proc.wait()
        yield f"\n[exit code: {proc.returncode}]\n"

    return StreamingResponse(generate(), media_type="text/plain")