from fastapi import Depends, HTTPException, status, Header
from api.helpers.db import get_conn
from api.helpers.server import verify_auth


def verify_admin(
    auth=Depends(verify_auth),
    x_account_id: int = Header(..., alias="X-Account-Id"),
) -> bool:
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT role FROM accounts WHERE id = %s",
                (x_account_id,),
            )
            row = cur.fetchone()
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Account not found")
    if row["role"] != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin access required")
    return True