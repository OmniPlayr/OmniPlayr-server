from fastapi import APIRouter
from pydantic import BaseModel
from api.helpers.db import get_conn

router = APIRouter()


class SetupState(BaseModel):
    current_step: int
    completed: bool = False


def _get_state():
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT current_step, completed, updated_at FROM setup_state WHERE id = 1")
            return cur.fetchone()


def _save_state(step: int, completed: bool):
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                UPDATE setup_state
                SET current_step = %s, completed = %s, updated_at = NOW()
                WHERE id = 1
                RETURNING current_step, completed, updated_at
                """,
                (step, completed),
            )
            row = cur.fetchone()
        conn.commit()
    return row


@router.get("/state")
def get_setup_state():
    return _get_state()


@router.post("/state")
def save_setup_state(body: SetupState):
    return _save_state(body.current_step, body.completed)