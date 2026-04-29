from pathlib import Path
from api.helpers.log import log
import toml

_plugin_configs: dict = {}

def _load_plugin_config(plugin_key: str) -> dict:
    log(f"Loading plugin config for plugin_key={plugin_key!r}", "debug", "plugin_config")
    if plugin_key in _plugin_configs:
        log(f"Plugin config for {plugin_key!r} already cached, returning cached", "debug", "plugin_config")
        return _plugin_configs[plugin_key]

    plugin_dir = Path("plugins") / plugin_key
    config_file = plugin_dir / "config.toml"

    if not config_file.exists():
        log(f"No config.toml found for plugin {plugin_key!r} at {config_file}, returning empty config", "debug", "plugin_config")
        _plugin_configs[plugin_key] = {}
        return {}

    log(f"Reading config.toml for plugin {plugin_key!r}", "debug", "plugin_config")
    data = toml.load(config_file)
    _plugin_configs[plugin_key] = data
    log(f"Plugin config for {plugin_key!r} loaded with {len(data)} top-level key(s)", "debug", "plugin_config")
    return data


def get_plugin_config(plugin_key: str, key_path: str, default=None):
    log(f"Getting plugin config: plugin={plugin_key!r} key={key_path!r} default={default!r}", "debug", "plugin_config")
    config = _load_plugin_config(plugin_key)
    parts = key_path.split(".")
    val = config
    try:
        for part in parts:
            val = val[part]
        log(f"Plugin config key {key_path!r} found for plugin {plugin_key!r}: {val!r}", "debug", "plugin_config")
        return val
    except (KeyError, TypeError):
        log(f"Plugin config key {key_path!r} not found for plugin {plugin_key!r}, returning default={default!r}", "debug", "plugin_config")
        return default


def reload_plugin_config(plugin_key: str):
    log(f"Reloading plugin config for plugin_key={plugin_key!r}", "debug", "plugin_config")
    if plugin_key in _plugin_configs:
        log(f"Evicting cached config for plugin {plugin_key!r}", "debug", "plugin_config")
        del _plugin_configs[plugin_key]
    result = _load_plugin_config(plugin_key)
    log(f"Plugin config for {plugin_key!r} reloaded", "debug", "plugin_config")
    return result