from fastapi import APIRouter, HTTPException, Request, Depends, Header
from fastapi.responses import StreamingResponse
from api.helpers.plugins import get_plugin
from api.helpers.server import verify_auth, get_token_user
from api.helpers.log import log

router = APIRouter()


def _build_stream_url(request: Request, source_type: str, song_id: str) -> str:
    base = str(request.base_url).rstrip("/")
    url = f"{base}/api/player/stream/{source_type}:{song_id}"
    log(f"Built stream URL: {url}", "debug", "module.player")
    return url

@router.get("/media/{source_type}:{song_id:path}")
def get_media_info(source_type: str, song_id: str, request: Request, auth=Depends(verify_auth), x_account_token: str = Header(..., alias="X-Account-Token")):
    log(f"GET /player/media/{source_type}:{song_id} requested", "debug", "module.player")
    account_id = get_token_user(x_account_token)
    log(f"Media info request: account_id={account_id} source_type={source_type!r} song_id={song_id!r}", "debug", "module.player")

    plugin = get_plugin(source_type)
    if plugin is None:
        log(f"No plugin registered for source_type={source_type!r}", "debug", "module.player")
        raise HTTPException(status_code=404, detail=f"No plugin registered for source type '{source_type}'")

    log(f"Checking ownership: account_id={account_id} song_id={song_id!r}", "debug", "module.player")
    if not plugin.check_ownership(song_id, account_id):
        log(f"Ownership check failed: account_id={account_id} song_id={song_id!r}", "debug", "module.player")
        raise HTTPException(status_code=403, detail="Access denied")

    log(f"Ownership ok, fetching metadata for song_id={song_id!r}", "debug", "module.player")
    try:
        metadata = plugin.get_metadata(song_id, account_id)
        log(f"Metadata fetched for song_id={song_id!r}: {list(metadata.keys())}", "debug", "module.player")
    except FileNotFoundError as e:
        log(f"Song not found song_id={song_id!r}: {e}", "debug", "module.player")
        raise HTTPException(status_code=404, detail=str(e))
    except PermissionError as e:
        log(f"Permission error for song_id={song_id!r}: {e}", "debug", "module.player")
        raise HTTPException(status_code=403, detail=str(e))
    except Exception as e:
        log(f"Unexpected error fetching metadata for song_id={song_id!r}: {e}", "error", "module.player")
        raise HTTPException(status_code=500, detail=str(e))

    file_size = plugin.get_file_size(song_id, account_id)
    content_type = plugin.get_content_type(song_id, account_id)
    stream_url = _build_stream_url(request, source_type, song_id)
    log(f"Media info ready: song_id={song_id!r} file_size={file_size} content_type={content_type!r}", "debug", "module.player")
    return {
        "source_type": source_type,
        "song_id": song_id,
        "stream_url": stream_url,
        "content_type": content_type,
        "file_size": file_size,
        "metadata": metadata,
    }

@router.get("/stream/{source_type}:{song_id:path}")
def stream_media(source_type: str, song_id: str, request: Request, auth=Depends(verify_auth), x_account_token: str = Header(..., alias="X-Account-Token")):
    log(f"GET /player/stream/{source_type}:{song_id} requested", "debug", "module.player")
    account_id = get_token_user(x_account_token)
    log(f"Stream request: account_id={account_id} source_type={source_type!r} song_id={song_id!r}", "debug", "module.player")

    plugin = get_plugin(source_type)
    if plugin is None:
        log(f"No plugin for source_type={source_type!r}", "debug", "module.player")
        raise HTTPException(status_code=404, detail=f"No plugin registered for source type '{source_type}'")

    log(f"Checking ownership: account_id={account_id} song_id={song_id!r}", "debug", "module.player")
    if not plugin.check_ownership(song_id, account_id):
        log(f"Ownership denied: account_id={account_id} song_id={song_id!r}", "debug", "module.player")
        raise HTTPException(status_code=403, detail="Access denied")

    log(f"Ownership ok, fetching file size and content type for song_id={song_id!r}", "debug", "module.player")
    try:
        file_size = plugin.get_file_size(song_id, account_id)
        content_type = plugin.get_content_type(song_id, account_id)
        log(f"Stream meta: song_id={song_id!r} file_size={file_size} content_type={content_type!r}", "debug", "module.player")
    except FileNotFoundError as e:
        log(f"Song not found song_id={song_id!r}: {e}", "debug", "module.player")
        raise HTTPException(status_code=404, detail=str(e))
    except PermissionError as e:
        log(f"Permission error song_id={song_id!r}: {e}", "debug", "module.player")
        raise HTTPException(status_code=403, detail=str(e))
    except Exception as e:
        log(f"Unexpected error getting stream meta for song_id={song_id!r}: {e}", "error", "module.player")
        raise HTTPException(status_code=500, detail=str(e))

    range_header = request.headers.get("range")
    log(f"Range header: {range_header!r}", "debug", "module.player")

    if range_header and file_size is not None:
        log(f"Processing ranged request: range={range_header!r} file_size={file_size}", "debug", "module.player")
        try:
            range_val = range_header.strip().replace("bytes=", "")
            start_str, end_str = range_val.split("-")
            start = int(start_str)
            end = int(end_str) if end_str else file_size - 1
            end = min(end, file_size - 1)
            length = end - start + 1
            log(f"Ranged stream: start={start} end={end} length={length}", "debug", "module.player")

            def _ranged_stream():
                stream = plugin.get_stream(song_id, account_id)
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

            log(f"Returning 206 partial content for song_id={song_id!r}", "debug", "module.player")
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
        except Exception as e:
            log(f"Range parsing failed for song_id={song_id!r}: {e}, falling back to full stream", "warning", "module.player")

    log(f"Opening full stream for song_id={song_id!r}", "debug", "module.player")
    try:
        stream = plugin.get_stream(song_id, account_id)
    except FileNotFoundError as e:
        log(f"Song not found on stream open song_id={song_id!r}: {e}", "debug", "module.player")
        raise HTTPException(status_code=404, detail=str(e))
    except PermissionError as e:
        log(f"Permission error on stream open song_id={song_id!r}: {e}", "debug", "module.player")
        raise HTTPException(status_code=403, detail=str(e))
    except Exception as e:
        log(f"Unexpected error opening stream for song_id={song_id!r}: {e}", "error", "module.player")
        raise HTTPException(status_code=500, detail=str(e))

    headers = {"Accept-Ranges": "bytes", "Cache-Control": "no-cache"}
    if file_size is not None:
        headers["Content-Length"] = str(file_size)
    log(f"Returning full stream response for song_id={song_id!r}", "debug", "module.player")
    return StreamingResponse(stream, media_type=content_type, headers=headers)