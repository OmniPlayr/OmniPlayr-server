from fastapi import Depends, HTTPException, status, Header
from api.helpers.db import get_conn
from api.helpers.server import verify_auth, get_token_user
def verify_admin(
    auth=Depends(verify_auth),
    x_account_token: str = Header(..., alias="X-Account-Token"),
) -> bool:
    
    account_id = get_token_user(x_account_token)

    if not get_admin_status(account_id):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin access required"
        )

    return True

def get_admin_status(account_id: int) -> bool:
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT role FROM accounts WHERE id = %s",
                (account_id,),
            )
            row = cur.fetchone()

    if row is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Account not found"
        )

    return row["role"] == "admin"