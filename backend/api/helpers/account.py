from api.helpers.db import get_conn


def list_accounts():
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT id, name, role, avatar_b64, created_at FROM accounts ORDER BY id")
            return cur.fetchall()


def get_account(account_id: int):
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT id, name, role, avatar_b64, created_at FROM accounts WHERE id = %s",
                (account_id,),
            )
            return cur.fetchone()


def create_account(name: str, role: str, avatar_b64: str | None):
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
    return row


def update_account(account_id: int, name: str | None, role: str | None, avatar_b64: str | None):
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
    if not fields:
        return get_account(account_id)
    values.append(account_id)
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                f"UPDATE accounts SET {', '.join(fields)} WHERE id = %s "
                "RETURNING id, name, role, avatar_b64, created_at",
                values,
            )
            row = cur.fetchone()
        conn.commit()
    return row


def delete_account(account_id: int) -> bool:
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM accounts WHERE id = %s RETURNING id", (account_id,))
            deleted = cur.fetchone()
        conn.commit()
    return deleted is not None