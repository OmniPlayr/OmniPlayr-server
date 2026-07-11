from __future__ import annotations
from typing import Any, Literal

from api.helpers.db import get_conn, is_safe_sql_identifier
from api.helpers.log import log

ProtectionLevel = Literal["read", "write"]

PROTECTED_TABLES: dict[str, ProtectionLevel] = {
    "accounts": "write",
    "server": "read",
    "setup_state": "read",
    "access_tokens": "read",
    "account_tokens": "read",
    "notifications": "write",
    "initial_notifications_sent": "read",
    "update_cache": "read",
    "backup_codes": "read",
    "current_playback": "write",
}

_ownership: dict[str, str] = {}
_grants: dict[str, dict[str, str]] = {}


def set_table_protection(table: str, level: ProtectionLevel) -> None:
    """Set the plugin access protection level for a database table."""
    old = PROTECTED_TABLES.get(table, "none")
    log(f"set_table_protection: {table!r} {old!r} -> {level!r}", "debug", "plugins")
    PROTECTED_TABLES[table] = level


def remove_table_protection(table: str) -> None:
    """Remove plugin access protection from a database table."""
    if table not in PROTECTED_TABLES:
        log(f"remove_table_protection: {table!r} has no protection, skipping", "debug", "plugins")
        return
    old = PROTECTED_TABLES.pop(table)
    log(f"remove_table_protection: removed {table!r} (was {old!r})", "debug", "plugins")


class PluginDB:
    """Plugin-scoped database helper enforcing table grants and protections."""
    def __init__(self, plugin_key: str, grants: dict[str, str]):
        self._plugin_key = plugin_key
        self._grants = grants

    def _assert_access(self, table: str, mode: str = "read") -> None:
        protection = PROTECTED_TABLES.get(table)

        if protection == "read":
            log(f"[{self._plugin_key}] Access denied: {table!r} is fully protected", "debug", "plugins")
            raise PermissionError(f"Table {table!r} is fully protected and cannot be accessed by plugins")

        if protection == "write" and mode == "write":
            log(f"[{self._plugin_key}] Access denied: {table!r} is write-protected", "debug", "plugins")
            raise PermissionError(f"Table {table!r} is write-protected and cannot be written to by plugins")

        grant = self._grants.get(table)

        if grant is None:
            log(f"[{self._plugin_key}] Access denied: no grant for {table!r}", "debug", "plugins")
            raise PermissionError(f"Plugin {self._plugin_key!r} has not requested access to table {table!r}")

        if mode == "write" and grant == "read":
            log(f"[{self._plugin_key}] Access denied: read-only grant on {table!r}, write requested", "debug", "plugins")
            raise PermissionError(f"Plugin {self._plugin_key!r} only has read access to table {table!r}")

        log(f"[{self._plugin_key}] Access granted: {mode!r} on {table!r}", "debug", "plugins")

    def _safe_col(self, col: str) -> None:
        if not is_safe_sql_identifier(col):
            log(f"[{self._plugin_key}] Invalid column identifier: {col!r}", "debug", "plugins")
            raise ValueError(f"Invalid column name: {col!r}")

    def _safe_table(self, table: str) -> None:
        if not is_safe_sql_identifier(table):
            log(f"[{self._plugin_key}] Invalid table identifier: {table!r}", "debug", "plugins")
            raise ValueError(f"Invalid table name: {table!r}")

    def fetch(
        self,
        table: str,
        where: dict[str, Any] | None = None,
        columns: list[str] | None = None,
        order_by: str | None = None,
        limit: int | None = None,
    ) -> list[dict]:
        """Fetch rows from an accessible table with optional filtering and ordering."""
        log(f"[{self._plugin_key}] fetch: table={table!r} columns={columns!r} where={where!r} order_by={order_by!r} limit={limit!r}", "debug", "plugins")

        self._assert_access(table, "read")
        self._safe_table(table)

        if columns:
            for col in columns:
                self._safe_col(col)
            col_clause = ", ".join(columns)
        else:
            col_clause = "*"

        query = f"SELECT {col_clause} FROM {table}"
        params: list[Any] = []

        if where:
            parts = []
            for col, val in where.items():
                self._safe_col(col)
                parts.append(f"{col} = %s")
                params.append(val)
            query += " WHERE " + " AND ".join(parts)

        if order_by:
            raw_col = order_by.lstrip("-")
            direction = "DESC" if order_by.startswith("-") else "ASC"
            self._safe_col(raw_col)
            query += f" ORDER BY {raw_col} {direction}"

        if limit is not None:
            query += f" LIMIT {int(limit)}"

        log(f"[{self._plugin_key}] fetch query: {query!r} params={params}", "debug", "plugins")

        with get_conn() as conn:
            cur = conn.cursor()
            cur.execute(query, params or None)
            rows = [dict(r) for r in cur.fetchall()]
            log(f"[{self._plugin_key}] fetch: got {len(rows)} row(s) from {table!r}", "debug", "plugins")
            return rows

    def fetch_one(self, table: str, where: dict[str, Any], columns: list[str] | None = None) -> dict | None:
        """Fetch the first row matching a table filter."""
        log(f"[{self._plugin_key}] fetch_one: table={table!r} where={where!r}", "debug", "plugins")
        results = self.fetch(table, where=where, columns=columns, limit=1)
        result = results[0] if results else None
        log(f"[{self._plugin_key}] fetch_one: {'found' if result else 'not found'}", "debug", "plugins")
        return result

    def insert(self, table: str, data: dict[str, Any]) -> dict:
        """Insert a row into a writable table and return the inserted row."""
        log(f"[{self._plugin_key}] insert: table={table!r} cols={list(data.keys())}", "debug", "plugins")

        self._assert_access(table, "write")
        self._safe_table(table)

        cols = list(data.keys())
        for col in cols:
            self._safe_col(col)

        placeholders = ", ".join(["%s"] * len(cols))
        col_clause = ", ".join(cols)
        query = f"INSERT INTO {table} ({col_clause}) VALUES ({placeholders}) RETURNING *"

        log(f"[{self._plugin_key}] insert query: {query!r}", "debug", "plugins")

        with get_conn() as conn:
            cur = conn.cursor()
            cur.execute(query, list(data.values()))
            result = dict(cur.fetchone())
            conn.commit()
            log(f"[{self._plugin_key}] insert: succeeded on {table!r}, id={result.get('id')}", "debug", "plugins")
            return result

    def update(self, table: str, data: dict[str, Any], where: dict[str, Any]) -> int:
        """Update rows in a writable table and return the affected row count."""
        log(f"[{self._plugin_key}] update: table={table!r} set={list(data.keys())} where={list(where.keys())}", "debug", "plugins")

        self._assert_access(table, "write")
        self._safe_table(table)

        set_parts: list[str] = []
        params: list[Any] = []

        for col, val in data.items():
            self._safe_col(col)
            set_parts.append(f"{col} = %s")
            params.append(val)

        where_parts: list[str] = []
        for col, val in where.items():
            self._safe_col(col)
            where_parts.append(f"{col} = %s")
            params.append(val)

        query = f"UPDATE {table} SET {', '.join(set_parts)} WHERE {' AND '.join(where_parts)}"
        log(f"[{self._plugin_key}] update query: {query!r}", "debug", "plugins")

        with get_conn() as conn:
            cur = conn.cursor()
            cur.execute(query, params)
            count = cur.rowcount
            conn.commit()
            log(f"[{self._plugin_key}] update: {count} row(s) affected in {table!r}", "debug", "plugins")
            return count

    def delete(self, table: str, where: dict[str, Any]) -> int:
        """Delete rows from a writable table and return the affected row count."""
        log(f"[{self._plugin_key}] delete: table={table!r} where={list(where.keys())}", "debug", "plugins")

        self._assert_access(table, "write")
        self._safe_table(table)

        where_parts: list[str] = []
        params: list[Any] = []

        for col, val in where.items():
            self._safe_col(col)
            where_parts.append(f"{col} = %s")
            params.append(val)

        query = f"DELETE FROM {table} WHERE {' AND '.join(where_parts)}"
        log(f"[{self._plugin_key}] delete query: {query!r}", "debug", "plugins")

        with get_conn() as conn:
            cur = conn.cursor()
            cur.execute(query, params)
            count = cur.rowcount
            conn.commit()
            log(f"[{self._plugin_key}] delete: {count} row(s) removed from {table!r}", "debug", "plugins")
            return count

    def count(self, table: str, where: dict[str, Any] | None = None) -> int:
        """Count rows in an accessible table with an optional filter."""
        log(f"[{self._plugin_key}] count: table={table!r} where={where!r}", "debug", "plugins")

        self._assert_access(table, "read")
        self._safe_table(table)

        query = f"SELECT COUNT(*) as n FROM {table}"
        params: list[Any] = []

        if where:
            parts = []
            for col, val in where.items():
                self._safe_col(col)
                parts.append(f"{col} = %s")
                params.append(val)
            query += " WHERE " + " AND ".join(parts)

        with get_conn() as conn:
            cur = conn.cursor()
            cur.execute(query, params or None)
            n = cur.fetchone()["n"]
            log(f"[{self._plugin_key}] count: {n} row(s) in {table!r}", "debug", "plugins")
            return n

    @property
    def accessible_tables(self) -> dict[str, str]:
        """Return the table grants available to this plugin."""
        return dict(self._grants)


def _migrate_plugin_tables(plugin_key: str, own_tables: dict[str, dict[str, str]]) -> None:
    log(f"[{plugin_key}] migrate: starting for tables {list(own_tables.keys())}", "debug", "plugins")

    with get_conn() as conn:
        cur = conn.cursor()

        for table, columns in own_tables.items():
            if not is_safe_sql_identifier(table):
                raise ValueError(f"Invalid table name: {table!r}")

            if table in PROTECTED_TABLES:
                log(f"[{plugin_key}] migrate: blocked, {table!r} is protected", "debug", "plugins")
                raise PermissionError(f"Plugin {plugin_key!r} cannot own protected table {table!r}")

            existing_owner = _ownership.get(table)
            if existing_owner and existing_owner != plugin_key:
                log(f"[{plugin_key}] migrate: ownership conflict on {table!r}, owned by {existing_owner!r}", "debug", "plugins")
                raise PermissionError(f"Table {table!r} is already owned by plugin {existing_owner!r}")

            cur.execute(f"CREATE TABLE IF NOT EXISTS {table} (id SERIAL PRIMARY KEY)")

            cur.execute("""
                SELECT column_name
                FROM information_schema.columns
                WHERE table_name = %s
            """, (table,))
            existing_cols = {row["column_name"] for row in cur.fetchall()}
            log(f"[{plugin_key}] migrate: {table!r} existing cols={existing_cols}", "debug", "plugins")

            for col, definition in columns.items():
                if not is_safe_sql_identifier(col):
                    raise ValueError(f"Invalid column name: {col!r}")
                if ";" in definition:
                    raise ValueError(f"Invalid column definition for {table}.{col}")
                if col not in existing_cols:
                    cur.execute(f"ALTER TABLE {table} ADD COLUMN {col} {definition}")
                    log(f"Plugin {plugin_key!r}: added column {table}.{col}", "info", "plugins")

        conn.commit()
        cur.close()
        log(f"[{plugin_key}] migrate: completed", "debug", "plugins")


def request_db_access(
    plugin_key: str,
    *,
    own: dict[str, dict[str, str]] | None = None,
    read: list[str] | None = None,
    readwrite: list[str] | None = None,
) -> PluginDB:
    """Request database table grants for a backend plugin."""
    log(f"[{plugin_key}] request_db_access: own={list(own.keys()) if own else None} read={read!r} readwrite={readwrite!r}", "debug", "plugins")

    grants: dict[str, str] = {}

    if own:
        for table in own:
            if table in PROTECTED_TABLES:
                log(f"[{plugin_key}] request_db_access: cannot own protected table {table!r}", "error", "plugins")
                raise PermissionError(f"Cannot own protected table {table!r}")

            existing_owner = _ownership.get(table)
            if existing_owner and existing_owner != plugin_key:
                log(f"[{plugin_key}] request_db_access: ownership conflict on {table!r}", "error", "plugins")
                raise PermissionError(f"Table {table!r} is already owned by plugin {existing_owner!r}")

            _ownership[table] = plugin_key
            grants[table] = "readwrite"
            log(f"[{plugin_key}] request_db_access: owns {table!r}", "debug", "plugins")

        _migrate_plugin_tables(plugin_key, own)

    if read:
        for table in read:
            protection = PROTECTED_TABLES.get(table)

            if protection == "read":
                log(f"[{plugin_key}] request_db_access: read denied on fully protected table {table!r}", "error", "plugins")
                raise PermissionError(f"Table {table!r} is fully protected")

            if grants.get(table) == "readwrite":
                continue

            grants[table] = "read"
            log(f"[{plugin_key}] request_db_access: granted read on {table!r}", "debug", "plugins")

    if readwrite:
        for table in readwrite:
            protection = PROTECTED_TABLES.get(table)

            if protection == "read":
                log(f"[{plugin_key}] request_db_access: readwrite denied on fully protected table {table!r}", "error", "plugins")
                raise PermissionError(f"Table {table!r} is fully protected")

            if protection == "write":
                log(f"[{plugin_key}] request_db_access: {table!r} is write-protected, downgrading to read", "warning", "plugins")
                grants[table] = "read"
                continue

            owner = _ownership.get(table)
            if owner and owner != plugin_key:
                log(f"[{plugin_key}] request_db_access: {table!r} owned by {owner!r}, downgrading to read", "warning", "plugins")
                grants[table] = "read"
            else:
                grants[table] = "readwrite"
                log(f"[{plugin_key}] request_db_access: granted readwrite on {table!r}", "debug", "plugins")

    _grants[plugin_key] = grants
    log(f"[{plugin_key}] request_db_access: final grants={grants}", "debug", "plugins")
    return PluginDB(plugin_key, grants)