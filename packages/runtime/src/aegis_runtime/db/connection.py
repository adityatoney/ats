import os

import psycopg


def get_connection():
    db_url = os.getenv(
        "DATABASE_URL", "postgresql://aegis:aegis_dev@localhost:5432/aegis_trader"
    )
    return psycopg.connect(db_url)
