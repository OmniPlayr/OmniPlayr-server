import toml
import re
from pathlib import Path

# You can change things in the config, and they will be safely requested over here
CONFIG_DIR = Path("config")

# These are the types for each config, for example one needs to be a string, you define that in here.
CONFIG_TYPES_DIR = Path("config_types")

# This is the folder you can define the defaults for each config file in
CONFIG_DEFAULTS_DIR = Path("config_defaults")

FRONTEND_CONFIG_DIR = Path("/frontend/src/config")
FRONTEND_CONFIG_TYPES_DIR = Path("/frontend/src/config_types")
FRONTEND_CONFIG_DEFAULTS_DIR = Path("/frontend/src/config_defaults")

_loaded_configs = {}
_live_keys = {}


def _ensure_dirs():
    from api.helpers.log import log
    for d in [CONFIG_DIR, CONFIG_TYPES_DIR, CONFIG_DEFAULTS_DIR]:
        try:
            d.mkdir(parents=True, exist_ok=True)
        except Exception as e:
            log(f"Cannot create directory {d}: {e}", "critical", "config")
            raise RuntimeError(f"Cannot create required directory '{d}': {e}")


def _deep_merge(base, override):
    result = dict(base)
    for key, val in override.items():
        if key in result and isinstance(result[key], dict) and isinstance(val, dict):
            result[key] = _deep_merge(result[key], val)
        else:
            result[key] = val
    return result


def _parse_type_string(type_val):
    parsed = {
        "base_type": None,
        "liveupdate": False,
        "comment": None,
        "minmax": None,
        "step": None,
        "in_values": None,
    }

    if "# liveupdate:true" in type_val:
        parsed["liveupdate"] = True
        type_val = type_val.replace("# liveupdate:true", "").strip()

    comment_match = re.search(r"#\s*comment:\s*(.+)", type_val)
    if comment_match:
        parsed["comment"] = comment_match.group(1).strip()
        type_val = type_val[: comment_match.start()].strip()

    minmax_match = re.search(r"<minmax\s*\[([^\]]+)\]\s*step\s*\[([^\]]+)\]>", type_val)
    if minmax_match:
        min_val, max_val = [float(x.strip()) for x in minmax_match.group(1).split(",")]
        step_val = float(minmax_match.group(2).strip())
        parsed["minmax"] = (min_val, max_val)
        parsed["step"] = step_val
        type_val = type_val[: minmax_match.start()].strip()

    in_match = re.search(r"<in\s*\[([^\]]+)\]>", type_val)
    if in_match:
        in_str = in_match.group(1)
        parsed["in_values"] = [v.strip().strip("'\"") for v in in_str.split(",")]
        type_val = type_val[: in_match.start()].strip()

    parsed["base_type"] = type_val.strip().lower()
    return parsed


def _convert_type(value, type_str):
    from api.helpers.log import log
    parsed = _parse_type_string(type_str)
    base_type = parsed["base_type"]
    log(f"Converting value={value!r} to type={base_type!r}", "debug", "config")

    if base_type == "str":
        converted = str(value)
    elif base_type == "int":
        converted = int(value)
    elif base_type == "float":
        converted = float(value)
        if parsed["minmax"] is not None:
            min_val, max_val = parsed["minmax"]
            if not (min_val <= converted <= max_val):
                log(f"Value {converted} out of range [{min_val}, {max_val}]", "error", "config")
                raise ValueError(f"Value {converted} out of range [{min_val}, {max_val}]")
    elif base_type == "bool":
        if isinstance(value, bool):
            converted = value
        else:
            val = str(value).lower()
            if val in ("true", "1"):
                converted = True
            elif val in ("false", "0"):
                converted = False
            else:
                log(f"Cannot convert {value!r} to bool", "error", "config")
                raise ValueError(f"Cannot convert '{value}' to bool")
    elif base_type == "list":
        if not isinstance(value, list):
            log(f"Expected list, got {type(value).__name__}", "error", "config")
            raise ValueError(f"Expected list, got {type(value).__name__}")
        converted = value
    elif base_type == "dict":
        if not isinstance(value, dict):
            log(f"Expected dict, got {type(value).__name__}", "error", "config")
            raise ValueError(f"Expected dict, got {type(value).__name__}")
        converted = value
    elif base_type == "dir":
        dir_path = Path(str(value))
        try:
            dir_path.mkdir(parents=True, exist_ok=True)
        except Exception as e:
            log(f"Cannot create directory {dir_path}: {e}", "critical", "config")
            raise RuntimeError(f"Cannot create directory '{dir_path}': {e}")
        converted = dir_path
    else:
        log(f"Unknown type string: {base_type!r}", "error", "config")
        raise ValueError(f"Unknown type: {base_type}")

    if parsed["in_values"] is not None:
        str_converted = str(converted)
        if str_converted not in parsed["in_values"]:
            log(f"Value {str_converted!r} not in allowed values {parsed['in_values']}", "error", "config")
            raise ValueError(f"Value '{str_converted}' not in allowed values {parsed['in_values']}")

    return converted


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
            parsed = _parse_type_string(type_val)
            if parsed["liveupdate"]:
                log(f"Key {full_key!r} is marked as liveupdate", "debug", "config")
                _live_keys[full_key] = (cfg_file, cfg_file.stat().st_mtime)
            config_data[key] = _convert_type(val, type_val)
            log(f"Key {full_key!r} validated and converted to type={parsed['base_type']!r}", "debug", "config")


def load_configs():
    from api.helpers.log import log
    global _loaded_configs
    _loaded_configs = {}
    _live_keys.clear()

    _ensure_dirs()

    log(f"Loading configs from directory: {CONFIG_DIR}", "debug", "config")

    default_files = {f.name: f for f in CONFIG_DEFAULTS_DIR.glob("*.toml")}
    config_files_map = {f.name: f for f in CONFIG_DIR.glob("*.toml")}
    all_names = set(default_files.keys()) | set(config_files_map.keys())

    log(f"Found {len(all_names)} config file(s): {sorted(all_names)}", "debug", "config")

    for name in sorted(all_names):
        cfg_file = config_files_map.get(name) or default_files[name]
        log(f"Loading config file: {cfg_file.name}", "debug", "config")

        config_data = toml.load(cfg_file)

        if name in config_files_map and name in default_files:
            default_data = toml.load(default_files[name])
            config_data = _deep_merge(default_data, config_data)

        type_file = CONFIG_TYPES_DIR / name
        if type_file.exists():
            log(f"Type file found for {name}, validating", "debug", "config")
            type_data = toml.load(type_file)
            _validate_against_types(config_data, type_data, cfg_file=cfg_file)
        else:
            log(f"No type file found for {name}, skipping validation", "debug", "config")

        stem = Path(name).stem
        _loaded_configs[stem] = config_data
        log(f"Config {stem!r} loaded successfully", "debug", "config")

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
    configs_ready = bool(_loaded_configs)
    if configs_ready:
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
            if configs_ready:
                log(f"Config key={key_path!r} found in {config_name!r}: {val!r}", "debug", "config")
            return val
        except (KeyError, TypeError):
            continue
    if configs_ready:
        log(f"Config key={key_path!r} not found in any config, returning default={default!r}", "debug", "config")
    return default


def _flatten_configs_from(types_dir, defaults_dir, loaded_configs):
    results = []

    if not types_dir.exists():
        return results

    for file in types_dir.glob("*.toml"):
        try:
            type_data = toml.load(file)
        except Exception:
            continue

        default_data = {}
        default_file = defaults_dir / file.name
        if default_file.exists():
            try:
                default_data = toml.load(default_file)
            except Exception:
                pass

        config_data = loaded_configs.get(file.stem, {})

        def walk(prefix, type_node, config_node, default_node):
            for key, val in type_node.items():
                full_key = f"{prefix}.{key}" if prefix else key

                if isinstance(val, dict):
                    walk(
                        full_key,
                        val,
                        config_node.get(key, {}),
                        default_node.get(key, {})
                    )
                else:
                    parsed = _parse_type_string(val)

                    results.append({
                        "key": full_key,
                        "type": parsed["base_type"],
                        "value": config_node.get(key),
                        "default": default_node.get(key),
                        "comment": parsed["comment"],
                        "liveupdate": parsed["liveupdate"],
                        "min": parsed["minmax"][0] if parsed["minmax"] else None,
                        "max": parsed["minmax"][1] if parsed["minmax"] else None,
                        "step": parsed["step"],
                        "in_values": parsed["in_values"],
                        "file": file.stem
                    })

        walk("", type_data, config_data, default_data)

    return results


def flatten_configs():
    return _flatten_configs_from(CONFIG_TYPES_DIR, CONFIG_DEFAULTS_DIR, _loaded_configs)


def flatten_frontend_configs():
    loaded = {}
    if FRONTEND_CONFIG_DIR.exists():
        for f in FRONTEND_CONFIG_DIR.glob("*.toml"):
            try:
                loaded[f.stem] = toml.load(f)
            except Exception:
                pass
    return _flatten_configs_from(FRONTEND_CONFIG_TYPES_DIR, FRONTEND_CONFIG_DEFAULTS_DIR, loaded)