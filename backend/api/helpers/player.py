from api.helpers.db import get_conn
from api.helpers.config import get_config
from api.helpers.log import log
from datetime import datetime, timedelta, timezone
from typing import Any, Optional, TypedDict, NotRequired
from psycopg2.extras import Json

class DeviceInfo(TypedDict):
    """
    Device info class
    """
    device_identifier: str
    device_type: str
    device_ip: NotRequired[Optional[str]]
    label: NotRequired[Optional[str]]
    
class TransferInfo(TypedDict):
    """
    Transfer info class
    """
    device: DeviceInfo
    transferred_at: str
    
class PlaybackMetadata(TypedDict):
    """
    Playback metadata class
    """
    started_on_device: DeviceInfo
    expected_expiry: int
    volume: int
    transfers: list[TransferInfo]
    shuffle: bool
    repeat: bool
    repeat_one: bool
    current_time: int
    
class SongMetadata(TypedDict):
    """
    Song metadata class
    """
    title: NotRequired[str]
    artist: NotRequired[Optional[str]]
    album: NotRequired[Optional[str]]
    length: NotRequired[float]
    album_art: NotRequired[Optional[str]]
    extra_data: NotRequired[Optional[str]]
    
class PlaybackEvent(TypedDict):
    """
    Playback event class
    """
    id: NotRequired[int | None]
    account_id: NotRequired[int]
    song_id: str
    source_type: str
    device_info: DeviceInfo
    playback_status: NotRequired[str]
    playback_metadata: NotRequired[dict[str, Any] | None]
    song_metadata: NotRequired[dict[str, Any] | None]    
    
def parse_device_info(device_info: DeviceInfo) -> DeviceInfo:
    """
    Parses the device info from the playback metadata
    """
    return {
        "device_identifier": device_info["device_identifier"],
        "device_ip": device_info.get("device_ip") or None,
        "device_type": device_info["device_type"],
        "label": device_info.get("label") or None
    }
def emit_playback_status(
    id: int | None,
    account_id: int,
    song_id: str,
    source_type: str,
    device_info: DeviceInfo,
    playback_status: str = "paused",
    playback_metadata: dict[str, Any] | None = None,
    song_metadata: dict[str, Any] | None = None,
):
    """
    Emit a playback status to show other devices on your account what you are listening to
    """
    log(f"Emitting playback status for account account_id={account_id}", "debug")
    with get_conn() as conn:
        with conn.cursor() as cur:
            log(f"Deleting expired playbacks for account account_id={account_id}", "debug")
            cur.execute(
                "DELETE FROM current_playback WHERE expires_at <= NOW()"
            )
            if song_metadata is None:
                song_metadata = {}
                
            expiry = get_config("player.current_playback.expiry", 20)
            
            current_device_info = parse_device_info(device_info)
            device_identifier = current_device_info["device_identifier"]
            device_ip = current_device_info["device_ip"]
            device_type = current_device_info["device_type"]
            label = current_device_info["label"]

            def create_playback_status():
                log(f"Creating new playback status for account account_id={account_id}", "debug")
                cur.execute(
                    """INSERT INTO current_playback (
                        account_id,
                        song_id, source_type,
                        device_identifier, device_ip, device_type, device_label,
                        playback_metadata, song_metadata,
                        playback_status,
                        expires_at
                    )
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, NOW() + make_interval(secs => %s))
                    RETURNING id
                    """,
                    (
                        account_id,
                        song_id, source_type,
                        device_identifier, device_ip, device_type, label,
                        Json(playback_metadata) if playback_metadata is not None else None,
                        Json(song_metadata) if song_metadata is not None else None,
                        playback_status,
                        expiry
                    ),
                )
                row = cur.fetchone()
                return row["id"] if row else None
            
            if id is None:
                id = create_playback_status()
                
                if not id:
                    log(f"Failed to create playback status for account account_id={account_id}", "error")
                    return {
                        "status": "error",
                        "message": "Failed to create playback status"
                    }
                
                log(f"Successfully created playback status, id={id}", "debug")
            else:
                log(f"Updating playback status, id={id} for account account_id={account_id}", "debug")
                cur.execute(
                    """UPDATE current_playback
                    SET song_id = %s, source_type = %s,
                        playback_metadata = %s, song_metadata = %s,
                        playback_status = %s,
                        device_identifier = %s, device_ip = %s, device_type = %s, device_label = %s,
                        expires_at = NOW() + make_interval(secs => %s),
                        updated_at = NOW()
                    WHERE id = %s AND account_id = %s
                    RETURNING id
                    """,
                    (
                        song_id, source_type,
                        Json(playback_metadata) if playback_metadata is not None else None,
                        Json(song_metadata) if song_metadata is not None else None,
                        playback_status,
                        device_identifier, device_ip, device_type, label,
                        expiry,
                        id,
                        account_id
                    ),
                )
                row = cur.fetchone()
                
                if row:
                    id = row["id"]
                    log(f"Successfully updated playback status, id={id} for account account_id={account_id}", "debug")
                else:
                    log(f"Playback status no longer exists, creating a new one for account account_id={account_id}", "debug")
                    id = create_playback_status()

                    if not id:
                        log(f"Failed to create playback status for account account_id={account_id}", "error")
                        return {
                            "status": "error",
                            "message": "Failed to create playback status"
                        }

                    log(f"Successfully created playback status, id={id}", "debug")
            
            conn.commit()
            return {
                "status": "success",
                "id": id,
                "expires_at": (datetime.now(timezone.utc) + timedelta(seconds=expiry)).isoformat(),
                "playback_status": playback_status
            }

def get_user_playbacks(account_id: int, all_info: bool = False, limit: int = 10, offset: int = 0):
    """
    Get the devices playing on your account
    """
    log(f"Getting playbacks for account account_id={account_id}", "debug")
    with get_conn() as conn:
        with conn.cursor() as cur:
            log(f"Deleting expired playbacks for account account_id={account_id}", "debug")
            cur.execute(
                "DELETE FROM current_playback WHERE account_id = %s AND expires_at <= NOW()",
                (account_id,)
            )
            conn.commit()

            rows = None
            if all_info:
                log(f"Getting all playbacks with metadata for account account_id={account_id}", "debug")
                cur.execute(
                    "SELECT * FROM current_playback WHERE account_id = %s ORDER BY updated_at DESC, id DESC LIMIT %s OFFSET %s",
                    (account_id, limit, offset)
                )
                rows = cur.fetchall()
            else:
                log(f"Getting all playbacks without metadata for account account_id={account_id}", "debug")
                cur.execute(
                    "SELECT id, song_id, source_type FROM current_playback WHERE account_id = %s ORDER BY updated_at DESC, id DESC LIMIT %s OFFSET %s",
                    (account_id, limit, offset)
                )
                rows = cur.fetchall()
            
            if not rows:
                log(f"No playbacks found for account account_id={account_id}", "debug")
                return {
                    "status": "success",
                    "message": "No playbacks found",
                    "playbacks": []
                }
            
            log(f"Found {len(rows)} playback(s) for account account_id={account_id}", "debug")
            return {
                "status": "success",
                "playbacks": rows
            }
            
def get_user_playback(account_id: int, id: int):
    with get_conn() as conn:
        with conn.cursor() as cur:
            log(f"Deleting expired playback id={id} for account account_id={account_id}", "debug")
            cur.execute(
                "DELETE FROM current_playback WHERE id = %s AND account_id = %s AND expires_at <= NOW()",
                (id, account_id)
            )
            conn.commit()

            cur.execute(
                "SELECT * FROM current_playback WHERE id = %s AND account_id = %s",
                (id, account_id)
            )
            row = cur.fetchone()

            if not row:
                log(f"Playback id={id} not found for account account_id={account_id}", "debug")
                return {
                    "status": "error",
                    "message": "Playback not found"
                }

            log(f"Found playback id={id} for account account_id={account_id}", "debug")
            return {
                "status": "success",
                "playback": row
            }
