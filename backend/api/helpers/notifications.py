from __future__ import annotations
import asyncio
import json
from pathlib import Path
from fastapi import WebSocket
from api.helpers.db import get_conn
from api.helpers.log import log

INITIAL_NOTIFICATIONS: list[dict] = [
    {
        "key": "welcome_docs",
        "icon": "BookOpenText",
        "title": "Need some help?",
        "text": "You can always read the documentation for OmniPlayr on our website.",
        "action_type": "external",
        "action_url": "https://omniplayr.wokki20.nl/docs/",
    },
    {
        "key": "welcome_message",
        "icon": "PartyPopper",
        "title": "Welcome to OmniPlayr",
        "text": 'Thanks for using OmniPlayr <link href="https://omniplayr.wokki20.nl">{version}</link>!',
        "action_type": None,
        "action_url": None,
    },
]


def _get_version() -> str:
    try:
        config_path = Path("config.local.json")
        if config_path.exists():
            with open(config_path) as f:
                data = json.load(f)
            return f"{data.get('year', 0)}.{data.get('month', 0)}"
    except Exception:
        pass
    return ""


def _serialize(row: dict) -> dict:
    for k, v in row.items():
        if hasattr(v, "isoformat"):
            row[k] = v.isoformat()
    return row


def _unread_payload(count: int) -> dict:
    return {
        "unread_count": min(count, 99),
        "unread_display": "99+" if count > 99 else str(count),
    }


class NotificationManager:
    """Manage active notification websocket connections by account."""
    def __init__(self):
        self._connections: dict[int, list[WebSocket]] = {}

    async def connect(self, account_id: int, ws: WebSocket):
        """Accept and register a websocket connection for an account."""
        await ws.accept()
        self._connections.setdefault(account_id, []).append(ws)
        log(f"WS connected account_id={account_id} total={len(self._connections[account_id])}", "debug", "notifications")

    def disconnect(self, account_id: int, ws: WebSocket):
        """Remove a websocket connection for an account."""
        conns = self._connections.get(account_id, [])
        try:
            conns.remove(ws)
        except ValueError:
            pass
        if not conns:
            self._connections.pop(account_id, None)
        log(f"WS disconnected account_id={account_id}", "debug", "notifications")

    async def send_to_user(self, account_id: int, data: dict):
        """Send a JSON payload to every active websocket for an account."""
        conns = list(self._connections.get(account_id, []))
        dead: list[WebSocket] = []
        for ws in conns:
            try:
                await ws.send_json(data)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.disconnect(account_id, ws)


manager = NotificationManager()


def _ensure_initial_notifications(account_id: int) -> None:
    with get_conn() as conn:
        with conn.cursor() as cur:
            for notif in INITIAL_NOTIFICATIONS:
                cur.execute(
                    "SELECT id FROM initial_notifications_sent WHERE notification_key = %s AND account_id = %s",
                    (notif["key"], account_id),
                )
                if cur.fetchone() is not None:
                    continue

                text = notif["text"].replace("{version}", _get_version())
                read = notif["action_type"] is None

                cur.execute(
                    """
                    INSERT INTO notifications
                        (account_id, notification_key, icon, title, text, action_type, action_url, read)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                    """,
                    (
                        account_id,
                        notif["key"],
                        notif["icon"],
                        notif["title"],
                        text,
                        notif["action_type"],
                        notif["action_url"],
                        read,
                    ),
                )
                cur.execute(
                    "INSERT INTO initial_notifications_sent (notification_key, account_id) VALUES (%s, %s)",
                    (notif["key"], account_id),
                )
        conn.commit()
    log(f"Initial notifications ensured for account_id={account_id}", "debug", "notifications")


def get_notifications(account_id: int) -> list[dict]:
    """Return notifications for an account ordered from newest to oldest."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id, icon, title, text, action_type, action_url, read, created_at
                FROM notifications
                WHERE account_id = %s
                ORDER BY created_at DESC
                """,
                (account_id,),
            )
            rows = cur.fetchall()
    return [_serialize(dict(r)) for r in rows]


def get_unread_count(account_id: int) -> int:
    """Return the unread notification count for an account."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT COUNT(*) AS c FROM notifications WHERE account_id = %s AND read = FALSE",
                (account_id,),
            )
            row = cur.fetchone()
    return int(row["c"]) if row else 0


def mark_read(notification_id: int, account_id: int) -> bool:
    """Mark one notification as read for an account."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "UPDATE notifications SET read = TRUE WHERE id = %s AND account_id = %s RETURNING id",
                (notification_id, account_id),
            )
            result = cur.fetchone()
        conn.commit()
    return result is not None


def delete_notification(notification_id: int, account_id: int) -> bool:
    """Delete one notification for an account."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "DELETE FROM notifications WHERE id = %s AND account_id = %s RETURNING id",
                (notification_id, account_id),
            )
            result = cur.fetchone()
        conn.commit()
    return result is not None


async def notify(
    account_id: int,
    icon: str,
    title: str,
    text: str,
    action_type: str | None = None,
    action_url: str | None = None,
) -> dict:
    """Create a notification and push it to active account websockets."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO notifications
                    (account_id, icon, title, text, action_type, action_url)
                VALUES (%s, %s, %s, %s, %s, %s)
                RETURNING id, account_id, icon, title, text, action_type, action_url, read, created_at
                """,
                (account_id, icon, title, text, action_type, action_url),
            )
            row = _serialize(dict(cur.fetchone()))
        conn.commit()

    count = get_unread_count(account_id)
    await manager.send_to_user(
        account_id,
        {"type": "notification", "data": row, **_unread_payload(count)},
    )
    log(f"Notification sent to account_id={account_id}: {title!r}", "debug", "notifications")
    return row


async def push_frontend_event(account_id: int, event: str, data: dict | None = None) -> None:
    """Push a transient frontend event over the existing account websocket."""
    await manager.send_to_user(
        account_id,
        {
            "type": "frontend_event",
            "event": event,
            "data": data or {},
        },
    )


def push_frontend_event_sync(account_id: int, event: str, data: dict | None = None) -> None:
    """Schedule or run transient frontend-event delivery from synchronous code."""
    coro = push_frontend_event(account_id, event, data)
    try:
        loop = asyncio.get_running_loop()
        loop.create_task(coro)
    except RuntimeError:
        if _main_loop is not None:
            asyncio.run_coroutine_threadsafe(coro, _main_loop)
        else:
            asyncio.run(coro)


async def notify_once(
    account_id: int,
    notification_key: str,
    icon: str,
    title: str,
    text: str,
    action_type: str | None = None,
    action_url: str | None = None,
) -> dict | None:
    """Create a keyed notification only if it has not been sent before."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT id FROM notifications WHERE account_id = %s AND notification_key = %s",
                (account_id, notification_key),
            )
            if cur.fetchone() is not None:
                return None

            cur.execute(
                """
                INSERT INTO notifications
                    (account_id, notification_key, icon, title, text, action_type, action_url)
                VALUES (%s, %s, %s, %s, %s, %s, %s)
                RETURNING id, account_id, icon, title, text, action_type, action_url, read, created_at
                """,
                (account_id, notification_key, icon, title, text, action_type, action_url),
            )
            row = _serialize(dict(cur.fetchone()))
        conn.commit()

    count = get_unread_count(account_id)
    await manager.send_to_user(
        account_id,
        {"type": "notification", "data": row, **_unread_payload(count)},
    )
    log(f"Notification sent once to account_id={account_id}: {title!r}", "debug", "notifications")
    return row

_main_loop: asyncio.AbstractEventLoop | None = None

def set_main_loop(loop: asyncio.AbstractEventLoop) -> None:
    """Store the main asyncio event loop for synchronous notification helpers."""
    global _main_loop
    _main_loop = loop

def notify_sync(
    account_id: int,
    icon: str,
    title: str,
    text: str,
    action_type: str | None = None,
    action_url: str | None = None,
) -> None:
    """Schedule or run notification delivery from synchronous code."""
    coro = notify(account_id, icon, title, text, action_type, action_url)
    try:
        loop = asyncio.get_running_loop()
        loop.create_task(coro)
    except RuntimeError:
        if _main_loop is not None:
            asyncio.run_coroutine_threadsafe(coro, _main_loop)
        else:
            asyncio.run(coro)


def notify_once_sync(
    account_id: int,
    notification_key: str,
    icon: str,
    title: str,
    text: str,
    action_type: str | None = None,
    action_url: str | None = None,
) -> None:
    """Schedule or run keyed notification delivery from synchronous code."""
    coro = notify_once(account_id, notification_key, icon, title, text, action_type, action_url)
    try:
        loop = asyncio.get_running_loop()
        loop.create_task(coro)
    except RuntimeError:
        if _main_loop is not None:
            asyncio.run_coroutine_threadsafe(coro, _main_loop)
        else:
            asyncio.run(coro)
