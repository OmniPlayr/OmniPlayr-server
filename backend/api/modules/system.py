import asyncio
import os
import shutil
import pty
import select
import termios
import struct
import fcntl
import shlex
import tty
from fastapi import APIRouter, Depends, HTTPException, WebSocket, WebSocketDisconnect, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from api.helpers.admin import verify_admin, get_admin_status
from api.helpers.log import log
from api.helpers.server import verify_token

router = APIRouter()

_SAFE_MODE_FILE = ".safe_mode"

sessions = {}

def set_winsize(fd, rows, cols):
    winsize = struct.pack("HHHH", rows, cols, 0, 0)
    fcntl.ioctl(fd, termios.TIOCSWINSZ, winsize)

def _in_docker() -> bool:
    return os.path.exists("/.dockerenv") or (
        os.path.exists("/proc/1/cgroup") and "docker" in open("/proc/1/cgroup").read()
    )

def _is_safe_mode() -> bool:
    return os.path.exists(_SAFE_MODE_FILE)


@router.get("/status")
def system_status(admin=Depends(verify_admin)):
    return {
        "in_docker": _in_docker(),
        "safe_mode": _is_safe_mode(),
        "docker_cli": shutil.which("docker") is not None,
    }


@router.post("/shutdown")
def shutdown(admin=Depends(verify_admin)):
    log("System shutdown requested by admin", "warning", "system")

    if _in_docker():
        if not shutil.which("docker"):
            raise HTTPException(status_code=500, detail="Docker CLI not available")

        subprocess = [
            "docker",
            "compose",
            "down",
        ]

        try:
            asyncio.create_subprocess_exec(*subprocess)
        except Exception as exc:
            log(f"Shutdown docker compose failed: {exc}", "error", "system")
            raise HTTPException(status_code=500, detail=str(exc))
    else:
        try:
            asyncio.create_subprocess_exec("shutdown", "-h", "now")
        except Exception as exc:
            log(f"Shutdown host failed: {exc}", "error", "system")
            raise HTTPException(status_code=500, detail=str(exc))

    return {"status": "shutting_down"}


@router.post("/reboot")
def reboot(admin=Depends(verify_admin)):
    log("System reboot requested by admin", "warning", "system")

    if _in_docker():
        if not shutil.which("docker"):
            raise HTTPException(status_code=500, detail="Docker CLI not available")

        try:
            asyncio.create_subprocess_exec("docker", "compose", "restart")
        except Exception as exc:
            log(f"Reboot docker compose failed: {exc}", "error", "system")
            raise HTTPException(status_code=500, detail=str(exc))
    else:
        try:
            asyncio.create_subprocess_exec("reboot")
        except Exception as exc:
            log(f"Reboot host failed: {exc}", "error", "system")
            raise HTTPException(status_code=500, detail=str(exc))

    return {"status": "rebooting"}


class TerminalCommand(BaseModel):
    command: str

async def verify_admin_ws(ws: WebSocket):
    token = ws.query_params.get("token")
    account_id = ws.query_params.get("account_id")

    if not token or not account_id:
        await ws.close(code=1008)
        return None

    user = verify_token(token)
    if not user:
        await ws.close(code=1008)
        return None

    if not get_admin_status(int(account_id)):
        await ws.close(code=1008)
        return None

    return True

@router.websocket("/terminal/ws")
async def terminal_ws(ws: WebSocket):
    await ws.accept()

    ok = await verify_admin_ws(ws)
    if not ok:
        return

    master, slave = pty.openpty()

    process = await asyncio.create_subprocess_exec(
        "/bin/bash",
        "-i",
        stdin=slave,
        stdout=slave,
        stderr=slave,
        start_new_session=True,
    )

    async def read_shell():
        try:
            while True:
                data = await asyncio.to_thread(os.read, master, 1024)
                if not data:
                    break
                await ws.send_text(data.decode("utf-8", errors="ignore"))
        except Exception:
            pass

    async def write_shell():
        try:
            while True:
                msg = await ws.receive_text()
                os.write(master, msg.encode())
        except WebSocketDisconnect:
            pass

    try:
        await asyncio.gather(read_shell(), write_shell())
    finally:
        process.terminate()
        os.close(master)
        os.close(slave)

@router.post("/safe-mode/enable")
def enable_safe_mode(admin=Depends(verify_admin)):
    log("Safe mode enabled", "warning", "system")

    with open(_SAFE_MODE_FILE, "w") as f:
        f.write("1")

    return {"status": "safe_mode_enabled", "note": "Restart required"}


@router.post("/safe-mode/disable")
def disable_safe_mode(admin=Depends(verify_admin)):
    log("Safe mode disabled", "info", "system")

    if os.path.exists(_SAFE_MODE_FILE):
        os.remove(_SAFE_MODE_FILE)

    return {"status": "safe_mode_disabled", "note": "Restart required"}