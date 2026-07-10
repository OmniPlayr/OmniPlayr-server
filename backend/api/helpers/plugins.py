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
    """Base class for backend playback source plugins."""

    source_type: str = ""

    def get_stream(self, song_id: str, account_id: int):
        """Return a stream or file-like object for a song and account."""

        raise NotImplementedError

    def get_content_type(self, song_id: str, account_id: int) -> str:
        """Return the MIME type for a song stream."""

        return "audio/mpeg"

    def get_file_size(self, song_id: str, account_id: int) -> int | None:
        """Return the byte size for a song stream, if known."""

        return None

    def get_metadata(self, song_id: str, account_id: int) -> dict:
        """Return metadata for a song visible to the given account."""

        return {}

    def check_ownership(self, song_id: str, account_id: int) -> bool:
        """Return whether the given account may access the song."""

        return True
    
class _Api:
    """Thin wrapper around the shared plugin API router."""

    def __init__(self, router: APIRouter):
        """Create a route helper around a FastAPI router."""

        self._router = router

    def get(self, path: str, **kwargs) -> Callable:
        """Register a GET route for a backend plugin."""

        return self._router.get(path, **kwargs)

    def post(self, path: str, **kwargs) -> Callable:
        """Register a POST route for a backend plugin."""

        return self._router.post(path, **kwargs)

    def put(self, path: str, **kwargs) -> Callable:
        """Register a PUT route for a backend plugin."""

        return self._router.put(path, **kwargs)

    def patch(self, path: str, **kwargs) -> Callable:
        """Register a PATCH route for a backend plugin."""

        return self._router.patch(path, **kwargs)

    def delete(self, path: str, **kwargs) -> Callable:
        """Register a DELETE route for a backend plugin."""

        return self._router.delete(path, **kwargs)


api = _Api(_plugin_router)


def register(plugin: PluginBase):
    """Register a backend playback source plugin instance."""

    log(f"Registering plugin source_type={plugin.source_type!r}", "debug", "plugins")
    if plugin.source_type in _registry:
        log(f"Plugin source_type={plugin.source_type!r} already registered, overwriting", "warning", "plugins")
    _registry[plugin.source_type] = plugin
    log(f"Plugin {plugin.source_type!r} registered successfully", "debug", "plugins")


def get_plugin(source_type: str) -> PluginBase | None:
    """Return the registered plugin for a source type, if any."""

    log(f"Looking up plugin for source_type={source_type!r}", "debug", "plugins")
    plugin = _registry.get(source_type)
    if plugin is None:
        log(f"No plugin found for source_type={source_type!r}", "debug", "plugins")
    else:
        log(f"Plugin found for source_type={source_type!r}: {type(plugin).__name__}", "debug", "plugins")
    return plugin


def get_plugin_router() -> APIRouter:
    """Return the shared FastAPI router used for plugin routes."""

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


def _is_local_plugin_spec(plugin_spec: dict[str, Any]) -> bool:
    version = plugin_spec.get("version")
    return isinstance(version, str) and version.lower() == "local"


def _plugin_dir_exists(path: Path) -> bool:
    return (path / "__init__.py").exists() or (path / "package.json").exists()


def _local_plugin_candidates(root: Path, plugin_key: str) -> list[Path]:
    return [
        root / plugin_key / "backend",
        root / plugin_key,
        root / "backend",
        root,
    ]


def _candidate_plugin_dirs(plugin_key: str, plugin_spec: dict[str, Any]) -> list[Path]:
    candidates: list[Path] = []
    dev_mode = os.environ.get("DEV_MODE", "").lower() == "true"
    configured_path = plugin_spec.get("path")
    if dev_mode and isinstance(configured_path, str) and configured_path.strip():
        candidates.extend(_local_plugin_candidates(Path(configured_path.strip()), plugin_key))

    if dev_mode and _is_local_plugin_spec(plugin_spec):
        for root in (Path("/external-backend-plugins"), Path("/external-plugins")):
            candidates.extend(_local_plugin_candidates(root, plugin_key))

    candidates.extend([
        Path("plugins") / plugin_key,
        Path("backend/plugins") / plugin_key,
    ])
    if dev_mode:
        candidates.extend(_local_plugin_candidates(Path("/local-plugins"), plugin_key))
        candidates.extend(_local_plugin_candidates(Path("/local-plugins/backend"), plugin_key))

    seen: set[str] = set()
    unique: list[Path] = []
    for path in candidates:
        key = str(path)
        if key not in seen:
            unique.append(path)
            seen.add(key)
    return unique


def get_backend_plugin_dir(plugin_key: str, plugin_spec: Any = None) -> Path:
    """Return the filesystem directory for a backend plugin key."""

    spec = _as_plugin_spec(plugin_spec)
    for path in _candidate_plugin_dirs(plugin_key, spec):
        if _plugin_dir_exists(path):
            return path
    return Path("plugins") / plugin_key


def get_backend_plugin_reload_dirs(config_path: Path | str = "config.local.json") -> list[Path]:
    """Return resolved local plugin directories that should trigger a dev reload."""

    if os.environ.get("DEV_MODE", "").lower() != "true":
        return []

    config_file = Path(config_path)
    if not config_file.exists():
        return []

    try:
        with open(config_file) as f:
            config = json.load(f)
    except Exception as e:
        log(f"Could not read {config_file} for plugin reload paths: {e}", "warning", "plugins")
        return []

    declared = config.get("plugins", {})
    if isinstance(declared, list):
        declared = {name: "*" for name in declared}
    if not isinstance(declared, dict):
        return []

    reload_dirs: list[Path] = []
    seen: set[str] = set()
    for plugin_key, plugin_spec in declared.items():
        spec = _as_plugin_spec(plugin_spec)
        if not (_is_local_plugin_spec(spec) or spec.get("path")):
            continue

        plugin_dir = get_backend_plugin_dir(plugin_key, spec)
        if not (plugin_dir / "__init__.py").exists():
            continue

        resolved = plugin_dir.resolve()
        key = str(resolved)
        if key in seen:
            continue
        seen.add(key)
        reload_dirs.append(resolved)

    return reload_dirs


def load_plugins():
    """Load configured backend plugins into the current server process."""

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
        from omniplayr.plugins import _register_plugin_module
        _register_plugin_module(module_name, plugin_key)
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
