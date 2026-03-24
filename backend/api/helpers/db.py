import os
import psycopg2
from psycopg2.extras import RealDictCursor

DATABASE_URL = os.getenv("DATABASE_URL", "postgres://postgres:password@db:5432/omniplayr")


def get_conn():
    return psycopg2.connect(DATABASE_URL, cursor_factory=RealDictCursor)


def init_db():
    """Create tables if they don't exist."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                CREATE TABLE IF NOT EXISTS accounts (
                    id SERIAL PRIMARY KEY,
                    name VARCHAR(255) NOT NULL,
                    role VARCHAR(50)  NOT NULL DEFAULT 'user',
                    avatar_b64 TEXT,
                    created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
                );

                CREATE TABLE IF NOT EXISTS setup_state (
                    id INT PRIMARY KEY DEFAULT 1,
                    current_step INT NOT NULL DEFAULT 0,
                    completed BOOLEAN NOT NULL DEFAULT FALSE,
                    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                );

                INSERT INTO setup_state (id, current_step, completed)
                VALUES (1, 0, FALSE)
                ON CONFLICT (id) DO NOTHING;
            """)
        conn.commit()