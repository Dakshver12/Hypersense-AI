"""Time a harmless query through the real application connection path."""
import os
import time
from backend.accounts.database import database


def main():
    if not os.getenv('DATABASE_URL','').strip():
        print('DATABASE_URL is unset; this test is intended for PostgreSQL.');return 1
    try:
        for index in range(5):
            start=time.perf_counter()
            with database(readonly=True) as db:db.execute('SELECT 1').fetchone()
            print(('First use' if index==0 else 'Warm query '+str(index))+': '+str(round((time.perf_counter()-start)*1000))+' ms')
        print('First use includes connection/schema initialization. Warm read queries reuse a pooled connection and avoid a health check, transaction setup and commit.')
        return 0
    except Exception:
        print('Database timing failed. Run postgres_check to verify configuration.');return 1


if __name__=='__main__':raise SystemExit(main())
