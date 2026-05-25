from __future__ import annotations
from pathlib import Path
import importlib.util
import sys
import json
import subprocess
import toml
from typing import Callable, Any

from fastapi import APIRouter
from api.helpers.log import log

_registry: dict[str, "PluginBase"] = {}
_plugin_router = APIRouter()

class PluginBase:
    source_type: str = ""

    def get_stream(self, song_id: str, account_id: int):
        raise NotImplementedError

    def get_content_type(self, song_id: str, account_id: int) -> str:
        return "audio/mpeg"

    def get_file_size(self, song_id: str, account_id: int) -> int | None:
        return None

    def get_metadata(self, song_id: str, account_id: int) -> dict:
        return {}

    def check_ownership(self, song_id: str, account_id: int) -> bool:
        return True
    
class _Api:
    def __init__(self, router: APIRouter):
        self._router = router

    def get(self, path: str, **kwargs) -> Callable:
        return self._router.get(path, **kwargs)

    def post(self, path: str, **kwargs) -> Callable:
        return self._router.post(path, **kwargs)

    def put(self, path: str, **kwargs) -> Callable:
        return self._router.put(path, **kwargs)

    def patch(self, path: str, **kwargs) -> Callable:
        return self._router.patch(path, **kwargs)

    def delete(self, path: str, **kwargs) -> Callable:
        return self._router.delete(path, **kwargs)


api = _Api(_plugin_router)


def register(plugin: PluginBase):
    log(f"Registering plugin source_type={plugin.source_type!r}", "debug", "plugins")
    if plugin.source_type in _registry:
        log(f"Plugin source_type={plugin.source_type!r} already registered, overwriting", "warning", "plugins")
    _registry[plugin.source_type] = plugin
    log(f"Plugin {plugin.source_type!r} registered successfully", "debug", "plugins")


def get_plugin(source_type: str) -> PluginBase | None:
    log(f"Looking up plugin for source_type={source_type!r}", "debug", "plugins")
    plugin = _registry.get(source_type)
    if plugin is None:
        log(f"No plugin found for source_type={source_type!r}", "debug", "plugins")
    else:
        log(f"Plugin found for source_type={source_type!r}: {type(plugin).__name__}", "debug", "plugins")
    return plugin


def get_plugin_router() -> APIRouter:
    log("Returning plugin router", "debug", "plugins")
    return _plugin_router


def _install_plugin_dependencies(plugin_key: str, plugin_dir: Path):
    log(f"Checking dependencies for plugin {plugin_key!r}", "debug", "plugins")
    pkg_file = plugin_dir / "package.json"
    if not pkg_file.exists():
        log(f"No package.json for plugin {plugin_key!r}, skipping dependency install", "debug", "plugins")
        return

    try:
        with open(pkg_file) as f:
            pkg = json.load(f)
    except Exception as e:
        log(f"Could not read {pkg_file} for plugin {plugin_key!r}: {e}", "warning", "plugins")
        return

    python_deps: dict = pkg.get("pythonDependencies", {})
    if not python_deps:
        log(f"No pythonDependencies in package.json for plugin {plugin_key!r}", "debug", "plugins")
        return

    log(f"Plugin {plugin_key!r} requires {len(python_deps)} python dependency/ies: {list(python_deps.keys())}", "debug", "plugins")

    def _to_pip_spec(name: str, ver: str) -> str:
        if ver in ("*", "^*", ""):
            return name
        if ver.startswith("^"):
            v = ver[1:]
            parts = v.split(".")
            try:
                major = int(parts[0])
                return f"{name}>={v},<{major + 1}.0.0"
            except (ValueError, IndexError):
                return f"{name}>={v}"
        if ver.startswith("~"):
            v = ver[1:]
            parts = v.split(".")
            try:
                minor = int(parts[1]) if len(parts) > 1 else 0
                return f"{name}>={v},<{parts[0]}.{minor + 1}.0"
            except (ValueError, IndexError):
                return f"{name}>={v}"
        return f"{name}{ver}"

    specs = [_to_pip_spec(name, ver) for name, ver in python_deps.items()]
    log(f"Installing pip specs for plugin {plugin_key!r}: {specs}", "debug", "plugins")

    try:
        result = subprocess.run(
            [sys.executable, "-m", "pip", "install", *specs],
            capture_output=True,
            text=True,
        )
        if result.returncode != 0:
            log(f"pip install failed for plugin {plugin_key!r}:\n{result.stderr}", "error", "plugins")
        else:
            log(f"Dependencies installed successfully for plugin {plugin_key!r}", "debug", "plugins")
    except subprocess.CalledProcessError as e:
        log(f"Failed to install dependencies for plugin {plugin_key!r}: {e}", "error", "plugins")


def load_plugins():
    log("Loading plugins", "debug", "plugins")
    plugins_dir = Path("plugins")
    plugins_dir.mkdir(exist_ok=True)

    config_path = Path("config.local.json")
    if not config_path.exists():
        log("config.local.json not found, no plugins to load", "debug", "plugins")
        return

    with open(config_path) as f:
        config = json.load(f)

    declared: dict = config.get("plugins", {})
    log(f"Found {len(declared)} declared plugin(s): {list(declared.keys())}", "debug", "plugins")

    for plugin_key in declared:
        log(f"Attempting to load plugin {plugin_key!r}", "debug", "plugins")
        plugin_dir = plugins_dir / plugin_key
        init_file = plugin_dir / "__init__.py"
        if not init_file.exists():
            log(f"Plugin {plugin_key!r} has no __init__.py at {init_file}, skipping", "warning", "plugins")
            continue

        _install_plugin_dependencies(plugin_key, plugin_dir)

        module_name = f"plugins.{plugin_key.replace('@', '_').replace('-', '_')}"
        log(f"Loading plugin {plugin_key!r} as module {module_name!r}", "debug", "plugins")

        spec = importlib.util.spec_from_file_location(
            module_name,
            init_file,
            submodule_search_locations=[str(plugin_dir)],
        )
        if spec is None or spec.loader is None:
            log(f"Could not create module spec for plugin {plugin_key!r}, skipping", "error", "plugins")
            continue

        mod = importlib.util.module_from_spec(spec)
        mod.__package__ = module_name
        sys.modules[module_name] = mod

        from api.helpers.plugin_db import request_db_access as _request_access
        mod.request_db_access = lambda **kwargs: _request_access(plugin_key, **kwargs)

        try:
            spec.loader.exec_module(mod)
            log(f"Plugin module {plugin_key!r} executed successfully", "debug", "plugins")
        except Exception as e:
            log(f"Failed to load plugin {plugin_key!r}: {e}", "error", "plugins")
            sys.modules.pop(module_name, None)
            continue

        if hasattr(mod, "setup"):
            log(f"Calling setup() for plugin {plugin_key!r}", "debug", "plugins")
            try:
                mod.setup()
                log(f"Plugin {plugin_key!r} setup() completed", "debug", "plugins")
            except Exception as e:
                log(f"Plugin {plugin_key!r} setup() failed: {e}", "error", "plugins")
        else:
            log(f"Plugin {plugin_key!r} has no setup(), skipping", "debug", "plugins")

    log(f"Plugin loading complete. Registered plugins: {list(_registry.keys())}", "debug", "plugins")