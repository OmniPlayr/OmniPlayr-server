import os
import re
import psycopg2
import psycopg2.pool
from psycopg2.extras import RealDictCursor
from contextlib import contextmanager
from api.helpers.userwarn import user_warn
from api.helpers.log import log

DATABASE_URL = os.getenv("DATABASE_URL", "postgres://postgres:password@db:5432/omniplayr")

# This initializes the database, and will make sure all the tables exist, so if you update your server it will always keep working
# So any changes you make to the database should be done here
SCHEMA = {
    "accounts": {
        "id": "SERIAL PRIMARY KEY",
        "name": "VARCHAR(255) NOT NULL",
        "nickname": "VARCHAR(255) DEFAULT NULL",
        "about": "TEXT DEFAULT NULL",
        "role": "VARCHAR(50) NOT NULL DEFAULT 'user'",
        "avatar_b64": "TEXT",
        "created_at": "TIMESTAMPTZ NOT NULL DEFAULT NOW()"
    },
    "server": {
        "id": "INT PRIMARY KEY DEFAULT 1",
        "password": "VARCHAR(255)",
        "pass_https": "BOOLEAN NOT NULL DEFAULT FALSE",
        "created_at": "TIMESTAMPTZ NOT NULL DEFAULT NOW()"
    },
    "setup_state": {
        "id": "INT PRIMARY KEY DEFAULT 1",
        "current_step": "INT NOT NULL DEFAULT 0",
        "completed": "BOOLEAN NOT NULL DEFAULT FALSE",
        "updated_at": "TIMESTAMPTZ NOT NULL DEFAULT NOW()"
    },
    "access_tokens": {
        "id": "SERIAL PRIMARY KEY",
        "access_token": "VARCHAR(255) NOT NULL",
        "refresh_token": "VARCHAR(255) NOT NULL",
        "access_token_expires": "TIMESTAMPTZ NOT NULL",
        "refresh_token_expires": "TIMESTAMPTZ NOT NULL",
        "created_at": "TIMESTAMPTZ NOT NULL DEFAULT NOW()",
        "password_protected": "BOOLEAN NOT NULL",
        "revoked": "BOOLEAN NOT NULL DEFAULT FALSE"
    },
    "account_tokens": {
        "id": "SERIAL PRIMARY KEY",
        "account_id": "INT NOT NULL",
        "token": "VARCHAR(255) NOT NULL",
        "created_at": "TIMESTAMPTZ NOT NULL DEFAULT NOW()",
        "password_protected": "BOOLEAN NOT NULL",
        "revoked": "BOOLEAN NOT NULL DEFAULT FALSE"
    },
    "update_cache": {
        "id": "INT PRIMARY KEY DEFAULT 1",
        "last_checked": "TIMESTAMPTZ NOT NULL DEFAULT NOW()",
        "latest_version": "VARCHAR(50) NOT NULL DEFAULT '0.0.0'",
        "latest_frontend_version": "VARCHAR(50) NOT NULL DEFAULT '0.0.0'",
        "update_available": "BOOLEAN NOT NULL DEFAULT FALSE",
        "tarball_url": "TEXT"
    },
    "notifications": {
        "id": "SERIAL PRIMARY KEY",
        "account_id": "INT NOT NULL",
        "notification_key": "VARCHAR(255)",
        "icon": "VARCHAR(255) NOT NULL",
        "title": "VARCHAR(255) NOT NULL",
        "text": "TEXT NOT NULL",
        "action_type": "VARCHAR(50)",
        "action_url": "TEXT",
        "read": "BOOLEAN NOT NULL DEFAULT FALSE",
        "created_at": "TIMESTAMPTZ NOT NULL DEFAULT NOW()"
    },
    "initial_notifications_sent": {
        "id": "SERIAL PRIMARY KEY",
        "notification_key": "VARCHAR(255) NOT NULL",
        "account_id": "INT NOT NULL",
        "sent_at": "TIMESTAMPTZ NOT NULL DEFAULT NOW()"
    },
}

_pool: psycopg2.pool.ThreadedConnectionPool | None = None

def _get_pool() -> psycopg2.pool.ThreadedConnectionPool:
    global _pool
    if _pool is None:
        log("Creating database connection pool", "debug", "db")
        _pool = psycopg2.pool.ThreadedConnectionPool(
            minconn=2,
            maxconn=10,
            dsn=DATABASE_URL,
            cursor_factory=RealDictCursor,
        )
        log("Database connection pool created", "debug", "db")
    return _pool

@contextmanager
def get_conn():
    pool = _get_pool()
    conn = pool.getconn()
    log("Acquired connection from pool", "debug", "db")
    try:
        yield conn
    except Exception:
        conn.rollback()
        raise
    finally:
        pool.putconn(conn)
        log("Released connection back to pool", "debug", "db")

# This checks if the sql is safe, because we dont want sql injection
def is_safe_sql_identifier(name):
    result = re.match(r'^[a-zA-Z_][a-zA-Z0-9_]*$', name) is not None
    if not result:
        log(f"Unsafe SQL identifier detected: {name!r}", "critical", "db")
    return result

def parse_column_type(definition):
    definition = definition.strip()
    parts = definition.split()
    base_type = parts[0].upper()
    
    type_map = {
        'VARCHAR': 'character varying',
        'TEXT': 'text',
        'INT': 'integer',
        'INTEGER': 'integer',
        'SERIAL': 'integer',
        'BOOLEAN': 'boolean',
        'BOOL': 'boolean',
        'TIMESTAMPTZ': 'timestamp with time zone',
        'TIMESTAMP': 'timestamp without time zone'
    }
    
    for schema_type, pg_type in type_map.items():
        if base_type.startswith(schema_type):
            log(f"Parsed column type {base_type!r} -> {pg_type!r}", "debug", "db")
            return pg_type
    
    log(f"No mapping found for column type {base_type!r}, returning lowercased", "debug", "db")
    return base_type.lower()

def can_convert_column(cur, table, col, from_type, to_type):
    log(f"Checking if {table}.{col} can be converted from {from_type!r} to {to_type!r}", "debug", "db")
    try:
        cur.execute(f"""
            SELECT COUNT(*) as total,
                   COUNT(CASE WHEN {col} IS NOT NULL THEN 1 END) as non_null
            FROM {table}
        """)
        counts = cur.fetchone()
        log(f"{table}.{col}: total={counts['total']} non_null={counts['non_null']}", "debug", "db")
        
        if counts['total'] == 0:
            log(f"{table}.{col}: empty table, conversion is safe", "debug", "db")
            return True
        
        if to_type in ['integer', 'bigint', 'smallint']:
            cur.execute(f"""
                SELECT COUNT(*) as convertible
                FROM {table}
                WHERE {col} IS NULL OR {col}::text ~ '^-?[0-9]+$'
            """)
            result = cur.fetchone()
            safe = result['convertible'] == counts['total']
            log(f"{table}.{col}: integer conversion safe={safe} convertible={result['convertible']}/{counts['total']}", "debug", "db")
            return safe
        
        if to_type == 'boolean':
            cur.execute(f"""
                SELECT COUNT(*) as convertible
                FROM {table}
                WHERE {col} IS NULL OR 
                      LOWER({col}::text) IN ('true', 'false', 't', 'f', '1', '0', 'yes', 'no', 'y', 'n')
            """)
            result = cur.fetchone()
            safe = result['convertible'] == counts['total']
            log(f"{table}.{col}: boolean conversion safe={safe}", "debug", "db")
            return safe
        
        if to_type in ['timestamp with time zone', 'timestamp without time zone']:
            cur.execute(f"""
                SELECT COUNT(*) as total
                FROM {table}
                WHERE {col} IS NOT NULL
            """)
            total = cur.fetchone()['total']
            
            if total > 0:
                try:
                    cur.execute(f"""
                        SELECT {col}::text::timestamp
                        FROM {table}
                        WHERE {col} IS NOT NULL
                        LIMIT 1
                    """)
                    log(f"{table}.{col}: timestamp conversion appears safe", "debug", "db")
                    return True
                except:
                    log(f"{table}.{col}: timestamp conversion failed on test row", "warning", "db")
                    return False
            log(f"{table}.{col}: no non-null values, timestamp conversion safe", "debug", "db")
            return True
        
        log(f"{table}.{col}: no specific check for type {to_type!r}, assuming safe", "debug", "db")
        return True
        
    except Exception as e:
        log(f"Error checking conversion for {table}.{col}: {e}", "error", "db")
        return False

def init_db():
    log("Initializing database schema", "debug", "db")
    try:
        with get_conn() as conn:
            cur = conn.cursor()
            
            log(f"Processing {len(SCHEMA)} table(s): {list(SCHEMA.keys())}", "debug", "db")
            
            for table, columns in SCHEMA.items():
                log(f"Processing table: {table!r}", "debug", "db")
                if not is_safe_sql_identifier(table):
                    log(f"Unsafe table name rejected: {table!r}", "critical", "db")
                    raise ValueError(f"Unsafe table name detected: {table}")

                cur.execute(f"CREATE TABLE IF NOT EXISTS {table} (id SERIAL PRIMARY KEY)")
                log(f"Table {table!r} ensured to exist", "debug", "db")

                cur.execute("""
                    SELECT column_name, data_type, column_default, is_nullable
                    FROM information_schema.columns
                    WHERE table_name = %s
                """, (table,))
                existing = {row['column_name']: row for row in cur.fetchall()}
                log(f"Table {table!r} has {len(existing)} existing column(s): {list(existing.keys())}", "debug", "db")

                for col, definition in columns.items():
                    if not is_safe_sql_identifier(col):
                        log(f"Unsafe column name rejected: {table}.{col}", "critical", "db")
                        raise ValueError(f"Unsafe column name detected: {table}.{col}")
                    if ";" in definition:
                        log(f"Semicolon detected in column definition for {table}.{col}, rejecting", "critical", "db")
                        raise ValueError(f"Unsafe column definition detected for {table}.{col}")

                    if col not in existing:
                        log(f"Column {table}.{col} does not exist, adding: {definition}", "debug", "db")
                        cur.execute(f"ALTER TABLE {table} ADD COLUMN {col} {definition}")
                        log(f"Column {table}.{col} added", "debug", "db")
                    else:
                        existing_type = existing[col]['data_type']
                        target_type = parse_column_type(definition)
                        
                        if existing_type != target_type:
                            log(f"Type mismatch on {table}.{col}: existing={existing_type!r} target={target_type!r}", "debug", "db")
                            if can_convert_column(cur, table, col, existing_type, target_type):
                                try:
                                    cur.execute("SAVEPOINT type_migration")
                                    using_clause = f"USING {col}::{target_type}"
                                    cur.execute(f"ALTER TABLE {table} ALTER COLUMN {col} TYPE {target_type} {using_clause}")
                                    cur.execute("RELEASE SAVEPOINT type_migration")
                                    log(f"Successfully migrated {table}.{col} from {existing_type} to {target_type}", "info")
                                except Exception as e:
                                    cur.execute("ROLLBACK TO SAVEPOINT type_migration")
                                    log(f"Failed to migrate {table}.{col} from {existing_type} to {target_type}: {e}", "error")
                            else:
                                log(f"Cannot safely migrate {table}.{col} from {existing_type} to {target_type} - data would be lost", "warning")
                        else:
                            log(f"Column {table}.{col} type matches ({existing_type}), no migration needed", "debug", "db")
                        
                        is_primary_key = "PRIMARY KEY" in definition.upper()
                        schema_requires_not_null = "NOT NULL" in definition.upper()
                        column_is_not_null = existing[col]['is_nullable'] == 'NO'
                        
                        if not is_primary_key:
                            if schema_requires_not_null and not column_is_not_null:
                                log(f"Schema requires NOT NULL on {table}.{col} but column is nullable, checking rows", "debug", "db")
                                cur.execute(f"""
                                    SELECT COUNT(*) as nulls
                                    FROM {table}
                                    WHERE {col} IS NULL
                                """)
                                null_count = cur.fetchone()['nulls']
                                log(f"{table}.{col} has {null_count} NULL row(s)", "debug", "db")
                                if null_count == 0:
                                    try:
                                        cur.execute("SAVEPOINT not_null_add")
                                        cur.execute(f"ALTER TABLE {table} ALTER COLUMN {col} SET NOT NULL")
                                        cur.execute("RELEASE SAVEPOINT not_null_add")
                                        log(f"Set NOT NULL constraint on {table}.{col}", "info")
                                    except Exception as e:
                                        cur.execute("ROLLBACK TO SAVEPOINT not_null_add")
                                        log(f"Failed to set NOT NULL on {table}.{col}: {e}", "error")
                                else:
                                    log(f"Cannot set NOT NULL on {table}.{col} - column contains NULL values", "warning")
                            elif not schema_requires_not_null and column_is_not_null:
                                log(f"Schema does not require NOT NULL on {table}.{col} but column has it, dropping constraint", "debug", "db")
                                try:
                                    cur.execute("SAVEPOINT not_null_drop")
                                    cur.execute(f"ALTER TABLE {table} ALTER COLUMN {col} DROP NOT NULL")
                                    cur.execute("RELEASE SAVEPOINT not_null_drop")
                                    log(f"Dropped NOT NULL constraint on {table}.{col}", "info")
                                except Exception as e:
                                    cur.execute("ROLLBACK TO SAVEPOINT not_null_drop")
                                    log(f"Failed to drop NOT NULL on {table}.{col}: {e}", "error")

            # This makes sure there is something in the setup_state table
            log("Ensuring setup_state default row exists", "debug", "db")
            cur.execute("""
                INSERT INTO setup_state (id, current_step, completed)
                VALUES (1, 0, FALSE)
                ON CONFLICT (id) DO NOTHING
            """)
            
            log("Ensuring server default row exists", "debug", "db")
            cur.execute("""
                INSERT INTO server (id, password, pass_https)
                VALUES (1, NULL, FALSE)
                ON CONFLICT (id) DO NOTHING
            """)
            
            conn.commit()
            cur.close()
        log("Database initialization completed successfully", "debug", "db")
    except Exception as e:
        log(f"Database initialization failed: {e}", "critical", "db")
        user_warn("Database initialization failed. Please restore an old backup or reinstall the server. Check the logs for more details.")
        log(f"Database initialization failed: {e}", "error")
        raise