from fastapi import APIRouter, Depends, Header, WebSocket, WebSocketDisconnect, HTTPException
from api.helpers.server import verify_auth, verify_token, get_token_user
from api.helpers.notifications import (
    manager,
    get_notifications,
    get_unread_count,
    mark_read,
    delete_notification,
    _ensure_initial_notifications,
    _unread_payload,
)
from api.helpers.log import log

router = APIRouter()


@router.websocket("/ws")
async def notifications_ws(ws: WebSocket):
    token = ws.query_params.get("token")
    account_token = ws.query_params.get("account_token")

    if not token or not account_token:
        await ws.close(code=1008)
        return

    try:
        verify_token(token)
    except Exception:
        await ws.close(code=1008)
        return

    account_id = get_token_user(account_token)
    if not account_id:
        await ws.close(code=1008)
        return

    await manager.connect(account_id, ws)
    log(f"Notifications WS authenticated for account_id={account_id}", "debug", "notifications.ws")

    try:
        _ensure_initial_notifications(account_id)

        notifications = get_notifications(account_id)
        count = get_unread_count(account_id)

        await ws.send_json({
            "type": "init",
            "notifications": notifications,
            **_unread_payload(count),
        })

        while True:
            msg = await ws.receive_json()
            action = msg.get("action")

            if action == "delete":
                nid = int(msg.get("id", 0))
                if nid and delete_notification(nid, account_id):
                    count = get_unread_count(account_id)
                    await ws.send_json({"type": "deleted", "id": nid, **_unread_payload(count)})

            elif action == "read":
                nid = int(msg.get("id", 0))
                if nid and mark_read(nid, account_id):
                    count = get_unread_count(account_id)
                    await ws.send_json({"type": "read", "id": nid, **_unread_payload(count)})

    except WebSocketDisconnect:
        log(f"Notifications WS closed for account_id={account_id}", "debug", "notifications.ws")
    except Exception as e:
        log(f"Notifications WS error for account_id={account_id}: {e}", "error", "notifications.ws")
    finally:
        manager.disconnect(account_id, ws)


@router.get("/count")
def notification_count(
    auth=Depends(verify_auth),
    x_account_token: str = Header(..., alias="X-Account-Token"),
):
    account_id = get_token_user(x_account_token)
    if not account_id:
        raise HTTPException(status_code=401, detail="Unauthorized")
    count = get_unread_count(account_id)
    return {
        "count": min(count, 99),
        "display": "99+" if count > 99 else str(count),
    }