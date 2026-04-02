from pathlib import Path
import toml

_plugin_configs: dict = {}

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
    if plugin_key in _plugin_configs:
        del _plugin_configs[plugin_key]
    return _load_plugin_config(plugin_key)