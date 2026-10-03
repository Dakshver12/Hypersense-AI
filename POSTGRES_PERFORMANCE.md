# PostgreSQL connection performance update

The first PostgreSQL adapter opened and closed a TLS database connection for every operation. A page can perform several operations, so a remote database magnifies that cost. This update reuses connections and reduces transaction setup round trips. It does not change the UI, credentials, stored data or database schema, and no migration is required.

## Apply

Extract these files into your project root:
- backend/accounts/postgres.py
- backend/maintenance/database_timing.py
- requirements-postgres.txt
- tests/postgres_pool_integration.py
- POSTGRES_PERFORMANCE.md

Keep your existing requirements.txt. Add this line once alongside the existing psycopg[binary] line:

```text
psycopg_pool>=3.2,<4
```

Run from the project root:

```bash
docker compose up -d --build app
```

Your Dockerfile installs requirements.txt, so changing only requirements-postgres.txt does not install the new dependency in the image. Do not rerun the SQLite migration.

After rebuilding, open the dashboard twice. First use still includes schema initialization; subsequent requests reuse connections in the running process.

## Measure remaining delay

```bash
docker compose exec app python -m backend.maintenance.database_timing
```

This opens a separate diagnostic process and prints first-use and four warm timings using SELECT 1. It does not read account data or print credentials. First-use timing includes connection and schema initialization for that diagnostic process, even if the web app is already warm. Warm timing includes the health check, transaction setup, query and commit; it is not raw network ping or total page-load time.

If it remains slow, share the five timings and the Supabase project's region (not the URI). A distant database region, large session payloads or page request patterns may also contribute. Real browser/provider calls and your laptop-to-Supabase latency were not measured here.

## Implementation

- Lazy pool per process, up to two open connections, at most 20 waiting requests and a 10-second acquisition timeout.
- Idle connections expire after 60 seconds; maximum lifetime is five minutes.
- Connections are health-checked before checkout and returned only after transaction cleanup. Closed connections are replaced.
- Setup statements are sent in one round trip. Existing advisory locking, authorization, TLS default and rollback behavior remain intact.
- Read/write transactions are still serialized by the existing advisory lock. This patch reduces overhead; it is not a high-concurrency redesign.
- Pool closes on ordinary process exit. Later Vercel scaling will need its own aggregate connection-budget validation; two connections per instance is not two for the entire deployment.

Validation: three real PostgreSQL pool tests (reuse, rollback/settings isolation, broken-connection replacement), the 33-test PostgreSQL integration suite and the 74-test SQLite suite. No speedup percentage is claimed for your network.

The optional pool tests require a disposable HYPERSENSE_TEST_DATABASE_URL pointing to a database named hypersense_test. They clear application tables and must never run against user data:

```bash
python tests/postgres_pool_integration.py --reset-test-database
```

They reuse the PostgreSQL integration test helper shipped in the previous database update.

Reference: https://www.psycopg.org/psycopg3/docs/advanced/pool.html
