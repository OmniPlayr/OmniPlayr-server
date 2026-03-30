from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel

from api.helpers.server import verify_auth

from api.helpers.account import (
    list_accounts,
    get_account,
    create_account,
    update_account,
    delete_account,
)

router = APIRouter()

class AccountCreate(BaseModel):
    name: str
    role: str = "user"
    avatar_b64: str | None = None


class AccountUpdate(BaseModel):
    name: str | None = None
    role: str | None = None
    avatar_b64: str | None = None


@router.get("/")
def get_accounts(auth=Depends(verify_auth)):
    if not auth:
        raise HTTPException(status_code=401, detail="Unauthorized")
    return list_accounts()


@router.get("/{account_id}")
def get_one_account(account_id: int, auth=Depends(verify_auth)):
    if not auth:
        raise HTTPException(status_code=401, detail="Unauthorized")
    account = get_account(account_id)
    if not account:
        raise HTTPException(status_code=404, detail="Account not found")
    return account


@router.post("/", status_code=201)
def create_new_account(body: AccountCreate, auth=Depends(verify_auth)):
    if not auth:
        raise HTTPException(status_code=401, detail="Unauthorized")
    if not body.name.strip():
        raise HTTPException(status_code=400, detail="Name is required")
    if body.role not in ("user", "admin"):
        raise HTTPException(status_code=400, detail="Role must be 'user' or 'admin'")
    return create_account(body.name.strip(), body.role, body.avatar_b64)


@router.patch("/{account_id}")
def update_existing_account(account_id: int, body: AccountUpdate, auth=Depends(verify_auth)):
    if not auth:
        raise HTTPException(status_code=401, detail="Unauthorized")
    existing = get_account(account_id)
    if not existing:
        raise HTTPException(status_code=404, detail="Account not found")
    if body.role is not None and body.role not in ("user", "admin"):
        raise HTTPException(status_code=400, detail="Role must be 'user' or 'admin'")
    updated = update_account(account_id, body.name, body.role, body.avatar_b64)
    return updated


@router.delete("/{account_id}", status_code=204)
def delete_existing_account(account_id: int, auth=Depends(verify_auth)):
    if not auth:
        raise HTTPException(status_code=401, detail="Unauthorized")
    if not delete_account(account_id):
        raise HTTPException(status_code=404, detail="Account not found")