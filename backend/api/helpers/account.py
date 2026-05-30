from api.helpers.db import get_conn
from api.helpers.log import log
import secrets

def list_accounts():
    log("Listing all accounts", "debug", "account")
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT id, name, nickname, role, avatar_b64, created_at, about FROM accounts ORDER BY id")
            rows = cur.fetchall()
            log(f"Found {len(rows)} account(s)", "debug", "account")
            return rows


def get_account(account_id: int):
    log(f"Fetching account id={account_id}", "debug", "account")
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT id, name, nickname, role, avatar_b64, created_at, about FROM accounts WHERE id = %s",
                (account_id,),
            )
            row = cur.fetchone()
            
            cur.execute(
                "SELECT token, password_protected, revoked, user_agent, ip_address, created_at FROM account_tokens WHERE account_id = %s",
                (account_id,)
            )
            tokens = cur.fetchall()

            for token in tokens:
                value = token["token"]
                token["token"] = f"{value[:4]}*****{value[-4:]}" if len(value) > 8 else "*****"

            if row is not None:
                row["tokens"] = tokens

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


def update_account(account_id: int, name: str | None, role: str | None, avatar_b64: str | None, nickname: str | None = None, about: str | None = None):
    log(f"Updating account id={account_id} name={name!r} nickname={nickname!r} about={about!r} role={role!r} has_avatar={avatar_b64 is not None}", "debug", "account")
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
    if about is not None:
        fields.append("about = %s")
        values.append(about)
    if not fields:
        log(f"No fields to update for account id={account_id}, returning current data", "debug", "account")
        return get_account(account_id)
    log(f"Applying {len(fields)} field update(s) to account id={account_id}: {[f.split(' =')[0] for f in fields]}", "debug", "account")
    values.append(account_id)
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                f"UPDATE accounts SET {', '.join(fields)} WHERE id = %s "
                "RETURNING id, name, nickname, about, role, avatar_b64, created_at",
                values,
            )
            row = cur.fetchone()
        conn.commit()
    if row is None:
        log(f"Account id={account_id} not found during update, nothing returned", "debug", "account")
    else:
        log(f"Account id={account_id} updated successfully", "debug", "account")
    return row

def delete_profile_picture(account_id: int) -> bool:
    log(f"Attempting to delete profile picture for account id={account_id}", "debug", "account")
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("UPDATE accounts SET avatar_b64 = NULL WHERE id = %s RETURNING id", (account_id,))
            deleted = cur.fetchone()
        conn.commit()
    if deleted:
        log(f"Profile picture deleted successfully for account id={account_id}", "debug", "account")
    else:
        log(f"Account id={account_id} not found, nothing deleted", "debug", "account")
    return deleted is not None

def delete_account(account_id: int, force: bool = False) -> bool:
    log(f"Attempting to delete account id={account_id}", "debug", "account")
    with get_conn() as conn:
        with conn.cursor() as cur:
            if not force:
                cur.execute("SELECT role FROM accounts WHERE id = %s", (account_id,))
                account = cur.fetchone()

                if account and account["role"] == "admin":
                    cur.execute("SELECT COUNT(*) FROM accounts WHERE role = 'admin'")
                    admin_count = cur.fetchone()["count"]
                    if admin_count <= 1:
                        log(f"Cannot delete account id={account_id}: last remaining admin", "debug", "account")
                        return False

            cur.execute("DELETE FROM accounts WHERE id = %s RETURNING id", (account_id,))
            deleted = cur.fetchone()
        conn.commit()
    if deleted:
        log(f"Account id={account_id} deleted successfully", "debug", "account")
    else:
        log(f"Account id={account_id} not found, nothing deleted", "debug", "account")
    return deleted is not None

def create_account_token(account_id: int, password_protected: bool = False, user_agent: str | None = None, ip_address: str | None = None):
    log(f"Creating account token for account id={account_id}", "debug", "account")
    with get_conn() as conn:
        with conn.cursor() as cur:
            token = secrets.token_hex(32)
            log(f"Token hex generated for account id={account_id}, inserting into db", "debug", "account")
            cur.execute(
                "INSERT INTO account_tokens (account_id, token, password_protected, user_agent, ip_address) VALUES (%s, %s, %s, %s, %s) RETURNING token",
                (account_id, token, password_protected, user_agent, ip_address),
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

def revoke_token(account_id: int, token: str | None, revoke_all: bool = False):
    log(f"Revoking token for account id={account_id}", "debug", "account")
    def mask(value: str):
        return f"{value[:4]}*****{value[-4:]}" if len(value) > 8 else "*****"
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT token FROM account_tokens WHERE account_id = %s AND revoked = false",
                (account_id,),
            )
            rows = cur.fetchall()
            if token is None:
                if not revoke_all:
                    log(f"No token provided and revoke_all is false for account id={account_id}", "warn", "account")
                    return False
                if not rows:
                    log(f"No active tokens found for account id={account_id}", "warn", "account")
                    return False
                cur.execute(
                    "UPDATE account_tokens SET revoked = true WHERE account_id = %s AND revoked = false",
                    (account_id,),
                )
            else:
                match = None
                for row in rows:
                    db_token = row["token"]
                    if mask(db_token) == token:
                        match = db_token
                        break
                if not match:
                    log(f"No matching token found for account id={account_id}", "warn", "account")
                    return False
                cur.execute(
                    "UPDATE account_tokens SET revoked = true WHERE account_id = %s AND token = %s",
                    (account_id, match),
                )
        conn.commit()
    log(f"Token revoked for account id={account_id}", "debug", "account")
    return True

def delete_account_token(account_id: int, token: str):
    log(f"Deleting revoked token for account id={account_id}", "debug", "account")

    def mask(value: str):
        return f"{value[:4]}*****{value[-4:]}" if len(value) > 8 else "*****"

    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT token FROM account_tokens WHERE account_id = %s AND revoked = true",
                (account_id,),
            )
            rows = cur.fetchall()

            match = None
            for row in rows:
                db_token = row["token"]
                if mask(db_token) == token:
                    match = db_token
                    break

            if not match:
                log(f"No matching token found for account id={account_id}", "warn", "account")
                return False

            cur.execute(
                "DELETE FROM account_tokens WHERE account_id = %s AND token = %s AND revoked = true",
                (account_id, match),
            )

        conn.commit()

    log(f"Revoked token deleted for account id={account_id}", "debug", "account")
    return True