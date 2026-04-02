from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse
from api.helpers.plugins import get_plugin

router = APIRouter()

@router.get("/media/{source_type}:{song_id:path}")
def stream_media(source_type: str, song_id: str, request: Request):
    plugin = get_plugin(source_type)
    if plugin is None:
        raise HTTPException(status_code=404, detail=f"No plugin registered for source type '{source_type}'")

    try:
        stream = plugin.get_stream(song_id)
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except PermissionError as e:
        raise HTTPException(status_code=403, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    content_type = plugin.get_content_type(song_id)
    file_size = plugin.get_file_size(song_id)

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
                bytes_sent = 0
                for chunk in stream:
                    chunk_start = 0
                    if bytes_sent + len(chunk) <= start:
                        bytes_sent += len(chunk)
                        continue
                    if bytes_sent < start:
                        chunk_start = start - bytes_sent
                    remaining = length - (bytes_sent + len(chunk) - chunk_start - start)
                    if remaining <= 0:
                        yield chunk[chunk_start:chunk_start + (length - max(0, bytes_sent - start))]
                        break
                    yield chunk[chunk_start:]
                    bytes_sent += len(chunk)

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

    headers = {
        "Accept-Ranges": "bytes",
        "Cache-Control": "no-cache",
    }
    if file_size is not None:
        headers["Content-Length"] = str(file_size)

    return StreamingResponse(stream, media_type=content_type, headers=headers)