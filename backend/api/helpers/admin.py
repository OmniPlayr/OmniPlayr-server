from fastapi import Depends, HTTPException, status, Header
from api.helpers.db import get_conn
from api.helpers.server import verify_auth, get_token_user
from api.helpers.log import log

def verify_admin(
    auth=Depends(verify_auth),
    x_account_token: str = Header(..., alias="X-Account-Token"),
) -> bool:
    log("Verifying admin access", "debug", "admin")

    account_id = get_token_user(x_account_token)

    if account_id is None:
        log("Account token resolved to no account, rejecting admin access", "debug", "admin")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid account token"
        )

    log(f"Account token resolved to account id={account_id}, checking admin status", "debug", "admin")

    if not get_admin_status(account_id):
        log(f"Unauthorized admin access by account id={account_id}", "debug", "admin")
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin access required"
        )
    
    log(f"Authorized admin access by account id={account_id}", "debug", "admin")
    return True

def get_admin_status(account_id: int) -> bool:
    log(f"Checking admin status for account id={account_id}", "debug", "admin")
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT role FROM accounts WHERE id = %s",
                (account_id,),
            )
            row = cur.fetchone()

    if row is None:
        log(f"Account id={account_id} not found during admin check", "debug", "admin")
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Account not found"
        )

    is_admin = row["role"] == "admin"
    log(f"Account id={account_id} role={row['role']!r} is_admin={is_admin}", "debug", "admin")
    return is_admin