from .paths import resolve_path, EXTENSION_CONTENT_TYPES


def get_content_type(song_id: str) -> str:
    try:
        path = resolve_path(song_id)
        return EXTENSION_CONTENT_TYPES.get(path.suffix.lower(), "audio/mpeg")
    except Exception:
        return "audio/mpeg"


def get_file_size(song_id: str) -> int | None:
    try:
        return resolve_path(song_id).stat().st_size
    except Exception:
        return None


def get_metadata(song_id: str) -> dict:
    try:
        path = resolve_path(song_id)
        stat = path.stat()
        return {
            "filename": path.name,
            "extension": path.suffix.lower(),
            "file_size": stat.st_size,
            "duration": None,
        }
    except Exception:
        return {}