from __future__ import annotations
from pathlib import Path
import importlib.util
import os
import sys
import json
import subprocess
import toml
from typing import Callable, Any
import importlib.metadata
from fastapi import APIRouter
from api.helpers.log import log
from api.helpers.plugin_functions import (
    PluginFunctions,
    call,
    expose,
    is_installed,
    has_function,
    mark_plugin_loaded,
    remove_plugin,
)

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

def _is_satisfied(name: str, full_spec: str) -> bool:
    try:
        installed = importlib.metadata.version(name)
    except importlib.metadata.PackageNotFoundError:
        return False
    constraint = full_spec[len(name):]
    if not constraint:
        return True
    try:
        from packaging.version import Version
        from packaging.specifiers import SpecifierSet
        return Version(installed) in SpecifierSet(constraint)
    except Exception:
        return False


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

    specs = {name: _to_pip_spec(name, ver) for name, ver in python_deps.items()}
    to_install = [spec for name, spec in specs.items() if not _is_satisfied(name, spec)]

    if not to_install:
        log(f"All dependencies already satisfied for plugin {plugin_key!r}", "debug", "plugins")
        return

    log(f"Plugin {plugin_key!r} needs {len(to_install)} dep(s): {to_install}", "debug", "plugins")

    try:
        result = subprocess.run(
            [sys.executable, "-m", "pip", "install", *to_install],
            capture_output=True,
            text=True,
        )
        if result.returncode != 0:
            log(f"pip install failed for plugin {plugin_key!r}:\n{result.stderr}", "error", "plugins")
        else:
            log(f"Dependencies installed successfully for plugin {plugin_key!r}", "debug", "plugins")
    except subprocess.CalledProcessError as e:
        log(f"Failed to install dependencies for plugin {plugin_key!r}: {e}", "error", "plugins")


def _as_plugin_spec(value: Any) -> dict[str, Any]:
    if isinstance(value, dict):
        return value
    return {"version": value}


def _candidate_plugin_dirs(plugin_key: str, plugin_spec: dict[str, Any]) -> list[Path]:
    candidates: list[Path] = []
    dev_mode = os.environ.get("DEV_MODE", "").lower() == "true"
    configured_path = plugin_spec.get("path")
    if dev_mode and isinstance(configured_path, str) and configured_path.strip():
        candidates.append(Path(configured_path.strip()))

    candidates.extend([
        Path("plugins") / plugin_key,
        Path("backend/plugins") / plugin_key,
    ])
    if dev_mode:
        local_root = Path("/local-plugins/backend")
        candidates.extend([
            local_root / plugin_key,
            local_root,
        ])

    seen: set[str] = set()
    unique: list[Path] = []
    for path in candidates:
        key = str(path)
        if key not in seen:
            unique.append(path)
            seen.add(key)
    return unique


def get_backend_plugin_dir(plugin_key: str, plugin_spec: Any = None) -> Path:
    spec = _as_plugin_spec(plugin_spec)
    for path in _candidate_plugin_dirs(plugin_key, spec):
        if (path / "__init__.py").exists() or (path / "package.json").exists():
            return path
    return Path("plugins") / plugin_key


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

    declared = config.get("plugins", {})
    if isinstance(declared, list):
        declared = {name: "*" for name in declared}
    if not isinstance(declared, dict):
        declared = {}
    log(f"Found {len(declared)} declared plugin(s): {list(declared.keys())}", "debug", "plugins")

    for plugin_key, plugin_spec in declared.items():
        log(f"Attempting to load plugin {plugin_key!r}", "debug", "plugins")
        plugin_dir = get_backend_plugin_dir(plugin_key, plugin_spec)
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
        mod.plugins = PluginFunctions(plugin_key)

        mod.expose_function = lambda name, function: expose(
            plugin_key, name, function
        )
        mod.is_plugin_available = is_installed
        mod.is_plugin_function_available = has_function
        mod.call_plugin_function = call

        try:
            spec.loader.exec_module(mod)
            mark_plugin_loaded(plugin_key)
            log(f"Plugin module {plugin_key!r} executed successfully", "debug", "plugins")
        except Exception as e:
            log(f"Failed to load plugin {plugin_key!r}: {e}", "error", "plugins")
            remove_plugin(plugin_key)
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
