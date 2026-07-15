import inspect
from fastapi import APIRouter, HTTPException, Request, Depends, Header, Query, status
from fastapi.responses import StreamingResponse
from api.helpers.plugins import get_plugin
from api.helpers.server import verify_auth, verify_token, get_token_user
from api.helpers.log import log
from api.helpers.player import emit_playback_status, get_user_playback, get_user_playbacks, PlaybackEvent
from api.helpers.notifications import push_frontend_event_sync

router = APIRouter()

def _resolve_stream_auth(request: Request, token: str | None, account_token: str | None) -> int:
    access_token = token
    auth_header = request.headers.get("authorization")
    if auth_header and auth_header.lower().startswith("bearer "):
        access_token = auth_header[7:].strip()

    if not access_token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing access token",
        )

    verify_token(access_token)

    resolved_account_token = account_token or request.headers.get("x-account-token")
    if not resolved_account_token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing account token",
        )

    account_id = get_token_user(resolved_account_token)
    if account_id is None:
        raise HTTPException(status_code=403, detail="Invalid account token")

    return account_id


def _plugin_accepts_range_header(plugin) -> bool:
    try:
        return "range_header" in inspect.signature(plugin.get_stream).parameters
    except (TypeError, ValueError):
        return False

# This is to build a stream URL for the plugins
def _build_stream_url(request: Request, source_type: str, song_id: str) -> str:
    base = str(request.base_url).rstrip("/")
    url = f"{base}/api/player/stream/{source_type}:{song_id}"
    log(f"Built stream URL: {url}", "debug", "module.player")
    return url

def _with_request_device_ip(device_info: dict | None, request_ip: str | None) -> dict | None:
    if not isinstance(device_info, dict):
        return device_info

    next_device = dict(device_info)
    if request_ip and not next_device.get("device_ip"):
        next_device["device_ip"] = request_ip
    return next_device

def _with_request_ip_in_playback_metadata(playback_metadata: dict | None, request_ip: str | None) -> dict | None:
    if not isinstance(playback_metadata, dict):
        return playback_metadata

    next_metadata = dict(playback_metadata)
    next_metadata["started_on_device"] = _with_request_device_ip(
        next_metadata.get("started_on_device"),
        request_ip,
    )

    transfers = next_metadata.get("transfers")
    if isinstance(transfers, list):
        next_transfers = []
        for transfer in transfers:
            if isinstance(transfer, dict):
                next_transfer = dict(transfer)
                next_transfer["device"] = _with_request_device_ip(next_transfer.get("device"), request_ip)
                next_transfers.append(next_transfer)
            else:
                next_transfers.append(transfer)
        next_metadata["transfers"] = next_transfers

    return next_metadata

def _latest_transfer(playback_metadata: dict | None) -> dict | None:
    if not isinstance(playback_metadata, dict):
        return None

    transfers = playback_metadata.get("transfers")
    if not isinstance(transfers, list) or not transfers:
        return None

    latest = transfers[-1]
    return latest if isinstance(latest, dict) else None

def _same_transfer(left: dict | None, right: dict | None) -> bool:
    if not left or not right:
        return left is right

    left_device = left.get("device") if isinstance(left.get("device"), dict) else {}
    right_device = right.get("device") if isinstance(right.get("device"), dict) else {}

    return (
        left.get("transferred_at") == right.get("transferred_at")
        and left_device.get("device_identifier") == right_device.get("device_identifier")
        and left_device.get("device_type") == right_device.get("device_type")
    )

def _push_device_transfer_event_if_needed(
    account_id: int,
    previous_playback_metadata: dict | None,
    playback_metadata: dict | None,
) -> None:
    latest_transfer = _latest_transfer(playback_metadata)
    if not latest_transfer or _same_transfer(_latest_transfer(previous_playback_metadata), latest_transfer):
        return

    device = latest_transfer.get("device")
    if not isinstance(device, dict):
        return

    push_frontend_event_sync(
        account_id,
        "player.device_transfer",
        {
            "target_device": device,
            "transferred_at": latest_transfer.get("transferred_at"),
        },
    )

def _push_playback_updated_event(
    account_id: int,
    playback_id: int | None,
    song_id: str,
    source_type: str,
    device_info: dict | None,
    playback_status: str,
    playback_metadata: dict | None,
    song_metadata: dict | None,
) -> None:
    if not playback_id or not isinstance(device_info, dict):
        return

    push_frontend_event_sync(
        account_id,
        "player.playback_updated",
        {
            "playback": {
                "id": playback_id,
                "song_id": song_id,
                "source_type": source_type,
                "device_identifier": device_info.get("device_identifier"),
                "device_ip": device_info.get("device_ip"),
                "device_type": device_info.get("device_type"),
                "device_label": device_info.get("label"),
                "playback_status": playback_status,
                "playback_metadata": playback_metadata,
                "song_metadata": song_metadata or {},
            },
        },
    )

# This is to get the metadata for a song, and its stream URL
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
    except NotImplementedError as e:
        log(f"Media metadata unsupported for song_id={song_id!r}: {e}", "debug", "module.player")
        raise HTTPException(status_code=501, detail=str(e))
    except Exception as e:
        log(f"Unexpected error fetching metadata for song_id={song_id!r}: {e}", "error", "module.player")
        raise HTTPException(status_code=500, detail=str(e))

    try:
        file_size = plugin.get_file_size(song_id, account_id)
        content_type = plugin.get_content_type(song_id, account_id)
    except NotImplementedError as e:
        log(f"Media stream metadata unsupported for song_id={song_id!r}: {e}", "debug", "module.player")
        raise HTTPException(status_code=501, detail=str(e))
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

# This is to stream a song, you just send the source type that the plugin is registered for, and the song ID or path
@router.get("/stream/{source_type}:{song_id:path}")
def stream_media(
    source_type: str,
    song_id: str,
    request: Request,
    token: str | None = Query(None),
    account_token: str | None = Query(None),
):
    log(f"GET /player/stream/{source_type}:{song_id} requested", "debug", "module.player")
    account_id = _resolve_stream_auth(request, token, account_token)
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
    except NotImplementedError as e:
        log(f"Stream metadata unsupported for song_id={song_id!r}: {e}", "debug", "module.player")
        raise HTTPException(status_code=501, detail=str(e))
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

            if _plugin_accepts_range_header(plugin):
                log(f"Opening plugin ranged stream for song_id={song_id!r}", "debug", "module.player")
                stream = plugin.get_stream(song_id, account_id, range_header=range_header)
                return StreamingResponse(
                    stream,
                    status_code=206,
                    media_type=content_type,
                    headers={
                        "Content-Range": f"bytes {start}-{end}/{file_size}",
                        "Accept-Ranges": "bytes",
                        "Content-Length": str(length),
                        "Cache-Control": "no-cache",
                    },
                )

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
    except NotImplementedError as e:
        log(f"Stream unsupported for song_id={song_id!r}: {e}", "debug", "module.player")
        raise HTTPException(status_code=501, detail=str(e))
    except Exception as e:
        log(f"Unexpected error opening stream for song_id={song_id!r}: {e}", "error", "module.player")
        raise HTTPException(status_code=500, detail=str(e))

    headers = {"Accept-Ranges": "bytes", "Cache-Control": "no-cache"}
    if file_size is not None:
        headers["Content-Length"] = str(file_size)
    log(f"Returning full stream response for song_id={song_id!r}", "debug", "module.player")
    return StreamingResponse(stream, media_type=content_type, headers=headers)

@router.post("/playback/emit", status_code=201)
def emit_playback_event(
    request: Request,
    playback: PlaybackEvent,
    auth=Depends(verify_auth),
    x_account_token: str = Header(..., alias="X-Account-Token")
):
    if not auth or not x_account_token:
        raise HTTPException(status_code=401, detail="Unauthorized")
    
    log("POST /player/playback/emit requested", "debug", "module.player")
    account_id = get_token_user(x_account_token)
    if account_id is None:
        raise HTTPException(status_code=401, detail="Unauthorized")

    log(f"Playback emit request: account_id={account_id}", "debug", "module.player")
    request_ip = request.client.host if request.client else None
    device_info = _with_request_device_ip(playback["device_info"], request_ip)
    playback_metadata = _with_request_ip_in_playback_metadata(playback.get("playback_metadata"), request_ip)
    previous_playback_metadata = None
    playback_id = playback.get("id")

    if isinstance(playback_id, int):
        previous_playback = get_user_playback(account_id=account_id, id=playback_id)
        previous_row = previous_playback.get("playback") if previous_playback.get("status") == "success" else None
        if isinstance(previous_row, dict):
            previous_metadata = previous_row.get("playback_metadata")
            if isinstance(previous_metadata, dict):
                previous_playback_metadata = previous_metadata

    response = emit_playback_status(
        id=playback.get("id"),
        account_id=account_id,
        song_id=playback["song_id"],
        source_type=playback["source_type"],
        device_info=device_info,
        playback_status=playback.get("playback_status", "paused"),
        playback_metadata=playback_metadata,
        song_metadata=playback.get("song_metadata"),
    )
    _push_device_transfer_event_if_needed(account_id, previous_playback_metadata, playback_metadata)
    _push_playback_updated_event(
        account_id=account_id,
        playback_id=response.get("id") if isinstance(response, dict) else None,
        song_id=playback["song_id"],
        source_type=playback["source_type"],
        device_info=device_info,
        playback_status=playback.get("playback_status", "paused"),
        playback_metadata=playback_metadata,
        song_metadata=playback.get("song_metadata"),
    )

    return response

@router.get("/playback/list")
def get_playbacks(
    request: Request,
    all_info: bool = False,
    limit: int = 10,
    offset: int = 0,
    auth=Depends(verify_auth),
    x_account_token: str = Header(..., alias="X-Account-Token")
):
    log("GET /player/playback requested", "debug", "module.player")
    account_id = get_token_user(x_account_token)
    log(f"Playback list request: account_id={account_id} all_info={all_info} limit={limit} offset={offset}", "debug", "module.player")

    return get_user_playbacks(
        account_id=account_id,
        all_info=all_info,
        limit=limit,
        offset=offset,
    )
    
@router.get("/playback/{playback_id}")
def get_playback(
    request: Request,
    playback_id: int,
    auth=Depends(verify_auth),
    x_account_token: str = Header(..., alias="X-Account-Token")
):
    log(f"GET /player/playback/{playback_id} requested", "debug", "module.player")
    account_id = get_token_user(x_account_token)
    log(f"Playback request: account_id={account_id} playback_id={playback_id}", "debug", "module.player")

    return get_user_playback(
        account_id=account_id,
        id=playback_id,
    )
