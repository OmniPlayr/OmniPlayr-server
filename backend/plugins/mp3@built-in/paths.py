import os
from pathlib import Path

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


def resolve_path(song_id: str) -> Path:
    decoded = song_id.replace("%2F", "/").replace("%5C", "")
    path = (MUSIC_DIR / decoded).resolve()
    if not str(path).startswith(str(MUSIC_DIR.resolve())):
        raise PermissionError("Path traversal detected")
    return path