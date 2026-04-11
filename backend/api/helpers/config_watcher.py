import json
import os
import threading
from watchdog.observers import Observer
from watchdog.events import FileSystemEventHandler

BASE_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

CONFIG_PATH = os.path.join(BASE_DIR, "config.json")
CONFIG_LOCAL_PATH = os.path.join(BASE_DIR, "config.local.json")

def deep_merge(base: dict, override: dict) -> dict:
    result = dict(override)
    for key, value in base.items():
        if key not in result:
            result[key] = value
        elif isinstance(value, dict) and isinstance(result[key], dict):
            result[key] = deep_merge(value, result[key])
    return result


def sync_config():
    if not os.path.exists(CONFIG_PATH):
        return

    with open(CONFIG_PATH, "r") as f:
        base = json.load(f)

    local = {}
    if os.path.exists(CONFIG_LOCAL_PATH):
        with open(CONFIG_LOCAL_PATH, "r") as f:
            local = json.load(f)

    merged = deep_merge(base, local)

    with open(CONFIG_LOCAL_PATH, "w") as f:
        json.dump(merged, f, indent=2)


class ConfigChangeHandler(FileSystemEventHandler):
    def on_modified(self, event):
        if os.path.abspath(event.src_path) == os.path.abspath(CONFIG_PATH):
            sync_config()


def start_config_watcher():
    sync_config()
    handler = ConfigChangeHandler()
    observer = Observer()
    observer.schedule(handler, path=os.path.dirname(os.path.abspath(CONFIG_PATH)) or ".", recursive=False)
    thread = threading.Thread(target=observer.start, daemon=True)
    thread.start()