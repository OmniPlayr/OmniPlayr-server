import secrets
from datetime import datetime, timedelta
from dateutil.relativedelta import relativedelta
from api.helpers.config import get_config
from api.helpers.db import get_conn
from api.helpers.log import log
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials

def parse_interval(interval_str: str) -> relativedelta:
    log(f"Parsing interval string: {interval_str!r}", "debug", "server")
    number, unit = interval_str.split()
    number = int(number)
    unit = unit.lower()
    
    if unit.startswith("day"):
        log(f"Interval parsed: {number} day(s)", "debug", "server")
        return timedelta(days=number)
    elif unit.startswith("month"):
        log(f"Interval parsed: {number} month(s)", "debug", "server")
        return relativedelta(months=number)
    elif unit.startswith("year"):
        log(f"Interval parsed: {number} year(s)", "debug", "server")
        return relativedelta(years=number)
    else:
        log(f"Unknown interval unit: {unit!r}", "error", "server")
        raise ValueError(f"Unknown interval unit: {unit}")
    
security = HTTPBearer()
    
def verify_token(access_token: str):
    log(f"Verifying access token (len={len(access_token)})", "debug", "server")
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT access_token FROM access_tokens WHERE access_token = %s AND access_token_expires > NOW() AND revoked = false",
                (access_token,)
            )

            row = cur.fetchone()

            if row is None:
                log("Access token not found or expired", "debug", "server")
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail="Invalid access token"
                )

            log("Access token verified successfully", "debug", "server")
            return row["access_token"]

def verify_auth(creds: HTTPAuthorizationCredentials = Depends(security)):
    log("Verifying bearer auth credentials", "debug", "server")
    result = verify_token(creds.credentials)
    log("Bearer auth verified", "debug", "server")
    return result

def match_account(account_id: int, account_token: str, allow_admin_force: bool = False) -> bool:
    log(f"Matching account id={account_id} allow_admin_force={allow_admin_force}", "debug", "server")
    from api.helpers.admin import get_admin_status
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT account_id FROM account_tokens WHERE token = %s AND revoked = false", (account_token,))
            row = cur.fetchone()
            if row is None:
                log(f"Account token not found or revoked for account id={account_id}", "debug", "server")
                return False

            token_account_id = row["account_id"]
            log(f"Token belongs to account id={token_account_id}, requested account id={account_id}", "debug", "server")

            if token_account_id == account_id:
                log(f"Account id={account_id} matches token owner, access granted", "debug", "server")
                return True

            if allow_admin_force and get_admin_status(token_account_id):
                log(f"Admin account id={token_account_id} force-accessing account id={account_id}", "debug", "server")
                return True

            log(f"Account id={token_account_id} is not account id={account_id} and not admin, access denied", "debug", "server")
            return False

def get_token_user(token: str):
    log(f"Looking up user for account token (len={len(token) if token else 0})", "debug", "server")
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT account_id FROM account_tokens WHERE token = %s AND revoked = false", (token,))
            row = cur.fetchone()
            if row is None:
                log("No account found for token (not found or revoked)", "debug", "server")
                return None

            account_id = row["account_id"]
            log(f"Token resolved to account id={account_id}", "debug", "server")
            return account_id


async def create_access_token(password_protected: bool, cur: object, only_access_token: bool = False) -> dict:
    log(f"Creating access token password_protected={password_protected} only_access_token={only_access_token}", "debug", "server")
    access_token = secrets.token_hex(32) # This returns 64 chars for some random reason, so because we want 64, we have to enter 32 :(
    refresh_token = secrets.token_hex(32)
    
    # You can set the lifetime in the config, under server.toml and then [auth], they have to be formatted like "1 day", "2 months" or "3 years"
    access_lifetime = get_config("auth.access_token_lifetime")
    refresh_lifetime = get_config("auth.refresh_token_lifetime")

    log(f"Token lifetimes: access={access_lifetime!r} refresh={refresh_lifetime!r}", "debug", "server")
    
    access_expires = datetime.now() + parse_interval(access_lifetime)
    refresh_expires = datetime.now() + parse_interval(refresh_lifetime)

    log(f"Token expiry: access={access_expires} refresh={refresh_expires}", "debug", "server")
    
    cur.execute("""
    INSERT INTO access_tokens
    (access_token, refresh_token, access_token_expires, refresh_token_expires, password_protected)
    VALUES (%s, %s, %s, %s, %s)
    """, (access_token, refresh_token, access_expires, refresh_expires, password_protected))
    
    log("Access token inserted into db", "debug", "server")
    
    if only_access_token:
        log("Returning token-only response (no status wrapper)", "debug", "server")
        return {
            "access_token": access_token,
            "refresh_token": refresh_token,
            "access_token_expires": access_expires,
            "refresh_token_expires": refresh_expires,
        }
    
    log("Returning full token response", "debug", "server")
    return {
        "status": "success",
        "access_token": access_token,
        "refresh_token": refresh_token,
        "access_token_expires": access_expires,
        "refresh_token_expires": refresh_expires,
        "message": password_protected and "Access token created successfully" or "Access token created successfully, but consider setting a password",
        "password_protected": password_protected
    }