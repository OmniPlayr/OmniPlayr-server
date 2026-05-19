import json
import os
import threading
from watchdog.observers import Observer
from watchdog.events import FileSystemEventHandler
import shutil

BASE_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
CONFIG_PATH = os.path.join(BASE_DIR, "config.json")
CONFIG_LOCAL_PATH = os.path.join(BASE_DIR, "config.local.json")

VERSION_KEYS = {"version", "safeVersion", "year", "month", "bugfix", "branch"}

def deep_merge(base: dict, override: dict) -> dict:
    from api.helpers.log import log
    log(f"Deep merging configs, override has {len(override)} key(s)", "debug", "config_watcher")
    result = dict(base)
    for key, value in override.items():
        if key in VERSION_KEYS:
            log(f"Skipping version key {key!r} during merge", "debug", "config_watcher")
            continue
        if key in result and isinstance(value, dict) and isinstance(result[key], dict):
            log(f"Recursively merging nested key {key!r}", "debug", "config_watcher")
            result[key] = deep_merge(result[key], value)
        else:
            result[key] = value
    return result

def sync_config():
    from api.helpers.log import log
    log(f"Syncing config: base={CONFIG_PATH} local={CONFIG_LOCAL_PATH}", "debug", "config_watcher")
    if not os.path.exists(CONFIG_PATH):
        log(f"Base config file not found at {CONFIG_PATH}, skipping sync", "debug", "config_watcher")
        return
    
    if os.path.isdir(CONFIG_LOCAL_PATH):
        shutil.rmtree(CONFIG_LOCAL_PATH)
    with open(CONFIG_LOCAL_PATH, "w") as f:
        json.dump(merged, f, indent=2)

    with open(CONFIG_PATH, "r") as f:
        base = json.load(f)
    log(f"Loaded base config with {len(base)} key(s)", "debug", "config_watcher")

    local = {}
    if os.path.exists(CONFIG_LOCAL_PATH):
        with open(CONFIG_LOCAL_PATH, "r") as f:
            local = json.load(f)
        log(f"Loaded local config with {len(local)} key(s)", "debug", "config_watcher")
    else:
        log("No local config found, merging base into new local", "debug", "config_watcher")

    merged = deep_merge(base, local)
    log(f"Merged config has {len(merged)} key(s)", "debug", "config_watcher")

    with open(CONFIG_LOCAL_PATH, "w") as f:
        json.dump(merged, f, indent=2)
    log("Config synced and written to local", "debug", "config_watcher")

class ConfigChangeHandler(FileSystemEventHandler):
    def on_modified(self, event):
        from api.helpers.log import log
        if os.path.abspath(event.src_path) == os.path.abspath(CONFIG_PATH):
            log(f"Config file change detected: {event.src_path}", "debug", "config_watcher")
            sync_config()
        else:
            log(f"Ignoring unrelated file change: {event.src_path}", "debug", "config_watcher")

def start_config_watcher():
    from api.helpers.log import log
    log("Starting config watcher", "debug", "config_watcher")
    sync_config()
    handler = ConfigChangeHandler()
    observer = Observer()
    watch_dir = os.path.dirname(os.path.abspath(CONFIG_PATH)) or "."
    log(f"Watching directory: {watch_dir}", "debug", "config_watcher")
    observer.schedule(handler, path=watch_dir, recursive=False)
    thread = threading.Thread(target=observer.start, daemon=True)
    thread.start()
    log("Config watcher thread started", "debug", "config_watcher")