# Backend Plugin Development

Backend plugins live in `backend/plugins/` and are loaded automatically at startup. Each plugin is a Python package that registers a media source with the core via `api/helpers/omniplayr.py`.

---

## Plugin Structure

```
backend/plugins/
└── my-plugin/
    ├── __init__.py      # Required — entry point, must define setup()
    ├── package.json     # Required — metadata and Python dependencies
    └── config.toml      # Optional — plugin-specific config
```

The directory name is the plugin key. It is used everywhere: config loading, registration, and API routes.

---

## Declaring the Plugin

Add your plugin key to `backend/config.json` before it will be loaded:

```json
{
    "version": "2026.4.1",
    "plugins": {
        "my-plugin": "^*"
    }
}
```

---

## package.json

Declares metadata and Python dependencies. OmniPlayr reads `pythonDependencies` and installs them via `pip` before importing the plugin module. The loader reads this from `plugins/<key>/package.json`.

```json
{
    "name": "my-plugin",
    "author": "you",
    "version": "1.0.0",
    "description": "What this plugin does",
    "type": "source",
    "pythonDependencies": {
        "requests": ">=2.28"
    }
}
```

Use `"*"` or `""` as the version to allow any version. If `package.json` doesn't exist or `pythonDependencies` is empty, no installation step runs.

---

## PluginBase

Your plugin must subclass `PluginBase` from `api.helpers.omniplayr` and set a `source_type` string. The `source_type` appears in all API URLs and is how the player router looks up your plugin at runtime.

```python
from api.helpers.omniplayr import PluginBase, register

class MyPlugin(PluginBase):
    source_type = "my-plugin"

    def get_stream(self, song_id: str):
        raise NotImplementedError

    def get_content_type(self, song_id: str) -> str:
        return "audio/mpeg"

    def get_file_size(self, song_id: str) -> int | None:
        return None

    def get_metadata(self, song_id: str) -> dict:
        return {}
```

### Methods

| Method | Required | Description |
|---|---|---|
| `get_stream(song_id)` | Yes | Returns an iterable of `bytes` chunks |
| `get_content_type(song_id)` | No | MIME type string, defaults to `"audio/mpeg"` |
| `get_file_size(song_id)` | No | File size in bytes — enables HTTP range requests. Return `None` if unknown |
| `get_metadata(song_id)` | No | Dict of track metadata. Return `{}` if not supported |

If `get_file_size` returns `None`, range requests are not supported for that track and the full stream is served instead.

### Metadata dict keys

The player UI reads these keys from `get_metadata`. Any key not returned defaults to `None`:

```python
{
    "title": str | None,
    "artist": str | None,
    "album": str | None,
    "album_artist": str | None,
    "year": str | None,
    "track": str | None,
    "genre": str | None,
    "duration": float | None,     # seconds
    "album_art": str | None,      # data URI: "data:image/jpeg;base64,..."
    "filename": str | None,
    "extension": str | None,
    "file_size": int | None,
}
```

---

## setup()

`__init__.py` must define a `setup()` function. The loader calls it after importing the module. At minimum it should call `register`:

```python
def setup():
    register(MyPlugin())
```

---

## Adding API Routes

Use the `api` object from `api.helpers.omniplayr` to register routes. It wraps a shared `APIRouter` that gets mounted at `/api/plugin/` on startup.

```python
from api.helpers.omniplayr import api
from api.helpers.server import verify_auth
from fastapi import Depends, HTTPException

@api.get("/my-plugin/browse")
def browse(auth=Depends(verify_auth)):
    if not auth:
        raise HTTPException(status_code=401, detail="Unauthorized")
    return {"items": []}
```

Available methods on `api`: `get`, `post`, `put`, `patch`, `delete`. They accept the same arguments as the equivalent FastAPI router decorators.

The route above becomes `/api/plugin/my-plugin/browse`. There is no automatic namespacing — include your plugin key in the path yourself to avoid clashes with other plugins.

---

## Plugin Config

Store config in `plugins/<your-key>/config.toml`. This is the **only** config file your plugin may read. Do not use `get_config` from `api.helpers.config` — that is reserved for the core application.

```toml
[storage]
media_dir = "/user_storage/my-media"

[streaming]
chunk_size = 65536
```

Read values using `get_plugin_config` from `api.helpers.omniplayr`. Internally it constructs the path as `plugins/<plugin_key>/config.toml` and cannot reach outside that directory.

```python
from api.helpers.omniplayr import get_plugin_config

PLUGIN_KEY = "my-plugin"

media_dir = get_plugin_config(PLUGIN_KEY, "storage.media_dir", default="/user_storage/my-media")
chunk_size = get_plugin_config(PLUGIN_KEY, "streaming.chunk_size", default=65536)
```

The config is cached after first load. Call `reload_plugin_config` to force a re-read from disk:

```python
from api.helpers.omniplayr import reload_plugin_config

reload_plugin_config(PLUGIN_KEY)
```

Both functions are also available from `api.helpers.plugin_config` — the two modules are identical in behaviour. Prefer importing from `api.helpers.omniplayr` since that is the single entry point for all plugin utilities.

---

## Error Handling

Raise standard Python exceptions from your plugin methods. The player router maps them to HTTP responses automatically:

| Exception | HTTP status |
|---|---|
| `FileNotFoundError` | 404 |
| `PermissionError` | 403 |
| Any other `Exception` | 500 |

---

## How the Player Uses Your Plugin

Once registered, the standard player endpoints delegate to your plugin:

| Endpoint | What it calls |
|---|---|
| `GET /api/player/media/<source_type>:<song_id>` | `get_metadata`, `get_file_size`, `get_content_type` |
| `GET /api/player/stream/<source_type>:<song_id>` | `get_stream`, `get_file_size`, `get_content_type` |

The stream endpoint handles HTTP range requests automatically when `get_file_size` returns a value.

---

## Full Example

```
backend/plugins/my-plugin/
├── __init__.py
├── package.json
└── config.toml
```

**config.toml**
```toml
[storage]
media_dir = "/user_storage/my-media"
```

**package.json**
```json
{
    "name": "my-plugin",
    "author": "you",
    "version": "1.0.0",
    "description": "Streams files from a custom directory",
    "type": "source",
    "pythonDependencies": {}
}
```

**__init__.py**
```python
from pathlib import Path
from api.helpers.omniplayr import PluginBase, register, api, get_plugin_config
from api.helpers.server import verify_auth
from fastapi import Depends, HTTPException

PLUGIN_KEY = "my-plugin"
MEDIA_DIR = Path(get_plugin_config(PLUGIN_KEY, "storage.media_dir", default="/user_storage/my-media"))


class MyPlugin(PluginBase):
    source_type = "my-plugin"

    def get_stream(self, song_id: str):
        path = (MEDIA_DIR / song_id).resolve()
        if not str(path).startswith(str(MEDIA_DIR.resolve())):
            raise PermissionError("Path traversal detected")
        if not path.exists():
            raise FileNotFoundError(f"Not found: {song_id}")
        def _chunks():
            with open(path, "rb") as f:
                while chunk := f.read(65536):
                    yield chunk
        return _chunks()

    def get_content_type(self, song_id: str) -> str:
        return "audio/mpeg"

    def get_file_size(self, song_id: str) -> int | None:
        path = (MEDIA_DIR / song_id).resolve()
        return path.stat().st_size if path.exists() else None

    def get_metadata(self, song_id: str) -> dict:
        return {
            "title": song_id,
            "artist": None,
            "album": None,
            "album_art": None,
            "duration": None,
        }


@api.get("/my-plugin/browse")
def browse(auth=Depends(verify_auth)):
    if not auth:
        raise HTTPException(status_code=401, detail="Unauthorized")
    if not MEDIA_DIR.exists():
        return {"files": []}
    return {"files": [str(f.relative_to(MEDIA_DIR)) for f in MEDIA_DIR.rglob("*.mp3")]}


def setup():
    register(MyPlugin())
```