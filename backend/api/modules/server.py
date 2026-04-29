from fastapi import APIRouter, Request, HTTPException, Body
from pydantic import BaseModel
from api.helpers.db import get_conn
from api.helpers.passwords import password_hash, password_check
from api.helpers.server import create_access_token
from api.helpers.log import log
from typing import Optional

router = APIRouter()

class ServerPassword(BaseModel):
    password: Optional[str] = None
    
@router.post("/password")
async def set_server_password(password: ServerPassword, request: Request):
    is_https = request.url.scheme == "https" or request.headers.get("x-forwarded-proto") == "https"
    log(f"POST /server/password: is_https={is_https} has_password={password.password is not None}", "debug", "module.server")
        
    token_response = {}
    
    saved = False
    
    if not password.password:
        log("POST /server/password: no password provided, rejecting", "debug", "module.server")
        raise HTTPException(status_code=400, detail="Password is required")
    
    if len(password.password) < 8:
        log(f"POST /server/password: password too short (len={len(password.password)}), rejecting", "debug", "module.server")
        raise HTTPException(status_code=400, detail="Password must be at least 8 characters long")
    
    log("POST /server/password: password validation passed, attempting to set", "debug", "module.server")
    
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "UPDATE server SET password = %s, pass_https = %s WHERE id = 1 AND password IS NULL",
                (password_hash(password.password), is_https)
            )
        
            # This checks if the password is set, if its 0 the password has already been set
            if cur.rowcount == 0:
                saved = False
                log("POST /server/password: password already set, verifying provided password", "debug", "module.server")
                cur.execute(
                    "SELECT password FROM server WHERE id = 1 AND password IS NOT NULL"
                )
                stored_password = cur.fetchone()
                
                if stored_password is None:
                    log("POST /server/password: no stored password found but rowcount=0, unexpected state", "critical", "module.server")
                    raise HTTPException(status_code=500, detail="Unexpected server state")

                log("POST /server/password: checking provided password against stored hash", "debug", "module.server")
                if password_check(password.password, stored_password["password"]):
                    log("POST /server/password: password matches, creating access token", "debug", "module.server")
                    token_response = await create_access_token(password_protected=True, cur=cur, only_access_token=True)
                else:
                    log("POST /server/password: password does not match stored hash", "debug", "module.server")
                    raise HTTPException(status_code=400, detail="Invalid password")
            else:
                saved = True
                log("POST /server/password: password set for the first time, creating access token", "debug", "module.server")
                conn.commit()
                token_response = await create_access_token(password_protected=True, cur=cur, only_access_token=True)

    log(f"POST /server/password: completed saved={saved}", "debug", "module.server")
    return {
        "message": saved and "Password set successfully" or "Password already set",
        **token_response
    }

@router.post("/token")
async def get_server_token(password: Optional[ServerPassword] = Body(None)):
    log("POST /server/token: requested", "debug", "module.server")
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT password FROM server WHERE id = 1 AND password IS NOT NULL"
            )
            stored_password = cur.fetchone()
            
            if stored_password is None:
                log("POST /server/token: no password set, issuing unprotected token", "debug", "module.server")
                response = await create_access_token(password_protected=False, cur=cur)
                conn.commit()
                log("POST /server/token: unprotected token issued", "debug", "module.server")
                return response
            
            log("POST /server/token: server has a password, checking provided password", "debug", "module.server")
            if not password or not password.password:
                log("POST /server/token: password required but not provided", "debug", "module.server")
                raise HTTPException(status_code=400, detail="Password is required")
            
            log("POST /server/token: verifying password", "debug", "module.server")
            if not password_check(password.password, stored_password["password"]):
                log("POST /server/token: password check failed", "debug", "module.server")
                raise HTTPException(status_code=400, detail="Invalid password")
            
            log("POST /server/token: password verified, issuing protected token", "debug", "module.server")
            response = await create_access_token(password_protected=True, cur=cur)
            conn.commit()
            log("POST /server/token: protected token issued", "debug", "module.server")
            return response