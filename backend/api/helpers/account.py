from api.helpers.db import get_conn
from api.helpers.log import log
import secrets
from api.helpers.passwords import password_hash, password_check
import pyotp
import qrcode
import io
import base64

def list_accounts():
    log("Listing all accounts", "debug", "account")
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT id, name, nickname, role, avatar_b64, created_at, about, password, two_factor_enabled FROM accounts ORDER BY id")
            rows = cur.fetchall()
            for row in rows:
                row["password_protected"] = bool(row["password"])
                row.pop("password")
            log(f"Found {len(rows)} account(s)", "debug", "account")
            return rows


def list_account_summaries():
    """Return account identity fields without loading large profile images."""
    log("Listing account summaries", "debug", "account")
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT id, name FROM accounts ORDER BY id")
            rows = cur.fetchall()
            log(f"Found {len(rows)} account summary row(s)", "debug", "account")
            return rows


def get_account_summary(account_id: int):
    """Return identity fields without loading profile images or account tokens."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT id, name FROM accounts WHERE id = %s", (account_id,))
            return cur.fetchone()


def get_account(account_id: int):
    log(f"Fetching account id={account_id}", "debug", "account")
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT id, name, nickname, role, avatar_b64, created_at, about, password, two_factor_enabled FROM accounts WHERE id = %s",
                (account_id,),
            )
            row = cur.fetchone()

            if row is not None:
                row["password_protected"] = bool(row["password"])
                row.pop("password")
            
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


def update_account(account_id: int, name: str | None, role: str | None, avatar_b64: str | None, nickname: str | None = None, about: str | None = None, password: str | None = None, old_password: str | None = None):
    remove_password = password == ""
    hashed_password = password_hash(password) if password else None
    log(f"Updating account id={account_id} name={name!r} nickname={nickname!r} about={about!r} role={role!r} has_avatar={avatar_b64 is not None} has_password={hashed_password is not None} remove_password={remove_password}", "debug", "account")
    
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT password FROM accounts WHERE id = %s", (account_id,))
            row = cur.fetchone()
            if row is None:
                log(f"Account id={account_id} not found", "debug", "account")
                return None
            
            if password is not None and old_password is None:
                if not row["password"]:
                    log(f"Account id={account_id} has no old password", "debug", "account")
                    pass
                else:
                    log(f"Updating account id={account_id} requires old password", "debug", "account")
                    return None
            
            if old_password is not None and password is not None:
                if not row["password"]:
                    log(f"Account id={account_id} has no old password", "debug", "account")
                    pass
                if not password_check(old_password, row["password"]):
                    log(f"Account id={account_id} old password incorrect", "debug", "account")
                    return None

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
    if hashed_password is not None:
        fields.append("password = %s")
        values.append(hashed_password)
    elif remove_password:
        fields.append("password = NULL")
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
            if row is not None and (hashed_password is not None or remove_password):
                cur.execute(
                    "UPDATE account_tokens SET revoked = true WHERE account_id = %s AND revoked = false",
                    (account_id,),
                )
                log(f"Revoked all active tokens for account id={account_id} after password change", "debug", "account")
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


# This checks if the user has a password set and if the password is correct
def verify_account_password(account_id: int, password: str) -> str:
    log(f"Verifying account password for account id={account_id}", "debug", "account")
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT password FROM accounts WHERE id = %s", (account_id,))
            row = cur.fetchone()
            if row is None:
                log(f"Account id={account_id} not found", "debug", "account")
                return "not_found"
            if not row["password"]:
                log(f"Account id={account_id} has no password", "debug", "account")
                return "no_password"
            return "match" if password_check(password, row["password"]) else "no_match"

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

# This creates the 2FA Secret and QR code, and returns it
def create_2fa_setup(account_id: int):
    log(f"Creating 2FA setup for account id={account_id}", "debug", "account")
    secret = pyotp.random_base32()
    
    with get_conn() as conn:
        with conn.cursor() as cur:            
            log(f"Checking if account id={account_id} has a password", "debug", "account")            
            log(f"Getting username for account id={account_id}", "debug", "account")
            cur.execute(
                "SELECT two_factor_enabled FROM accounts WHERE id = %s",
                (account_id,)
            )
            two_factor_enabled = cur.fetchone()
            if two_factor_enabled["two_factor_enabled"] is True and two_factor_enabled is not None:
                log(f"Account id={account_id} already has 2FA enabled", "warn", "account")
                return {
                    "secret": None,
                    "qr": None,
                    "message": "2FA already enabled"
                }
            
            cur.execute(
                "SELECT name FROM accounts WHERE id = %s AND password IS NOT NULL",
                (account_id,)
            )
            username = cur.fetchone()
            if username is None:
                log(f"Account id={account_id} does not have a password", "warn", "account")
                return {
                    "secret": None,
                    "qr": None,
                    "message": "You must have a password to enable 2FA"
                }
            log(f"Account id={account_id} has a password", "debug", "account")
            
            log(f"Account id={account_id} has username {username['name']}", "debug", "account")

            uri = pyotp.TOTP(secret).provisioning_uri(
                name=username["name"],
                issuer_name="OmniPlayr",
            )
            log(f"2FA url created for account id={account_id}", "debug", "account")
            img = qrcode.make(uri)
            buffer = io.BytesIO()
            img.save(buffer, format="PNG")
            qr_base64 = base64.b64encode(buffer.getvalue()).decode("utf-8")
            
            log(f"2FA setting secret for account id={account_id}", "debug", "account")
            cur.execute(
                "UPDATE accounts SET two_factor_secret = %s WHERE id = %s",
                (secret, account_id)
            )
            conn.commit()
            log(f"2FA setup created successfully for account id={account_id}", "debug", "account")
            return {
                "secret": secret,
                "qr": f"data:image/png;base64,{qr_base64}",
                "message": "Please verify code to enable 2FA"
            }

# This is to check if the 2FA code is valid, if it is and 2FA is not enabled, it will enable 2FA
def verify_2fa_code(account_id: int, code: str, allow_enabled_bypass: bool = False):
    log(f"Verifying 2FA code for account id={account_id}", "debug", "account")
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT two_factor_secret, two_factor_enabled FROM accounts WHERE id = %s AND password IS NOT NULL",
                (account_id,)
            )
            account = cur.fetchone()

            if account is None or account["two_factor_secret"] is None:
                log(f"Account id={account_id} does not have a 2FA secret", "warn", "account")
                return "no_secret"

            if allow_enabled_bypass is False and account["two_factor_enabled"] is False:
                log(f"Account id={account_id} does not have 2FA enabled", "warn", "account")
                return "no_secret"

            totp = pyotp.TOTP(account["two_factor_secret"])

            if totp.verify(code, valid_window=1):
                log(f"2FA code verified for account id={account_id}", "debug", "account")
                cur.execute(
                    "UPDATE accounts SET two_factor_enabled = true WHERE id = %s AND two_factor_enabled = false",
                    (account_id,)
                )
                conn.commit()
                log(f"2FA enabled for account id={account_id}", "debug", "account")
                return "success"

            log(f"2FA code verification failed for account id={account_id}", "warn", "account")
            return "failed"

# This deletes 2fa for an account if its enabled 
def delete_2fa(account_id: int, code: str):
    log(f"Deleting 2FA for account id={account_id}", "debug", "account")
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT two_factor_secret FROM accounts WHERE id = %s AND two_factor_secret IS NOT NULL AND password IS NOT NULL",
                (account_id,)
            )
            secret = cur.fetchone()
            if secret is None:
                log(f"Account id={account_id} does not have a 2FA secret", "warn", "account")
                return "no_secret"
            
            totp = pyotp.TOTP(secret["two_factor_secret"])
            if totp.verify(code, valid_window=1):
                log(f"2FA code verified for account id={account_id}", "debug", "account")
                cur.execute(
                    "UPDATE accounts SET two_factor_enabled = false, two_factor_secret = NULL WHERE id = %s AND two_factor_enabled = true",
                    (account_id,)
                )
                conn.commit()
                log(f"2FA deleted for account id={account_id}", "debug", "account")
                return "success"
            log(f"2FA code verification failed for account id={account_id}", "warn", "account")
            return "failed"
