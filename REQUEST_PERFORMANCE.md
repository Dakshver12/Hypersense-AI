# Reduce duplicate account requests

Apply after the PostgreSQL connection-pool update. This small patch leaves the database and region unchanged; no migrations or new dependencies are needed.

## Apply

Extract into the project root, merging folders. Included:
- backend/accounts/security.py
- static/js/account-store.js
- tests/test_auth_lookup.py
- tests/account_request_dedup.cjs
- REQUEST_PERFORMANCE.md

Rebuild and start:

```bash
docker compose up -d --build app
```

Hard-refresh the browser with Ctrl+Shift+R so it loads the updated JavaScript module.

## Changes

An authentication lookup is reused only inside the same incoming request. Each new request still queries the database, so logout, expired sessions, suspension and account switching remain enforced. Account headers continue to be checked every time require_user is called. Returned dictionaries are copied to avoid accidental mutation of the cached result.

On the frontend, identical default GET requests share a fetch only while it is in flight. Completed results are not cached, different account headers use different keys, and writes or requests with explicit options are not combined. Each caller receives a separate copy of the JSON response. A rejected request is removed so retries can proceed.

This saves work only where lookups or fetches overlap. It does not combine different endpoints, shrink large recording payloads, skip authorization on later requests, or remove the underlying network latency to Tokyo. The database_timing SELECT 1 benchmark should not change from this patch: it measures the database adapter, not page request duplication. Actual page-load improvement is not measured on your machine.

## Validation

77 backend tests passed, including new checks for request-local lookup reuse, isolation between requests, anonymous lookups and account mismatch rejection. The existing UI suite and new GET deduplication test passed.

```bash
python check_hypersense.py
npm test
node tests/account_request_dedup.cjs
```

Run backend tests only with isolated test settings and no live DATABASE_URL. No hosted Supabase data or real user browser was used in validation.
