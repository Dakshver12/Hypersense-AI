"""Explicit online connectivity/schema check; never print credentials."""
import os
import sys
from dotenv import load_dotenv
from backend.accounts.database import database


def main():
    load_dotenv()
    if not os.getenv('DATABASE_URL','').strip():
        print('DATABASE_URL is unset. SQLite remains active.');return 1
    try:
        with database() as db:
            db.execute('SELECT COUNT(*) FROM users').fetchone()
        print('PostgreSQL connection and private application schema are ready.');return 0
    except Exception:
        print('PostgreSQL check failed. Verify the driver, connection URL, network and schema permissions.');return 1


if __name__=='__main__':sys.exit(main())
