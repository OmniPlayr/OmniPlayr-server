from api.helpers.db import get_conn
from api.helpers.log import log
import secrets

def list_accounts():
    log("Listing all accounts", "debug", "account")
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT id, name, nickname, role, avatar_b64, created_at FROM accounts ORDER BY id")
            rows = cur.fetchall()
            log(f"Found {len(rows)} account(s)", "debug", "account")
            return rows


def get_account(account_id: int):
    log(f"Fetching account id={account_id}", "debug", "account")
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT id, name, nickname, role, avatar_b64, created_at FROM accounts WHERE id = %s",
                (account_id,),
            )
            row = cur.fetchone()
    if row is None:
        log(f"Account id={account_id} not found", "debug", "account")
    else:
        log(f"Account id={account_id} found: name={row['name']!r} role={row['role']!r}", "debug", "account")
    return row


def create_account(name: str, role: str, avatar_b64: str | None):
    log(f"Creating account name={name!r} role={role!r} has_avatar={avatar_b64 is not None}", "debug", "account")
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO accounts (name, role, avatar_b64)
                VALUES (%s, %s, %s)
                RETURNING id, name, role, avatar_b64, created_at
                """,
                (name, role, avatar_b64),
            )
            row = cur.fetchone()
        conn.commit()
    log(f"Account created id={row['id']} name={row['name']!r} role={row['role']!r}", "debug", "account")
    return row


def update_account(account_id: int, name: str | None, role: str | None, avatar_b64: str | None, nickname: str | None = None):
    log(f"Updating account id={account_id} name={name!r} role={role!r} has_avatar={avatar_b64 is not None}", "debug", "account")
    fields = []
    values = []
    if name is not None:
        fields.append("name = %s")
        values.append(name)
    if role is not None:
        fields.append("role = %s")
        values.append(role)
    if avatar_b64 is not None:
        fields.append("avatar_b64 = %s")
        values.append(avatar_b64)
    if nickname is not None:
        fields.append("nickname = %s")
        values.append(nickname)
    if not fields:
        log(f"No fields to update for account id={account_id}, returning current data", "debug", "account")
        return get_account(account_id)
    log(f"Applying {len(fields)} field update(s) to account id={account_id}: {[f.split(' =')[0] for f in fields]}", "debug", "account")
    values.append(account_id)
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                f"UPDATE accounts SET {', '.join(fields)} WHERE id = %s "
                "RETURNING id, name, nickname, role, avatar_b64, created_at",
                values,
            )
            row = cur.fetchone()
        conn.commit()
    if row is None:
        log(f"Account id={account_id} not found during update, nothing returned", "debug", "account")
    else:
        log(f"Account id={account_id} updated successfully", "debug", "account")
    return row

def delete_account(account_id: int) -> bool:
    log(f"Attempting to delete account id={account_id}", "debug", "account")
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM accounts WHERE id = %s RETURNING id", (account_id,))
            deleted = cur.fetchone()
        conn.commit()
    if deleted:
        log(f"Account id={account_id} deleted successfully", "debug", "account")
    else:
        log(f"Account id={account_id} not found, nothing deleted", "debug", "account")
    return deleted is not None

def create_account_token(account_id: int):
    log(f"Creating account token for account id={account_id}", "debug", "account")
    with get_conn() as conn:
        with conn.cursor() as cur:
            token = secrets.token_hex(32)
            log(f"Token hex generated for account id={account_id}, inserting into db", "debug", "account")
            cur.execute(
                "INSERT INTO account_tokens (account_id, token, password_protected) VALUES (%s, %s, %s) RETURNING token",
                (account_id, token, False),
            )
            row = cur.fetchone()
        conn.commit()
    if row is None:
        log(f"Token insert returned nothing for account id={account_id}", "critical", "account")
    else:
        log(f"Account token created successfully for account id={account_id}", "debug", "account")
    return {
        "token": row["token"],
        "account_id": account_id,
        "password_protected": False,
        "message": "Account token created successfully",
    }