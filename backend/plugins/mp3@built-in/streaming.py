from .paths import resolve_path
from pathlib import Path
from api.helpers.omniplayr import get_plugin_config

PLUGIN_KEY = "mp3@built-in"

_cfg_dir = get_plugin_config(PLUGIN_KEY, "streaming.default_chunk_size")
if _cfg_dir:
    DEFAULT_CHUNK_SIZE = Path(_cfg_dir)

def get_stream(song_id: str, chunk_size: int = DEFAULT_CHUNK_SIZE):
    path = resolve_path(song_id)

    if not path.exists() or not path.is_file():
        raise FileNotFoundError(f"File not found: {path}")

    def _iter_chunks():
        with open(path, "rb") as fh:
            while True:
                chunk = fh.read(chunk_size)
                if not chunk:
                    break
                yield chunk

    return _iter_chunks()