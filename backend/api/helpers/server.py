import secrets
from datetime import datetime, timedelta
from dateutil.relativedelta import relativedelta
from api.helpers.config import get_config
from api.helpers.db import get_conn
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials

def parse_interval(interval_str: str) -> relativedelta:
    number, unit = interval_str.split()
    number = int(number)
    unit = unit.lower()
    
    if unit.startswith("day"):
        return timedelta(days=number)
    elif unit.startswith("month"):
        return relativedelta(months=number)
    elif unit.startswith("year"):
        return relativedelta(years=number)
    else:
        raise ValueError(f"Unknown interval unit: {unit}")
    
security = HTTPBearer()
    
def verify_token(access_token: str):
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT access_token FROM access_tokens WHERE access_token = %s AND access_token_expires > NOW()",
                (access_token,)
            )

            row = cur.fetchone()

            if row is None:
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail="Invalid access token"
                )

            return row["access_token"]

def verify_auth(creds: HTTPAuthorizationCredentials = Depends(security)):
    return verify_token(creds.credentials)

async def create_access_token(password_protected: bool, cur: object, only_access_token: bool = False) -> dict:
    access_token = secrets.token_hex(32) # This returns 64 chars for some random reason, so because we want 64, we have to enter 32 :(
    refresh_token = secrets.token_hex(32)
    
    # You can set the lifetime in the config, under server.toml and then [auth], they have to be formatted like "1 day", "2 months" or "3 years"
    access_lifetime = get_config("auth.access_token_lifetime")
    refresh_lifetime = get_config("auth.refresh_token_lifetime")
    
    access_expires = datetime.now() + parse_interval(access_lifetime)
    refresh_expires = datetime.now() + parse_interval(refresh_lifetime)
    
    cur.execute("""
    INSERT INTO access_tokens
    (access_token, refresh_token, access_token_expires, refresh_token_expires, password_protected)
    VALUES (%s, %s, %s, %s, %s)
    """, (access_token, refresh_token, access_expires, refresh_expires, password_protected))
    
    if only_access_token:
        return {
            "access_token": access_token,
            "refresh_token": refresh_token,
            "access_token_expires": access_expires,
            "refresh_token_expires": refresh_expires,
        }
    
    return {
        "status": "success",
        "access_token": access_token,
        "refresh_token": refresh_token,
        "access_token_expires": access_expires,
        "refresh_token_expires": refresh_expires,
        "message": password_protected and "Access token created successfully" or "Access token created successfully, but consider setting a password",
        "password_protected": password_protected
    }