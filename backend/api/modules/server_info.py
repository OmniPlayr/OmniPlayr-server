from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse
from pathlib import Path
import json
import os
import base64
import mimetypes

from urllib.parse import quote

router = APIRouter()

config_file = Path("config.local.json")


def load_json(path: Path):
    if not path.exists():
        return None
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def get_plugin_base(plugin_key: str, frontend: bool):
    if frontend:
        return Path("frontend/src/plugins") / plugin_key
    return Path("plugins") / plugin_key


def load_plugin_meta(plugin_path: Path, plugin_key: str, frontend: bool):
    package_file = plugin_path / "package.json"
    if not package_file.exists():
        return None

    with open(package_file, "r", encoding="utf-8") as f:
        pkg = json.load(f)

    return {
        "folder": plugin_key,
        "frontend": frontend,
        "package": pkg
    }


def scan_plugins(folder: Path):
    if not folder.exists():
        return []

    result = []
    for item in folder.iterdir():
        if item.is_dir():
            plugin = load_plugin_meta(item, item.name, True)
            if plugin:
                result.append(plugin)
    return result


@router.get("/server")
def get_setup_state():
    data = load_json(config_file)
    if not data:
        return {"error": "Config file not found"}
    return data


@router.get("/safe-mode")
def get_safe_mode_status():
    return {"safe_mode": os.path.exists(".safe_mode")}


@router.get("/plugins")
def get_plugins():
    config = load_json(config_file)
    if not config:
        return {"error": "Config file not found"}

    backend_list = config.get("plugins", [])
    backend_plugins_dir = Path("plugins")

    backend_plugins = []
    for p in backend_list:
        plugin_path = backend_plugins_dir / p
        if plugin_path.exists():
            plugin = load_plugin_meta(plugin_path, p, False)
            if plugin:
                backend_plugins.append(plugin)

    frontend_plugins_dir = Path("/frontend/src/plugins")
    frontend_plugins = scan_plugins(frontend_plugins_dir)

    return {
        "backend": backend_plugins,
        "frontend": frontend_plugins
    }

@router.get("/plugin-file")
def get_plugin_file(plugin: str, file: str, frontend: bool = False):
    base_path = get_plugin_base(plugin, frontend)
    target_file = (base_path / file).resolve()

    try:
        base_resolved = base_path.resolve()
        target_file.resolve().relative_to(base_resolved)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid file path")

    if not target_file.exists() or not target_file.is_file():
        raise HTTPException(status_code=404, detail="File not found")

    mime_type, _ = mimetypes.guess_type(target_file)
    with open(target_file, "rb") as f:
        encoded = base64.b64encode(f.read()).decode("utf-8")

    return { "data": encoded, "mime_type": mime_type or "application/octet-stream" }