import toml
from pathlib import Path
import time
import threading

# You can change things in the config, and they will be safely requested over here
CONFIG_DIR = Path("config")

# These are the types for each config, for example one needs to be a string, you define that in here
CONFIG_TYPES_DIR = Path("config_types")

_loaded_configs = {}
_live_keys = {}

def _convert_type(value, type_str):
    type_str = type_str.lower()
    if type_str == "str":
        return str(value)
    elif type_str == "int":
        return int(value)
    elif type_str == "float":
        return float(value)
    elif type_str == "bool":
        if isinstance(value, bool):
            return value
        val = str(value).lower()
        if val in ("true", "1"):
            return True
        elif val in ("false", "0"):
            return False
        else:
            raise ValueError(f"Cannot convert '{value}' to bool")
    elif type_str == "list":
        if not isinstance(value, list):
            raise ValueError(f"Expected list, got {type(value).__name__}")
        return value
    elif type_str == "dict":
        if not isinstance(value, dict):
            raise ValueError(f"Expected dict, got {type(value).__name__}")
        return value
    else:
        raise ValueError(f"Unknown type: {type_str}")

def _validate_against_types(config_data, type_data, path="", cfg_file=None):
    for key, type_val in type_data.items():
        full_key = f"{path}.{key}" if path else key
        if key not in config_data:
            raise ValueError(f"Missing key '{full_key}'")
        val = config_data[key]
        if isinstance(type_val, dict):
            if not isinstance(val, dict):
                raise ValueError(f"Expected dict for '{full_key}'")
            _validate_against_types(val, type_val, path=full_key, cfg_file=cfg_file)
        else:
            liveupdate = False
            if isinstance(type_val, str) and "# liveupdate:true" in type_val:
                liveupdate = True
                type_val = type_val.split("#")[0].strip()
                _live_keys[full_key] = (cfg_file, cfg_file.stat().st_mtime)
            config_data[key] = _convert_type(val, type_val)

def load_configs():
    global _loaded_configs
    _loaded_configs = {}
    _live_keys.clear()
    for cfg_file in CONFIG_DIR.glob("*.toml"):
        config_data = toml.load(cfg_file)

        type_file = CONFIG_TYPES_DIR / cfg_file.name
        if type_file.exists():
            type_data = toml.load(type_file)
            _validate_against_types(config_data, type_data, cfg_file=cfg_file)

        _loaded_configs[cfg_file.stem] = config_data

def _reload_live_key(key_path):
    cfg_file, last_mtime = _live_keys[key_path]
    new_mtime = cfg_file.stat().st_mtime
    if new_mtime > last_mtime:
        config_data = toml.load(cfg_file)
        type_file = CONFIG_TYPES_DIR / cfg_file.name
        if type_file.exists():
            type_data = toml.load(type_file)
            _validate_against_types(config_data, type_data, cfg_file=cfg_file)
        _loaded_configs[cfg_file.stem] = config_data
        _live_keys[key_path] = (cfg_file, new_mtime)

# You call this function by doing for example get_config("auth.access_token_lifetime")
def get_config(key_path, default=None):
    if key_path in _live_keys:
        _reload_live_key(key_path)
    parts = key_path.split(".")
    for config in _loaded_configs.values():
        val = config
        try:
            for part in parts:
                val = val[part]
            return val
        except (KeyError, TypeError):
            continue
    return default