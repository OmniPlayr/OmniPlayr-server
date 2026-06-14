from fastapi import APIRouter, HTTPException, Depends, Header, Request, Response
from pydantic import BaseModel

from api.helpers.server import verify_auth, match_account, get_token_user
from api.helpers.log import log
from api.helpers.admin import verify_admin

from api.helpers.config import get_config

from api.helpers.account import (
    list_accounts,
    get_account,
    create_account,
    update_account,
    delete_account,
    create_account_token,
    revoke_token,
    delete_account_token,
    delete_profile_picture,
    verify_account_password,
)

router = APIRouter()

class AccountCreate(BaseModel):
    name: str
    role: str = "user"
    avatar_b64: str | None = None


class AccountUpdate(BaseModel):
    role: str | None = None
    avatar_b64: str | None = None
    nickname: str | None = None
    about: str | None = None
    password: str | None = None
    old_password: str | None = None
    
class AccountLogin(BaseModel):
    user_id: int
    password: str | None = None

class AccountRevokeAll(BaseModel):
    user_id: int
    
class AccountRevoke(BaseModel):
    token: str

# This is for getting the list of all accounts
@router.get("/", name="get_accounts")
def get_accounts(auth=Depends(verify_auth)):
    log("GET /accounts requested", "debug", "module.account")
    if not auth:
        log("GET /accounts: auth check failed", "debug", "module.account")
        raise HTTPException(status_code=401, detail="Unauthorized")
    log("GET /accounts: auth ok, fetching all accounts", "debug", "module.account")
    result = list_accounts()
    log(f"GET /accounts: returning {len(result)} account(s)", "debug", "module.account")
    return result

# This is for logging into an account
@router.post("/login")
def login(body: AccountLogin, request: Request, auth=Depends(verify_auth)):
    
    log(f"POST /accounts/login requested for user_id={body.user_id}", "debug", "module.account")

    if not auth:
        log("POST /accounts/login: auth check failed", "debug", "module.account")
        raise HTTPException(status_code=401, detail="Unauthorized")
    
    password_protected = False
        
    auth_result = verify_account_password(body.user_id, body.password)

    if auth_result in ("not_found", "no_match"):
        log(f"POST /accounts/login: auth failed for user_id={body.user_id}", "debug", "module.account")
        raise HTTPException(status_code=401, detail="Unauthorized")
    elif auth_result == "match":
        log(f"POST /accounts/login: auth ok for user_id={body.user_id}", "debug", "module.account")
        password_protected = True
    else:
        log(f"POST /accounts/login: no password for user_id={body.user_id}", "debug", "module.account")
        password_protected = False
    
    useragent = ""
    ip_address = ""
    
    if get_config("user_authentication.log_ip_adresses"):
        ip_address = request.client.host if request.client else ""
    
    if get_config("user_authentication.log_user_agents"):
        useragent = request.headers.get("user-agent", "")
        
    log(f"POST /accounts/login: auth ok, creating token for user_id={body.user_id}", "debug", "module.account")
    result = create_account_token(
        body.user_id,
        password_protected,
        useragent,
        ip_address
    )

    log(f"POST /accounts/login: token created for user_id={body.user_id}", "debug", "module.account")

    return result

# This is for revoking a token from an account
@router.post("/revoke")
def revoke(body: AccountRevoke, auth=Depends(verify_auth), x_account_token: str = Header(..., alias="X-Account-Token")):
    log("POST /accounts/revoke requested", "debug", "module.account")
    if not auth:
        log("POST /accounts/revoke: auth check failed", "debug", "module.account")
        raise HTTPException(status_code=401, detail="Unauthorized")
    log("POST /accounts/revoke: auth ok, revoking token", "debug", "module.account")
    result = revoke_token(get_token_user(x_account_token), body.token)
    log("POST /accounts/revoke: token revoked", "debug", "module.account")
    return result

# This revokes ALL tokens from an account, and only an admin can do this. For example you can use this if your account has been compromised
@router.post("/revoke_all")
def revoke_all(body: AccountRevokeAll, auth=Depends(verify_admin)):
    log("POST /accounts/revoke_all requested", "debug", "module.account")
    if not auth:
        log("POST /accounts/revoke_all: auth check failed", "debug", "module.account")
        raise HTTPException(status_code=401, detail="Unauthorized")
    log("POST /accounts/revoke_all: auth ok, revoking all tokens", "debug", "module.account")
    result = revoke_token(body.user_id, None, True)
    log("POST /accounts/revoke_all: all tokens revoked", "debug", "module.account")
    return result

# This is for deleting a revoked token from an account
@router.post("/delete_token")
def delete_token(body: AccountRevoke, auth=Depends(verify_auth), x_account_token: str = Header(..., alias="X-Account-Token")):
    log("POST /accounts/delete_token requested", "debug", "module.account")
    if not auth:
        log("POST /accounts/delete_token: auth check failed", "debug", "module.account")
        raise HTTPException(status_code=401, detail="Unauthorized")
    log("POST /accounts/delete_token: auth ok, deleting revoked token", "debug", "module.account")
    result = delete_account_token(get_token_user(x_account_token), body.token)
    log("POST /accounts/delete_token: revoked token deleted", "debug", "module.account")
    return result

# This is for getting a specific account
@router.get("/{account_id}", name="get_account")
def get_one_account(account_id: str, auth=Depends(verify_auth), x_account_token: str = Header(..., alias="X-Account-Token")):
    log(f"GET /accounts/{account_id} requested", "debug", "module.account")
    if not auth:
        log(f"GET /accounts/{account_id}: auth check failed", "debug", "module.account")
        raise HTTPException(status_code=401, detail="Unauthorized")

    if account_id == "me":
        log("GET /accounts/me: resolving token to account id", "debug", "module.account")
        resolved_id = get_token_user(x_account_token)
        if not resolved_id:
            log("GET /accounts/me: token did not resolve to any account", "debug", "module.account")
            raise HTTPException(status_code=401, detail="Unauthorized")
        log(f"GET /accounts/me: resolved to account id={resolved_id}", "debug", "module.account")
    else:
        try:
            resolved_id = int(account_id)
            log(f"GET /accounts/{account_id}: parsed to int id={resolved_id}", "debug", "module.account")
        except ValueError:
            log(f"GET /accounts/{account_id}: could not parse as int, returning 422", "debug", "module.account")
            raise HTTPException(status_code=422, detail="Invalid account ID")

    log(f"GET /accounts/{account_id}: checking match for resolved_id={resolved_id}", "debug", "module.account")
    if not match_account(resolved_id, x_account_token, True):
        log(f"GET /accounts/{account_id}: match_account failed for resolved_id={resolved_id}", "debug", "module.account")
        raise HTTPException(status_code=401, detail="Unauthorized")

    log(f"GET /accounts/{account_id}: match ok, fetching account data", "debug", "module.account")
    account = get_account(resolved_id)
    if not account:
        log(f"GET /accounts/{account_id}: account resolved_id={resolved_id} not found", "debug", "module.account")
        raise HTTPException(status_code=404, detail="Account not found")
    log(f"GET /accounts/{account_id}: returning account id={resolved_id}", "debug", "module.account")
    return account

# This is for creating a new account, this one is different for the one used in setup, because this one requires Admin
@router.post("/", status_code=201)
def create_new_account(body: AccountCreate, auth=Depends(verify_admin)):
    log(f"POST /accounts requested name={body.name!r} role={body.role!r} has_avatar={body.avatar_b64 is not None}", "debug", "module.account")
    if not auth:
        log("POST /accounts: auth check failed", "debug", "module.account")
        raise HTTPException(status_code=401, detail="Unauthorized")
    if not body.name.strip():
        log("POST /accounts: name is empty, rejecting", "debug", "module.account")
        raise HTTPException(status_code=400, detail="Name is required")
    if body.role not in ("user", "admin"):
        log(f"POST /accounts: invalid role={body.role!r}", "debug", "module.account")
        raise HTTPException(status_code=400, detail="Role must be 'user' or 'admin'")
    log(f"POST /accounts: validation passed, creating account name={body.name.strip()!r} role={body.role!r}", "debug", "module.account")
    result = create_account(body.name.strip(), body.role, body.avatar_b64)
    log(f"POST /accounts: account created id={result['id']}", "debug", "module.account")
    return result

# This is for updating an existing account, you can only update your own account, unless if you are an admin, then you can update anything
# If you are an admin, you can only update the role of the other user
# You can also not update your own role, even if you are an admin
@router.patch("/{account_id}")
def update_existing_account(account_id: int, body: AccountUpdate, auth=Depends(verify_auth), x_account_token: str = Header(..., alias="X-Account-Token")):
    log(f"PATCH /accounts/{account_id} requested", "debug", "module.account")
    if not auth:
        log(f"PATCH /accounts/{account_id}: auth check failed", "debug", "module.account")
        raise HTTPException(status_code=401, detail="Unauthorized")
    if not x_account_token:
        log(f"PATCH /accounts/{account_id}: missing account token header", "debug", "module.account")
        raise HTTPException(status_code=401, detail="Unauthorized")

    log(f"PATCH /accounts/{account_id}: checking account exists", "debug", "module.account")
    existing = get_account(account_id)
    if not existing:
        log(f"PATCH /accounts/{account_id}: account not found", "debug", "module.account")
        raise HTTPException(status_code=404, detail="Account not found")

    log(f"PATCH /accounts/{account_id}: checking match_account", "debug", "module.account")
    if not match_account(account_id, x_account_token, True):
        log(f"PATCH /accounts/{account_id}: match_account failed", "debug", "module.account")
        raise HTTPException(status_code=401, detail="Unauthorized")

    caller_id = get_token_user(x_account_token)
    caller = get_account(caller_id)

    if body.role is not None:
        if body.role not in ("user", "admin"):
            log(f"PATCH /accounts/{account_id}: invalid role={body.role!r}", "debug", "module.account")
            raise HTTPException(status_code=400, detail="Role must be 'user' or 'admin'")
        if caller["role"] != "admin":
            log(f"PATCH /accounts/{account_id}: non-admin attempted role update", "debug", "module.account")
            raise HTTPException(status_code=403, detail="Forbidden")
        if caller_id == account_id:
            log(f"PATCH /accounts/{account_id}: attempted self role update", "debug", "module.account")
            raise HTTPException(status_code=403, detail="Forbidden")

    log(f"PATCH /accounts/{account_id}: all checks passed, updating", "debug", "module.account")
    updated = update_account(account_id, None, body.role, body.avatar_b64, body.nickname, body.about, body.password, body.old_password)
    log(f"PATCH /accounts/{account_id}: update complete", "debug", "module.account")
    return updated

# This is for deleting a profile picture from an account, for example if it has something innapropriate.
@router.delete("/{account_id}/pfp", status_code=204)
def delete_existing_account_pfp(account_id: int, auth=Depends(verify_admin)):
    log(f"DELETE /accounts/{account_id}/pfp requested", "debug", "module.account")
    if not auth:
        log(f"DELETE /accounts/{account_id}/pfp: auth check failed", "debug", "module.account")
        raise HTTPException(status_code=401, detail="Unauthorized")

    log(f"DELETE /accounts/{account_id}/pfp: checking account exists", "debug", "module.account")
    existing = get_account(account_id)
    if not existing:
        log(f"DELETE /accounts/{account_id}/pfp: account not found", "debug", "module.account")
        raise HTTPException(status_code=404, detail="Account not found")

    log(f"DELETE /accounts/{account_id}/pfp: deleting pfp", "debug", "module.account")
    delete_profile_picture(account_id)
    log(f"DELETE /accounts/{account_id}/pfp: pfp deleted", "debug", "module.account")
    return

# This is for deleting your own account, or deleting an account if you are an admin
@router.delete("/{account_id}", status_code=204)
def delete_existing_account(account_id: int, auth=Depends(verify_auth), x_account_token: str = Header(..., alias="X-Account-Token")):
    log(f"DELETE /accounts/{account_id} requested", "debug", "module.account")
    if not auth:
        log(f"DELETE /accounts/{account_id}: auth check failed", "debug", "module.account")
        raise HTTPException(status_code=401, detail="Unauthorized")
    if not x_account_token:
        log(f"DELETE /accounts/{account_id}: missing account token header", "debug", "module.account")
        raise HTTPException(status_code=401, detail="Unauthorized")
    
    log(f"DELETE /accounts/{account_id}: checking match_account", "debug", "module.account")
    # Setting true in match_account ensures that you can also modify as an admin
    if not match_account(account_id, x_account_token, True):
        log(f"DELETE /accounts/{account_id}: match_account failed", "debug", "module.account")
        raise HTTPException(status_code=401, detail="Unauthorized")
    
    log(f"DELETE /accounts/{account_id}: match ok, deleting", "debug", "module.account")
    if not delete_account(account_id):
        log(f"DELETE /accounts/{account_id}: account not found in db", "debug", "module.account")
        raise HTTPException(status_code=404, detail="Account not found")
    else:
        log(f"DELETE /accounts/{account_id}: deleted successfully", "debug", "module.account")
        return Response(status_code=204)