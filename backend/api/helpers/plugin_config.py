from pathlib import Path
from api.helpers.log import log
from api.helpers.config import (
    _deep_merge,
    _validate_against_types,
    _flatten_configs_from,
)
from api.helpers.plugins import get_backend_plugin_dir
import toml

_plugin_configs: dict[str, dict] = {}


def _plugin_dirs(plugin_key: str):
    base = get_backend_plugin_dir(plugin_key)
    return (
        base / "config",
        base / "config_types",
        base / "config_defaults",
    )


def _load_plugin_config(plugin_key: str) -> dict:
    log(f"Loading plugin config for plugin_key={plugin_key!r}", "debug", "plugin_config")

    if plugin_key in _plugin_configs:
        log(f"Plugin config for {plugin_key!r} already cached", "debug", "plugin_config")
        return _plugin_configs[plugin_key]

    config_dir, types_dir, defaults_dir = _plugin_dirs(plugin_key)

    for d in [config_dir, types_dir, defaults_dir]:
        d.mkdir(parents=True, exist_ok=True)

    default_files = {f.name: f for f in defaults_dir.glob("*.toml")}
    config_files_map = {f.name: f for f in config_dir.glob("*.toml")}
    all_names = set(default_files.keys()) | set(config_files_map.keys())

    loaded = {}

    for name in sorted(all_names):
        cfg_file = config_files_map.get(name) or default_files[name]
        config_data = toml.load(cfg_file)

        if name in config_files_map and name in default_files:
            default_data = toml.load(default_files[name])
            config_data = _deep_merge(default_data, config_data)

        type_file = types_dir / name
        if type_file.exists():
            type_data = toml.load(type_file)
            _validate_against_types(config_data, type_data, cfg_file=cfg_file)

        loaded[Path(name).stem] = config_data
        log(f"Plugin config file {name!r} loaded for plugin {plugin_key!r}", "debug", "plugin_config")

    _plugin_configs[plugin_key] = loaded
    return loaded


def get_plugin_config(plugin_key: str, key_path: str, default=None):
    """Return a plugin configuration value by dotted key path."""
    log(f"Getting plugin config: plugin={plugin_key!r} key={key_path!r} default={default!r}", "debug", "plugin_config")
    loaded = _load_plugin_config(plugin_key)
    parts = key_path.split(".")

    for config_name, config in loaded.items():
        val = config
        try:
            for part in parts:
                val = val[part]
            log(f"Plugin config key {key_path!r} found in {config_name!r}: {val!r}", "debug", "plugin_config")
            return val
        except (KeyError, TypeError):
            continue

    log(f"Plugin config key {key_path!r} not found for plugin {plugin_key!r}, returning default={default!r}", "debug", "plugin_config")
    return default


def reload_plugin_config(plugin_key: str):
    """Clear and reload cached configuration for a plugin."""
    log(f"Reloading plugin config for plugin_key={plugin_key!r}", "debug", "plugin_config")
    if plugin_key in _plugin_configs:
        del _plugin_configs[plugin_key]
    result = _load_plugin_config(plugin_key)
    log(f"Plugin config for {plugin_key!r} reloaded", "debug", "plugin_config")
    return result


def flatten_plugin_configs(plugin_key: str):
    """Return flattened plugin config metadata for UI rendering."""
    _, types_dir, defaults_dir = _plugin_dirs(plugin_key)
    loaded = _plugin_configs.get(plugin_key, {})
    return _flatten_configs_from(types_dir, defaults_dir, loaded)
