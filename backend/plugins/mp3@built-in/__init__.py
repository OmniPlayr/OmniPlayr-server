import os
from pathlib import Path
from api.helpers.plugins import PluginBase, register

MUSIC_DIR = Path(os.getenv("MP3_MUSIC_DIR", "/music"))

EXTENSION_CONTENT_TYPES = {
    ".mp3": "audio/mpeg",
    ".flac": "audio/flac",
    ".wav": "audio/wav",
    ".ogg": "audio/ogg",
    ".m4a": "audio/mp4",
    ".aac": "audio/aac",
    ".opus": "audio/opus",
}


class Mp3Plugin(PluginBase):
    source_type = "mp3"

    def _resolve_path(self, song_id: str) -> Path:
        decoded = song_id.replace("%2F", "/").replace("%5C", "")
        path = (MUSIC_DIR / decoded).resolve()
        if not str(path).startswith(str(MUSIC_DIR.resolve())):
            raise PermissionError("Path traversal detected")
        return path

    def get_content_type(self, song_id: str) -> str:
        try:
            path = self._resolve_path(song_id)
            return EXTENSION_CONTENT_TYPES.get(path.suffix.lower(), "audio/mpeg")
        except Exception:
            return "audio/mpeg"

    def get_file_size(self, song_id: str) -> int | None:
        try:
            return self._resolve_path(song_id).stat().st_size
        except Exception:
            return None

    def get_stream(self, song_id: str):
        path = self._resolve_path(song_id)
        if not path.exists() or not path.is_file():
            raise FileNotFoundError(f"File not found: {path}")

        def _iter(chunk_size: int = 65536):
            with open(path, "rb") as f:
                while True:
                    chunk = f.read(chunk_size)
                    if not chunk:
                        break
                    yield chunk

        return _iter()


def setup():
    register(Mp3Plugin())