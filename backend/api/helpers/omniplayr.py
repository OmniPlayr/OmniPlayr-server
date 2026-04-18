from __future__ import annotations
from pathlib import Path
import importlib.util
import sys
import json
import subprocess
import toml
from typing import Callable, Any

from fastapi import APIRouter

_registry: dict[str, "PluginBase"] = {}
_plugin_router = APIRouter()

_plugin_configs: dict[str, dict] = {}

def _load_plugin_config(plugin_key: str) -> dict:
    if plugin_key in _plugin_configs:
        return _plugin_configs[plugin_key]

    plugin_dir = Path("plugins") / plugin_key
    config_file = plugin_dir / "config.toml"

    if not config_file.exists():
        _plugin_configs[plugin_key] = {}
        return {}

    data = toml.load(config_file)
    _plugin_configs[plugin_key] = data
    return data


def get_plugin_config(plugin_key: str, key_path: str, default=None):
    config = _load_plugin_config(plugin_key)
    parts = key_path.split(".")
    val = config
    try:
        for part in parts:
            val = val[part]
        return val
    except (KeyError, TypeError):
        return default


def reload_plugin_config(plugin_key: str):
    _plugin_configs.pop(plugin_key, None)
    return _load_plugin_config(plugin_key)

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
    _registry[plugin.source_type] = plugin


def get_plugin(source_type: str) -> PluginBase | None:
    return _registry.get(source_type)


def get_plugin_router() -> APIRouter:
    return _plugin_router


def _install_plugin_dependencies(plugin_key: str, plugin_dir: Path):
    pkg_file = plugin_dir / "package.json"
    if not pkg_file.exists():
        return

    try:
        with open(pkg_file) as f:
            pkg = json.load(f)
    except Exception as e:
        print(f"[WARN] Could not read {pkg_file}: {e}", flush=True)
        return

    python_deps: dict = pkg.get("pythonDependencies", {})
    if not python_deps:
        return

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

    try:
        result = subprocess.run(
            [sys.executable, "-m", "pip", "install", *specs],
            capture_output=True,
            text=True,
        )
        if result.returncode != 0:
            print(f"[ERROR] pip failed for '{plugin_key}':\n{result.stderr}", flush=True)
        else:
            print(f"[OK] installed deps for '{plugin_key}'", flush=True)
    except subprocess.CalledProcessError as e:
        print(f"[ERROR] Failed to install deps for '{plugin_key}': {e}", flush=True)


def load_plugins():
    config_path = Path("config.local.json")
    if not config_path.exists():
        return

    with open(config_path) as f:
        config = json.load(f)

    plugins_dir = Path("plugins")
    declared: dict = config.get("plugins", {})

    for plugin_key in declared:
        plugin_dir = plugins_dir / plugin_key
        init_file = plugin_dir / "__init__.py"
        if not init_file.exists():
            continue

        _install_plugin_dependencies(plugin_key, plugin_dir)

        module_name = f"plugins.{plugin_key.replace('@', '_').replace('-', '_')}"

        spec = importlib.util.spec_from_file_location(
            module_name,
            init_file,
            submodule_search_locations=[str(plugin_dir)],
        )
        if spec is None or spec.loader is None:
            continue

        mod = importlib.util.module_from_spec(spec)
        mod.__package__ = module_name
        sys.modules[module_name] = mod

        try:
            spec.loader.exec_module(mod)
        except Exception as e:
            print(f"[ERROR] Failed to load plugin '{plugin_key}': {e}", flush=True)
            sys.modules.pop(module_name, None)
            continue

        if hasattr(mod, "setup"):
            try:
                mod.setup()
            except Exception as e:
                print(f"[ERROR] Plugin '{plugin_key}' setup() failed: {e}", flush=True)