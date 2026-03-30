from fastapi import APIRouter, Request, HTTPException, Body
from pydantic import BaseModel
from api.helpers.db import get_conn
from api.helpers.passwords import password_hash, password_check
from api.helpers.server import create_access_token
from typing import Optional

router = APIRouter()

class ServerPassword(BaseModel):
    password: Optional[str] = None
    
@router.post("/password")
async def set_server_password(password: ServerPassword, request: Request):
    is_https = request.url.scheme == "https" or request.headers.get("x-forwarded-proto") == "https"
        
    token_response = {}
    
    saved = False
    
    if not password.password:
        raise HTTPException(status_code=400, detail="Password is required")
    
    if len(password.password) < 8:
        raise HTTPException(status_code=400, detail="Password must be at least 8 characters long")
    
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "UPDATE server SET password = %s, pass_https = %s WHERE id = 1 AND password IS NULL",
                (password_hash(password.password), is_https)
            )
        
            # This checks if the password is set, if its 0 the password has already been set
            if cur.rowcount == 0:
                saved = False
                cur.execute(
                    "SELECT password FROM server WHERE id = 1 AND password IS NOT NULL"
                )
                stored_password = cur.fetchone()
                
                if password_check(password.password, stored_password["password"]):
                    token_response = await create_access_token(password_protected=True, cur=cur, only_access_token=True)
                else:
                    raise HTTPException(status_code=400, detail="Invalid password")
            else:
                saved = True
                conn.commit()
                token_response = await create_access_token(password_protected=True, cur=cur, only_access_token=True)

    return {
        "message": saved and "Password set successfully" or "Password already set",
        **token_response
    }

@router.post("/token")
async def get_server_token(password: Optional[ServerPassword] = Body(None)):
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT password FROM server WHERE id = 1 AND password IS NOT NULL"
            )
            stored_password = cur.fetchone()
            
            if stored_password is None:
                response = await create_access_token(password_protected=False, cur=cur)
                conn.commit()
                return response
            
            if not password.password:
                raise HTTPException(status_code=400, detail="Password is required")
            
            if not password_check(password.password, stored_password["password"]):
                raise HTTPException(status_code=400, detail="Invalid password")
            
            response = await create_access_token(password_protected=True, cur=cur)
            conn.commit()
            return response
            