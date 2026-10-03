# HyperSense: PostgreSQL storage update

This is the database step toward free hosting, not a deployed website. It preserves the current FastAPI login/password system; Supabase Auth is not used.

## What changes

- DATABASE_URL unset/blank: existing local SQLite behavior.
- DATABASE_URL set: accounts, login/reset/verification tokens, rate-limit buckets, interviews, support threads, admin audit, and usage counters use PostgreSQL.
- Database failure is reported; it never silently switches back to SQLite.
- App tables live in the private `hypersense` schema, not `public`. Keep it out of Supabase's exposed schemas. RLS is enabled without client policies. The backend connects as the schema owner; user authorization stays in FastAPI.
- SQLite import takes a consistent snapshot, upgrades the temporary copy, and verifies every imported table by row count and content fingerprint. Original databases remain unchanged. Existing target data is never overwritten.
- SQLite backup creation is blocked in PostgreSQL mode. The admin card clearly says an external PostgreSQL backup is required.

## 1. Apply the files

Save/commit your current work, then extract this ZIP into your project root, merging its `backend`, `static`, and `tests` folders. Review the included file list before replacing any files with newer local edits. Your Dockerfile and existing requirements.txt are deliberately not included.

Add this line ONCE to the bottom of your existing requirements.txt (keep your PyAV pin and other dependencies):

```text
psycopg[binary]>=3.2,<4
```

For a local virtual environment, install the optional dependency:

```bash
./.venv/Scripts/python.exe -m pip install -r requirements-postgres.txt
```

Do not run the full SQLite test suite against your real PostgreSQL database. Run it with DATABASE_URL blank and no production credentials loaded. The separate opt-in PostgreSQL suite is destructive and requires a disposable database named `hypersense_test`.

## 2. Protect your current data first (Docker Compose)

Before setting DATABASE_URL, while the current app is running:

```bash
docker compose exec app python -m backend.maintenance.backup create
docker compose stop app
```

Keep the existing `hypersense-data` volume. Never use `docker compose down -v`. The migration reads that volume. A local `data/` folder is not the same database as the container volume.

## 3. Create the destination

Create a Supabase project. From **Connect**, choose **Session pooler** (IPv4, port 5432), and copy its complete URI. Replace its password placeholder with your database password; percent-encode reserved characters. Copy the actual host and username from the dashboard; do not guess them.

Append to your existing `.env`:

```dotenv
DATABASE_URL="your-complete-postgresql-connection-URI"
```

The line above is a placeholder, not a working URL. Do not paste the actual secret into chat, screenshots, frontend JavaScript, or Git. Existing environment variables can override .env; remove stale DATABASE_URL values from your terminal/deployment settings. TLS is required by default. Do not disable it for Supabase.

Use the schema-owner database connection provided by the project. The adapter creates tables on first connection and needs schema/table creation rights. Do not connect as an anonymous/Data API role.

## 4. Preview, migrate, then start (Docker)

The app stays stopped until migration is verified:

```bash
docker compose build app
docker compose run --rm --no-deps app python -m backend.maintenance.migrate_postgres
docker compose run --rm --no-deps app python -m backend.maintenance.postgres_check
docker compose run --rm --no-deps app python -m backend.maintenance.migrate_postgres --apply
```

Preview must show the expected users and sessions. If it fails or shows unexpected counts, stop and check the source volume. The check command creates only the empty schema; it does not import accounts. The apply command must print **Migration committed and verified** before you start the app:

```bash
docker compose up -d app
docker compose logs --tail=50 app
```

Sign in with an existing account and check an old recording, support conversation, and admin usage. Restart the app and confirm they persist. Do not share logs containing secrets.

For a non-Docker install, stop Uvicorn and use these instead (use the actual source path if different):

```bash
./.venv/Scripts/python.exe -m backend.maintenance.migrate_postgres --source data/hypersense.sqlite3
./.venv/Scripts/python.exe -m backend.maintenance.postgres_check
./.venv/Scripts/python.exe -m backend.maintenance.migrate_postgres --source data/hypersense.sqlite3 --apply
```

An adjacent `usage.sqlite3` is imported automatically, or specify `--usage-source`. A fresh install with no data needs only postgres_check, not the import. Never start using a fresh target before migrating old data: the importer intentionally refuses a nonempty destination.

## Rollback and backups

Before any new PostgreSQL activity, you can stop the app, remove DATABASE_URL, and restart using the untouched SQLite volume. After new writes, the copies have diverged: reverting hides those new changes. There is no reverse migration in this update.

Maintain private PostgreSQL dumps and test restoration into a separate database before relying on the cloud setup. Do not treat the old SQLite backups or Supabase free tier as a verified current backup. This update does not automate PostgreSQL backups.

## Validation and limits

Validated on PostgreSQL 16: 33 integration tests covering account/support/admin/usage flows, verified migration, duplicate-import refusal and rollback. SQLite regression suite: 74 passing tests. Existing JSDOM UI suite passes. No hosted Supabase connection or Render deployment was performed.

Transactions are serialized with an advisory lock to preserve current SQLite-like rate-limit/update semantics. This is suitable for an initial small pilot, not a load-tested high-concurrency service. Connections have bounded lock/statement timeouts and are closed after each transaction; connection pooling/locking granularity can be improved after measuring traffic.

Audio remains in session payloads, including base64 recordings. Move it to private object storage before expanding usage. Free hosting still needs resource-fit checks for face/transcription models, Brevo HTTPS email delivery (Render free blocks SMTP ports), external backups, and deployment-origin/secure-cookie configuration. API provider quotas are unchanged.

Official references:
- https://supabase.com/docs/guides/database/connecting-to-postgres
- https://render.com/docs/free

## Optional integration checks (disposable database only)

Set HYPERSENSE_TEST_DATABASE_URL to a disposable PostgreSQL database named **hypersense_test**, then run:

```bash
python tests/postgres_integration.py --reset-test-database
```

This TRUNCATES its application tables before each test. It must never point to real user data. The SQLite-only legacy migration test is replaced by a PostgreSQL import test that checks legacy support backfill.
