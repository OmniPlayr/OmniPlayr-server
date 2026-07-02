from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor, as_completed
import json
import os
import base64
import mimetypes

from urllib.parse import quote
from api.helpers.log import log
from api.helpers.plugins import get_backend_plugin_dir

router = APIRouter()

config_file = Path("config.local.json")

# This is just a simple function to load a JSON file
def load_json(path: Path):
    log(f"Loading JSON from {path}", "debug", "module.server_info")
    if not path.exists():
        log(f"JSON file not found: {path}", "debug", "module.server_info")
        return None
    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)
    log(f"JSON loaded from {path} with {len(data)} key(s)", "debug", "module.server_info")
    return data

# This is a helper to get the base path for a plugin
def get_plugin_base(plugin_key: str, frontend: bool):
    if frontend:
        bases = [Path("/frontend/src/plugins"), Path("frontend/src/plugins")]
        if os.environ.get("DEV_MODE", "").lower() == "true":
            bases.extend([Path("/frontend/src/local-plugins"), Path("frontend/src/local-plugins")])
        for base in bases:
            candidate = base / plugin_key
            if (candidate / "package.json").exists():
                return candidate
            if base.name == "local-plugins" and (base / "package.json").exists():
                return base
        return Path("/frontend/src/plugins") / plugin_key
    return get_backend_plugin_dir(plugin_key)

# This is a helper to load the meta for a plugin, so the folder, if its a frontend plugin, and its json from the package.json
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
        "folder": pkg.get("id") if frontend and plugin_key == "local-plugins" else plugin_key,
        "frontend": frontend,
        "package": pkg
    }

# This just scans for the plugins in the frontend folder
# Well it is just checking for plugins in a specific folder, but it assumes its the frontend folder
def scan_plugins(folder: Path):
    log(f"Scanning plugins in {folder}", "debug", "module.server_info")
    if not folder.exists():
        log(f"Plugin folder does not exist: {folder}", "debug", "module.server_info")
        return []

    candidates = [item for item in folder.iterdir() if item.is_dir()]
    if (folder / "package.json").exists():
        candidates.append(folder)

    with ThreadPoolExecutor() as executor:
        futures = {executor.submit(load_plugin_meta, item, item.name, True): item for item in candidates}
        result = [f.result() for f in as_completed(futures) if f.result()]

    log(f"Found {len(result)} frontend plugin(s) in {folder}", "debug", "module.server_info")
    return result

# This is to get information about the backend for the server
# It just sends the config.local.json file
@router.get("/server")
def get_setup_state():
    log("GET /info/server requested", "debug", "module.server_info")
    data = load_json(config_file)
    if not data:
        log("GET /info/server: config.local.json not found", "warning", "module.server_info")
        return {"error": "Config file not found"}
    log("GET /info/server: returning config data", "debug", "module.server_info")
    return data

# This is to check if the server is in safe mode
@router.get("/safe-mode")
def get_safe_mode_status():
    log("GET /info/safe-mode requested", "debug", "module.server_info")
    exists = os.path.exists(".safe_mode")
    log(f"GET /info/safe-mode: safe_mode={exists}", "debug", "module.server_info")
    return {"safe_mode": exists}

# This is to get all the installed plugins on the server
@router.get("/plugins")
def get_plugins():
    log("GET /info/plugins requested", "debug", "module.server_info")
    config = load_json(config_file)
    if not config:
        log("GET /info/plugins: config.local.json not found", "warning", "module.server_info")
        return {"error": "Config file not found"}

    backend_list = config.get("plugins", {})
    if isinstance(backend_list, list):
        backend_list = {name: "*" for name in backend_list}
    if not isinstance(backend_list, dict):
        backend_list = {}
    log(f"GET /info/plugins: {len(backend_list)} declared backend plugin(s)", "debug", "module.server_info")
    frontend_plugin_dirs = [Path("/frontend/src/plugins")]
    if os.environ.get("DEV_MODE", "").lower() == "true":
        frontend_plugin_dirs.append(Path("/frontend/src/local-plugins"))

    def load_backend_plugin(p, spec):
        plugin_path = get_backend_plugin_dir(p, spec)
        if not plugin_path.exists():
            log(f"GET /info/plugins: declared backend plugin {p!r} directory not found", "debug", "module.server_info")
            return None
        return load_plugin_meta(plugin_path, p, False)

    with ThreadPoolExecutor() as executor:
        backend_future = executor.submit(
            lambda: [r for r in (load_backend_plugin(p, spec) for p, spec in backend_list.items()) if r]
        )
        frontend_futures = [executor.submit(scan_plugins, folder) for folder in frontend_plugin_dirs]

        backend_plugins = backend_future.result()
        frontend_plugins = []
        seen_frontend = set()
        for future in frontend_futures:
            for plugin in future.result():
                folder = plugin.get("folder")
                if folder in seen_frontend:
                    continue
                seen_frontend.add(folder)
                frontend_plugins.append(plugin)

    log(f"GET /info/plugins: {len(backend_plugins)} loaded backend plugin(s)", "debug", "module.server_info")
    log(f"GET /info/plugins: {len(frontend_plugins)} frontend plugin(s)", "debug", "module.server_info")

    return {
        "backend": backend_plugins,
        "frontend": frontend_plugins
    }

# This is to get a file from a plugin, for example its readme, banner, or icon (Or any other file that is part of the plugin)
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
