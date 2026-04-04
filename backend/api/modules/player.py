from fastapi import APIRouter, HTTPException, Request, Depends
from fastapi.responses import StreamingResponse
from api.helpers.omniplayr import get_plugin
from api.helpers.server import verify_auth

router = APIRouter()

def _build_stream_url(request: Request, source_type: str, song_id: str) -> str:
    base = str(request.base_url).rstrip("/")
    return f"{base}/api/player/stream/{source_type}:{song_id}"


@router.get("/media/{source_type}:{song_id:path}")
def get_media_info(source_type: str, song_id: str, request: Request, auth=Depends(verify_auth)):
    if not auth:
        raise HTTPException(status_code=401, detail="Unauthorized")
    plugin = get_plugin(source_type)
    if plugin is None:
        raise HTTPException(status_code=404, detail=f"No plugin registered for source type '{source_type}'")

    try:
        metadata = plugin.get_metadata(song_id)
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except PermissionError as e:
        raise HTTPException(status_code=403, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    file_size = plugin.get_file_size(song_id)
    content_type = plugin.get_content_type(song_id)
    stream_url = _build_stream_url(request, source_type, song_id)

    return {
        "source_type": source_type,
        "song_id": song_id,
        "stream_url": stream_url,
        "content_type": content_type,
        "file_size": file_size,
        "metadata": metadata,
    }

@router.get("/stream/{source_type}:{song_id:path}")
def stream_media(source_type: str, song_id: str, request: Request, auth=Depends(verify_auth)):
    if not auth:
        raise HTTPException(status_code=401, detail="Unauthorized")
    plugin = get_plugin(source_type)
    if plugin is None:
        raise HTTPException(status_code=404, detail=f"No plugin registered for source type '{source_type}'")

    try:
        file_size    = plugin.get_file_size(song_id)
        content_type = plugin.get_content_type(song_id)
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except PermissionError as e:
        raise HTTPException(status_code=403, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    range_header = request.headers.get("range")

    if range_header and file_size is not None:
        try:
            range_val = range_header.strip().replace("bytes=", "")
            start_str, end_str = range_val.split("-")
            start = int(start_str)
            end = int(end_str) if end_str else file_size - 1
            end = min(end, file_size - 1)
            length = end - start + 1

            def _ranged_stream():
                stream = plugin.get_stream(song_id)
                bytes_seen = 0
                bytes_sent = 0

                for chunk in stream:
                    chunk_len = len(chunk)

                    if bytes_seen + chunk_len <= start:
                        bytes_seen += chunk_len
                        continue

                    chunk_start = max(0, start - bytes_seen)
                    data = chunk[chunk_start:]

                    remaining = length - bytes_sent
                    if remaining <= 0:
                        break

                    if len(data) > remaining:
                        data = data[:remaining]

                    yield data
                    bytes_sent += len(data)
                    bytes_seen += chunk_len

                    if bytes_sent >= length:
                        break

            return StreamingResponse(
                _ranged_stream(),
                status_code=206,
                media_type=content_type,
                headers={
                    "Content-Range": f"bytes {start}-{end}/{file_size}",
                    "Accept-Ranges": "bytes",
                    "Content-Length": str(length),
                    "Cache-Control": "no-cache",
                },
            )
        except Exception:
            pass

    try:
        stream = plugin.get_stream(song_id)
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except PermissionError as e:
        raise HTTPException(status_code=403, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    headers = {
        "Accept-Ranges": "bytes",
        "Cache-Control": "no-cache",
    }
    if file_size is not None:
        headers["Content-Length"] = str(file_size)

    return StreamingResponse(stream, media_type=content_type, headers=headers)