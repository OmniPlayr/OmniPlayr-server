from __future__ import annotations
from pathlib import Path
import importlib.util
import sys
import json
from typing import Callable, Any

from fastapi import APIRouter

_registry: dict[str, "PluginBase"] = {}
_plugin_router = APIRouter()


class PluginBase:
    source_type: str = ""

    def get_stream(self, song_id: str):
        raise NotImplementedError

    def get_content_type(self, song_id: str) -> str:
        return "audio/mpeg"

    def get_file_size(self, song_id: str) -> int | None:
        return None

    def get_metadata(self, song_id: str) -> dict:
        return {}


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


def load_plugins():
    config_path = Path("config.json")
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
        spec.loader.exec_module(mod)

        if hasattr(mod, "setup"):
            mod.setup()