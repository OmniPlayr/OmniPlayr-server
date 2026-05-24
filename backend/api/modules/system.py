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
from api.helpers.server import verify_token, get_token_user
from api.helpers.config import (
    flatten_configs,
    flatten_frontend_configs,
    CONFIG_DIR,
    CONFIG_TYPES_DIR,
    CONFIG_DEFAULTS_DIR,
    FRONTEND_CONFIG_DIR,
    FRONTEND_CONFIG_TYPES_DIR,
    FRONTEND_CONFIG_DEFAULTS_DIR,
    _parse_type_string,
)
from pathlib import Path
import toml

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
async def shutdown(admin=Depends(verify_admin)):
    log("System shutdown requested by admin", "warning", "system")

    try:
        if _in_docker():
            if not shutil.which("docker"):
                raise HTTPException(status_code=500, detail="Docker CLI not available")

            # This shutsdown all processes running for OmniPlayr so you can shut it down without having to shutdown your actual system
            process = await asyncio.create_subprocess_exec(
                "docker", "stop",
                "omniplayr_backend",
                "omniplayr_frontend",
                "omniplayr_db",
                "omniplayr_pgadmin"
            )
        else:
            process = await asyncio.create_subprocess_exec(
                "shutdown", "-h", "now"
            )

        await process.wait()

    except Exception as exc:
        log(f"Shutdown failed: {exc}", "error", "system")
        raise HTTPException(status_code=500, detail=str(exc))

    return {"status": "shutting_down"}


@router.post("/reboot")
async def reboot(admin=Depends(verify_admin)):
    log("System reboot requested by admin", "warning", "system")

    try:
        if _in_docker():
            
            # This just restarts the containers, its almost exactly the same as the shutdown but instead it just restarts them
            process = await asyncio.create_subprocess_exec(
                "docker", "restart",
                "omniplayr_backend",
                "omniplayr_frontend",
                "omniplayr_db",
                "omniplayr_pgadmin"
            )
        else:
            process = await asyncio.create_subprocess_exec(
                "reboot"
            )

        await process.wait()

    except Exception as exc:
        log(f"Reboot failed: {exc}", "error", "system")
        raise HTTPException(status_code=500, detail=str(exc))

    return {"status": "rebooting"}


class TerminalCommand(BaseModel):
    command: str

# This is a websocket version for checking if you are an admin, a normal http version can be found in the admin helper
async def verify_admin_ws(ws: WebSocket):
    token = ws.query_params.get("token")
    account_token = ws.query_params.get("account_token")

    if not token or not account_token:
        await ws.close(code=1008)
        return None

    user = verify_token(token)
    if not user:
        await ws.close(code=1008)
        return None
    
    user_id = get_token_user(account_token)
    if not user_id:
        await ws.close(code=1008)
        return None

    if not get_admin_status(int(user_id)):
        await ws.close(code=1008)
        return None

    return True

# This endpoint is for the terminal on the frontend, so you don't need to ssh into your server if you want to access the terminal
# I haven't found a way to make it so you can get the actual system terminal, I might need to find something out for that
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

    # This is for reading from the terminal
    async def read_shell():
        try:
            while True:
                data = await asyncio.to_thread(os.read, master, 1024)
                if not data:
                    break
                await ws.send_text(data.decode("utf-8", errors="ignore"))
        except Exception:
            pass

    # This is for writing to the terminal
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

# This is for the safe mode, Safe mode makes sure no plugins load, so like if something goes wrong you can use that to check what is going on in the system
@router.post("/safe-mode/enable")
def enable_safe_mode(admin=Depends(verify_admin)):
    log("Safe mode enabled", "warning", "system")

    with open(_SAFE_MODE_FILE, "w") as f:
        f.write("1")

    return {"status": "safe_mode_enabled", "note": "Restart required"}

# This is to disable safe mode
@router.post("/safe-mode/disable")
def disable_safe_mode(admin=Depends(verify_admin)):
    log("Safe mode disabled", "info", "system")

    if os.path.exists(_SAFE_MODE_FILE):
        os.remove(_SAFE_MODE_FILE)

    return {"status": "safe_mode_disabled", "note": "Restart required"}

# This is for parsing config files, pretty self explanatory
def _parse_field_meta(raw_meta: any) -> dict:
    if isinstance(raw_meta, dict):
        return raw_meta

    if not isinstance(raw_meta, str):
        return {}

    parsed = _parse_type_string(raw_meta)
    result: dict = {"type": parsed["base_type"]}

    if parsed["liveupdate"]:
        result["liveupdate"] = True
    if parsed["comment"] is not None:
        result["comment"] = parsed["comment"]
    if parsed["minmax"] is not None:
        result["min"] = parsed["minmax"][0]
        result["max"] = parsed["minmax"][1]
    if parsed["step"] is not None:
        result["step"] = parsed["step"]
    if parsed["in_values"] is not None:
        result["in_values"] = parsed["in_values"]

    return result


def _values_equal(a, b) -> bool:
    if isinstance(a, list) and isinstance(b, list):
        return len(a) == len(b) and all(x == y for x, y in zip(a, b))
    return a == b


_FIELD_META_KEYS = ("type", "default", "comment", "min", "max", "step", "in_values", "liveupdate")


def _enrich_value(val: any, meta: any) -> dict:
    enriched = {"value": val}
    meta_dict = _parse_field_meta(meta)
    for k in _FIELD_META_KEYS:
        if k in meta_dict:
            enriched[k] = meta_dict[k]
    if "default" in meta_dict:
        enriched["is_default"] = _values_equal(val, meta_dict["default"])
    return enriched

# This is for getting the contents of a config file, also pretty self explanatory
def _get_file_contents(stem: str, config_dir: Path, types_dir: Path, source: str = "backend") -> dict:
    config_file = config_dir / f"{stem}.toml"
    if not config_file.exists():
        raise HTTPException(status_code=404, detail=f"Config file '{stem}' not found")

    try:
        data = toml.load(config_file)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    type_data = {}
    type_file = types_dir / f"{stem}.toml"
    if type_file.exists():
        try:
            type_data = toml.load(type_file)
        except Exception:
            pass

    def enrich_node(data_node: dict, type_node: dict) -> dict:
        result = {}
        for key, val in data_node.items():
            meta = type_node.get(key, {}) if isinstance(type_node, dict) else {}

            if isinstance(val, dict) and (not meta or isinstance(meta, dict)):
                result[key] = enrich_node(val, meta if isinstance(meta, dict) else {})
            else:
                result[key] = _enrich_value(val, meta)

        return result

    return {
        "file": stem,
        "source": source,
        "data": enrich_node(data, type_data),
    }


def _extract_plain_values(enriched_data: dict) -> dict:
    plain = {}
    for section_key, section_val in enriched_data.items():
        if isinstance(section_val, dict) and "value" in section_val:
            plain[section_key] = section_val["value"]
        elif isinstance(section_val, dict):
            plain[section_key] = _extract_plain_values(section_val)
        else:
            plain[section_key] = section_val
    return plain

# This is for getting the config files, so you can easily read them
# Also pretty self explanatory
# This also sends things about the types and if its a default and stuff
@router.get("/configs")
def get_configs(file: str = None, source: str = None, admin=Depends(verify_admin)):
    if file is not None:
        if source == "frontend":
            if file == "version":
                raise HTTPException(status_code=403, detail="Access denied")

            return _get_file_contents(
                file,
                FRONTEND_CONFIG_DIR,
                FRONTEND_CONFIG_TYPES_DIR,
                "frontend"
            )

        return _get_file_contents(file, CONFIG_DIR, CONFIG_TYPES_DIR, "backend")

    backend_files = sorted(f.stem for f in CONFIG_DIR.glob("*.toml")) if CONFIG_DIR.exists() else []

    frontend_files = []
    if FRONTEND_CONFIG_DIR.exists():
        frontend_files = sorted(
            f.stem
            for f in FRONTEND_CONFIG_DIR.glob("*.toml")
            if f.stem != "version"
        )

    return {
        "backend": backend_files,
        "frontend": frontend_files,
    }


class ConfigSaveRequest(BaseModel):
    file: str
    source: str = "backend"
    data: dict

# This is so you can easily update the configs, so you don't need to modify the files, because they can be pretty complicated some times
@router.put("/configs")
def save_config(body: ConfigSaveRequest, admin=Depends(verify_admin)):
    if body.source == "frontend" and body.file == "version":
        raise HTTPException(status_code=403, detail="Updating version config is not allowed")

    config_dir = FRONTEND_CONFIG_DIR if body.source == "frontend" else CONFIG_DIR
    config_file = config_dir / f"{body.file}.toml"

    if not config_file.exists():
        raise HTTPException(status_code=404, detail=f"Config file '{body.file}' not found")

    plain_data = _extract_plain_values(body.data)

    try:
        with open(config_file, "w") as f:
            toml.dump(plain_data, f)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    log(f"Config '{body.file}' saved by admin", "info", "system")

    return {"status": "saved"}


_SEARCH_FIELDS = {"type", "value", "default", "comment", "min", "max", "step", "in_values", "liveupdate"}

# This is so you can search in the configs
# I might need to refine this system, but it works fine how it is right now
@router.get("/config_search")
def config_search(
    query: str,
    file: str = None,
    source: str = None,
    admin=Depends(verify_admin),
):
    field = None
    search_val = query.lower()

    for prefix in _SEARCH_FIELDS:
        if search_val.startswith(f"{prefix}:"):
            field = prefix
            search_val = search_val[len(prefix) + 1:]
            break

    items = flatten_frontend_configs() if source == "frontend" else flatten_configs()

    if file:
        items = [i for i in items if i["file"] == file]

    results_by_file: dict[str, dict] = {}

    for item in items:
        if field:
            v = item.get(field)
            if v is None:
                match = search_val == ""
            elif isinstance(v, list):
                match = any(search_val in str(x).lower() for x in v)
            else:
                match = search_val in str(v).lower()
        else:
            match = search_val in item["key"].lower()

        if match:
            f = item["file"]
            if f not in results_by_file:
                results_by_file[f] = {"file": f, "matches": []}
            results_by_file[f]["matches"].append(item)

    return list(results_by_file.values())