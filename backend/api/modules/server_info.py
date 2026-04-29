from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse
from pathlib import Path
import json
import os
import base64
import mimetypes

from urllib.parse import quote
from api.helpers.log import log

router = APIRouter()

config_file = Path("config.local.json")


def load_json(path: Path):
    log(f"Loading JSON from {path}", "debug", "module.server_info")
    if not path.exists():
        log(f"JSON file not found: {path}", "debug", "module.server_info")
        return None
    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)
    log(f"JSON loaded from {path} with {len(data)} key(s)", "debug", "module.server_info")
    return data


def get_plugin_base(plugin_key: str, frontend: bool):
    if frontend:
        return Path("frontend/src/plugins") / plugin_key
    return Path("plugins") / plugin_key


def load_plugin_meta(plugin_path: Path, plugin_key: str, frontend: bool):
    log(f"Loading plugin meta for {plugin_key!r} frontend={frontend} path={plugin_path}", "debug", "module.server_info")
    package_file = plugin_path / "package.json"
    if not package_file.exists():
        log(f"No package.json for plugin {plugin_key!r} at {package_file}", "debug", "module.server_info")
        return None

    with open(package_file, "r", encoding="utf-8") as f:
        pkg = json.load(f)

    log(f"Plugin meta loaded for {plugin_key!r}: name={pkg.get('name')!r}", "debug", "module.server_info")
    return {
        "folder": plugin_key,
        "frontend": frontend,
        "package": pkg
    }


def scan_plugins(folder: Path):
    log(f"Scanning plugins in {folder}", "debug", "module.server_info")
    if not folder.exists():
        log(f"Plugin folder does not exist: {folder}", "debug", "module.server_info")
        return []

    result = []
    for item in folder.iterdir():
        if item.is_dir():
            plugin = load_plugin_meta(item, item.name, True)
            if plugin:
                result.append(plugin)
    log(f"Found {len(result)} frontend plugin(s) in {folder}", "debug", "module.server_info")
    return result


@router.get("/server")
def get_setup_state():
    log("GET /info/server requested", "debug", "module.server_info")
    data = load_json(config_file)
    if not data:
        log("GET /info/server: config.local.json not found", "warning", "module.server_info")
        return {"error": "Config file not found"}
    log("GET /info/server: returning config data", "debug", "module.server_info")
    return data


@router.get("/safe-mode")
def get_safe_mode_status():
    log("GET /info/safe-mode requested", "debug", "module.server_info")
    exists = os.path.exists(".safe_mode")
    log(f"GET /info/safe-mode: safe_mode={exists}", "debug", "module.server_info")
    return {"safe_mode": exists}


@router.get("/plugins")
def get_plugins():
    log("GET /info/plugins requested", "debug", "module.server_info")
    config = load_json(config_file)
    if not config:
        log("GET /info/plugins: config.local.json not found", "warning", "module.server_info")
        return {"error": "Config file not found"}

    backend_list = config.get("plugins", [])
    log(f"GET /info/plugins: {len(backend_list)} declared backend plugin(s)", "debug", "module.server_info")
    backend_plugins_dir = Path("plugins")

    backend_plugins = []
    for p in backend_list:
        plugin_path = backend_plugins_dir / p
        if plugin_path.exists():
            plugin = load_plugin_meta(plugin_path, p, False)
            if plugin:
                backend_plugins.append(plugin)
        else:
            log(f"GET /info/plugins: declared backend plugin {p!r} directory not found", "debug", "module.server_info")

    log(f"GET /info/plugins: {len(backend_plugins)} loaded backend plugin(s)", "debug", "module.server_info")

    frontend_plugins_dir = Path("/frontend/src/plugins")
    frontend_plugins = scan_plugins(frontend_plugins_dir)
    log(f"GET /info/plugins: {len(frontend_plugins)} frontend plugin(s)", "debug", "module.server_info")

    return {
        "backend": backend_plugins,
        "frontend": frontend_plugins
    }

@router.get("/plugin-file")
def get_plugin_file(plugin: str, file: str, frontend: bool = False):
    log(f"GET /info/plugin-file plugin={plugin!r} file={file!r} frontend={frontend}", "debug", "module.server_info")
    base_path = get_plugin_base(plugin, frontend)
    target_file = (base_path / file).resolve()

    log(f"Resolved target file path: {target_file}", "debug", "module.server_info")

    try:
        base_resolved = base_path.resolve()
        target_file.resolve().relative_to(base_resolved)
        log(f"Path traversal check passed for {target_file}", "debug", "module.server_info")
    except Exception:
        log(f"Path traversal detected for plugin={plugin!r} file={file!r}, rejecting", "warning", "module.server_info")
        raise HTTPException(status_code=400, detail="Invalid file path")

    if not target_file.exists() or not target_file.is_file():
        log(f"Plugin file not found: {target_file}", "debug", "module.server_info")
        raise HTTPException(status_code=404, detail="File not found")

    mime_type, _ = mimetypes.guess_type(target_file)
    log(f"Serving plugin file: {target_file} mime_type={mime_type!r}", "debug", "module.server_info")
    with open(target_file, "rb") as f:
        encoded = base64.b64encode(f.read()).decode("utf-8")

    log(f"Plugin file encoded and ready to return: {target_file}", "debug", "module.server_info")
    return { "data": encoded, "mime_type": mime_type or "application/octet-stream" }