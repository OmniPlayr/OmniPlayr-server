import os
import re
import psycopg2
from psycopg2.extras import RealDictCursor
from api.helpers.userwarn import user_warn
from api.helpers.log import log

DATABASE_URL = os.getenv("DATABASE_URL", "postgres://postgres:password@db:5432/omniplayr")

# This initializes the database, and will make sure all the tables exist, so if you update your server it will always keep working
# So any changes you make to the database should be done here
SCHEMA = {
    "accounts": {
        "id": "SERIAL PRIMARY KEY",
        "name": "VARCHAR(255) NOT NULL",
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
    }
}

def get_conn():
    return psycopg2.connect(DATABASE_URL, cursor_factory=RealDictCursor)

# This checks if the sql is safe, because we dont want sql injection
def is_safe_sql_identifier(name):
    return re.match(r'^[a-zA-Z_][a-zA-Z0-9_]*$', name) is not None

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
            return pg_type
    
    return base_type.lower()

def can_convert_column(cur, table, col, from_type, to_type):
    try:
        cur.execute(f"""
            SELECT COUNT(*) as total,
                   COUNT(CASE WHEN {col} IS NOT NULL THEN 1 END) as non_null
            FROM {table}
        """)
        counts = cur.fetchone()
        
        if counts['total'] == 0:
            return True
        
        if to_type in ['integer', 'bigint', 'smallint']:
            cur.execute(f"""
                SELECT COUNT(*) as convertible
                FROM {table}
                WHERE {col} IS NULL OR {col}::text ~ '^-?[0-9]+$'
            """)
            result = cur.fetchone()
            return result['convertible'] == counts['total']
        
        if to_type == 'boolean':
            cur.execute(f"""
                SELECT COUNT(*) as convertible
                FROM {table}
                WHERE {col} IS NULL OR 
                      LOWER({col}::text) IN ('true', 'false', 't', 'f', '1', '0', 'yes', 'no', 'y', 'n')
            """)
            result = cur.fetchone()
            return result['convertible'] == counts['total']
        
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
                    return True
                except:
                    return False
            return True
        
        return True
        
    except Exception as e:
        log(f"Error checking conversion for {table}.{col}: {e}", "error")
        return False

def init_db():
    try:
        conn = get_conn()
        cur = conn.cursor()
        
        for table, columns in SCHEMA.items():
            if not is_safe_sql_identifier(table):
                raise ValueError(f"Unsafe table name detected: {table}")

            cur.execute(f"CREATE TABLE IF NOT EXISTS {table} (id SERIAL PRIMARY KEY)")

            cur.execute("""
                SELECT column_name, data_type, column_default, is_nullable
                FROM information_schema.columns
                WHERE table_name = %s
            """, (table,))
            existing = {row['column_name']: row for row in cur.fetchall()}

            for col, definition in columns.items():
                if not is_safe_sql_identifier(col):
                    raise ValueError(f"Unsafe column name detected: {table}.{col}")
                if ";" in definition:
                    raise ValueError(f"Unsafe column definition detected for {table}.{col}")

                if col not in existing:
                    cur.execute(f"ALTER TABLE {table} ADD COLUMN {col} {definition}")
                else:
                    existing_type = existing[col]['data_type']
                    target_type = parse_column_type(definition)
                    
                    if existing_type != target_type:
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
                    
                    is_primary_key = "PRIMARY KEY" in definition.upper()
                    schema_requires_not_null = "NOT NULL" in definition.upper()
                    column_is_not_null = existing[col]['is_nullable'] == 'NO'
                    
                    if not is_primary_key:
                        if schema_requires_not_null and not column_is_not_null:
                            cur.execute(f"""
                                SELECT COUNT(*) as nulls
                                FROM {table}
                                WHERE {col} IS NULL
                            """)
                            if cur.fetchone()['nulls'] == 0:
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
                            try:
                                cur.execute("SAVEPOINT not_null_drop")
                                cur.execute(f"ALTER TABLE {table} ALTER COLUMN {col} DROP NOT NULL")
                                cur.execute("RELEASE SAVEPOINT not_null_drop")
                                log(f"Dropped NOT NULL constraint on {table}.{col}", "info")
                            except Exception as e:
                                cur.execute("ROLLBACK TO SAVEPOINT not_null_drop")
                                log(f"Failed to drop NOT NULL on {table}.{col}: {e}", "error")

        # This makes sure there is something in the setup_state table
        cur.execute("""
            INSERT INTO setup_state (id, current_step, completed)
            VALUES (1, 0, FALSE)
            ON CONFLICT (id) DO NOTHING
        """)
        
        # This makes sure that there is something in the server table
        cur.execute("""
            INSERT INTO server (id, password, pass_https)
            VALUES (1, NULL, FALSE)
            ON CONFLICT (id) DO NOTHING
        """)
        
        conn.commit()
        cur.close()
        conn.close()
    except Exception as e:
        user_warn("Database initialization failed. Please restore an old backup or reinstall the server. Check the logs for more details.")
        log(f"Database initialization failed: {e}", "error")
        raise