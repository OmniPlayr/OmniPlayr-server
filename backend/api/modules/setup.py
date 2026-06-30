from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from api.helpers.db import get_conn
from api.helpers.server import verify_auth
from api.helpers.account import update_account, delete_account, create_account

router = APIRouter()


class SetupState(BaseModel):
    current_step: int
    completed: bool = False


class SetupAccountUpdate(BaseModel):
    name: str | None = None
    role: str | None = None
    avatar_b64: str | None = None

class AccountCreate(BaseModel):
    name: str
    role: str = "user"
    avatar_b64: str | None = None


# This is to see what state you are on the setup, so you don't loose progress when you refresh and stuff
def _get_state():
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT current_step, completed, updated_at FROM setup_state WHERE id = 1")
            return cur.fetchone()

# This is to then save the state so you don't loose progress
# I don't think this is used a lot on the setup frontend at the moment, but it's here in case
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


# This is to see what state you are on the setup
@router.get("/state")
def get_setup_state():
    return _get_state()

# This is to then save the state
@router.post("/state")
def save_setup_state(body: SetupState):
    return _save_state(body.current_step, body.completed)


# This is to check if the setup has been completed already
def _check_setup_not_completed():
    state = _get_state()
    if state and state["completed"]:
        raise HTTPException(status_code=403, detail="Setup is already completed")

# This is for updating and modifying the accounts in the setup
@router.patch("/accounts/{account_id}")
def setup_update_account(account_id: int, body: SetupAccountUpdate, auth=Depends(verify_auth)):
    _check_setup_not_completed()
    if body.role is not None and body.role not in ("user", "admin"):
        raise HTTPException(status_code=400, detail="Role must be 'user' or 'admin'")
    result = update_account(account_id, body.name, body.role, body.avatar_b64)
    if not result:
        raise HTTPException(status_code=404, detail="Account not found")
    return result

# This is for deleting the accounts in the setup
@router.delete("/accounts/{account_id}", status_code=204)
def setup_delete_account(account_id: int, auth=Depends(verify_auth)):
    _check_setup_not_completed()
    if not delete_account(account_id, True):
        raise HTTPException(status_code=404, detail="Account not found")
    
# This is for creating the accounts in the setup
@router.post("/accounts/create", status_code=201)
def create_new_account(body: AccountCreate):
    _check_setup_not_completed()
    if not body.name.strip():
        raise HTTPException(status_code=400, detail="Name is required")
    if body.role not in ("user", "admin"):
        raise HTTPException(status_code=400, detail="Role must be 'user' or 'admin'")
    result = create_account(body.name.strip(), body.role, body.avatar_b64)
    return result
