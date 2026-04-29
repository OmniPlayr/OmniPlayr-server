import toml
from pathlib import Path
import time
import threading

# You can change things in the config, and they will be safely requested over here
CONFIG_DIR = Path("config")

# These are the types for each config, for example one needs to be a string, you define that in here.
CONFIG_TYPES_DIR = Path("config_types")

_loaded_configs = {}
_live_keys = {}

def _convert_type(value, type_str):
    from api.helpers.log import log
    type_str = type_str.lower()
    log(f"Converting value={value!r} to type={type_str!r}", "debug", "config")
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
            log(f"Cannot convert {value!r} to bool", "error", "config")
            raise ValueError(f"Cannot convert '{value}' to bool")
    elif type_str == "list":
        if not isinstance(value, list):
            log(f"Expected list, got {type(value).__name__}", "error", "config")
            raise ValueError(f"Expected list, got {type(value).__name__}")
        return value
    elif type_str == "dict":
        if not isinstance(value, dict):
            log(f"Expected dict, got {type(value).__name__}", "error", "config")
            raise ValueError(f"Expected dict, got {type(value).__name__}")
        return value
    else:
        log(f"Unknown type string: {type_str!r}", "error", "config")
        raise ValueError(f"Unknown type: {type_str}")

def _validate_against_types(config_data, type_data, path="", cfg_file=None):
    from api.helpers.log import log
    log(f"Validating config at path={path!r} against types", "debug", "config")
    for key, type_val in type_data.items():
        full_key = f"{path}.{key}" if path else key
        if key not in config_data:
            log(f"Missing required config key: {full_key!r}", "critical", "config")
            raise ValueError(f"Missing key '{full_key}'")
        val = config_data[key]
        if isinstance(type_val, dict):
            if not isinstance(val, dict):
                log(f"Expected dict for key {full_key!r}, got {type(val).__name__}", "error", "config")
                raise ValueError(f"Expected dict for '{full_key}'")
            _validate_against_types(val, type_val, path=full_key, cfg_file=cfg_file)
        else:
            liveupdate = False
            if isinstance(type_val, str) and "# liveupdate:true" in type_val:
                liveupdate = True
                type_val = type_val.split("#")[0].strip()
                log(f"Key {full_key!r} is marked as liveupdate", "debug", "config")
                _live_keys[full_key] = (cfg_file, cfg_file.stat().st_mtime)
            config_data[key] = _convert_type(val, type_val)
            log(f"Key {full_key!r} validated and converted to type={type_val!r}", "debug", "config")

def load_configs():
    from api.helpers.log import log
    global _loaded_configs
    _loaded_configs = {}
    _live_keys.clear()
    log(f"Loading configs from directory: {CONFIG_DIR}", "debug", "config")
    config_files = list(CONFIG_DIR.glob("*.toml"))
    log(f"Found {len(config_files)} config file(s): {[f.name for f in config_files]}", "debug", "config")
    for cfg_file in config_files:
        log(f"Loading config file: {cfg_file.name}", "debug", "config")
        config_data = toml.load(cfg_file)

        type_file = CONFIG_TYPES_DIR / cfg_file.name
        if type_file.exists():
            log(f"Type file found for {cfg_file.name}, validating", "debug", "config")
            type_data = toml.load(type_file)
            _validate_against_types(config_data, type_data, cfg_file=cfg_file)
        else:
            log(f"No type file found for {cfg_file.name}, skipping validation", "debug", "config")

        _loaded_configs[cfg_file.stem] = config_data
        log(f"Config {cfg_file.stem!r} loaded successfully", "debug", "config")

    log(f"All configs loaded: {list(_loaded_configs.keys())}", "debug", "config")

def _reload_live_key(key_path):
    from api.helpers.log import log
    cfg_file, last_mtime = _live_keys[key_path]
    new_mtime = cfg_file.stat().st_mtime
    log(f"Checking live key {key_path!r}: last_mtime={last_mtime} new_mtime={new_mtime}", "debug", "config")
    if new_mtime > last_mtime:
        log(f"Live key {key_path!r} changed, reloading config file {cfg_file.name}", "debug", "config")
        config_data = toml.load(cfg_file)
        type_file = CONFIG_TYPES_DIR / cfg_file.name
        if type_file.exists():
            type_data = toml.load(type_file)
            _validate_against_types(config_data, type_data, cfg_file=cfg_file)
        _loaded_configs[cfg_file.stem] = config_data
        _live_keys[key_path] = (cfg_file, new_mtime)
        log(f"Live key {key_path!r} reloaded successfully", "debug", "config")
    else:
        log(f"Live key {key_path!r} unchanged, no reload needed", "debug", "config")

# You call this function by doing for example get_config("auth.access_token_lifetime")
def get_config(key_path, default=None):
    from api.helpers.log import log
    log(f"Getting config key={key_path!r} default={default!r}", "debug", "config")
    if key_path in _live_keys:
        log(f"Key {key_path!r} is a live key, checking for updates", "debug", "config")
        _reload_live_key(key_path)
    parts = key_path.split(".")
    for config_name, config in _loaded_configs.items():
        val = config
        try:
            for part in parts:
                val = val[part]
            log(f"Config key={key_path!r} found in {config_name!r}: {val!r}", "debug", "config")
            return val
        except (KeyError, TypeError):
            continue
    log(f"Config key={key_path!r} not found in any config, returning default={default!r}", "debug", "config")
    return default