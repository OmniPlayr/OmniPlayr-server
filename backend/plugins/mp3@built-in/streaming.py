from .paths import resolve_path


def get_stream(song_id: str, chunk_size: int = 65536):
    path = resolve_path(song_id)
    if not path.exists() or not path.is_file():
        raise FileNotFoundError(f"File not found: {path}")

    def _iter():
        with open(path, "rb") as f:
            while True:
                chunk = f.read(chunk_size)
                if not chunk:
                    break
                yield chunk

    return _iter()