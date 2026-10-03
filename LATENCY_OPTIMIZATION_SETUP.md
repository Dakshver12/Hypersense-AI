# Latency optimization update

This update targets the repeated work that made every request feel slow when the app and PostgreSQL are in different regions:

- PostgreSQL connections are pooled and configured once. Read-only requests no longer run a health query, advisory lock, `BEGIN`, and `COMMIT` on every checkout.
- Practice authentication and rate-limit accounting use one database transaction instead of three separate database contexts.
- Gemini and Groq SDK clients are kept per worker so DNS/TLS and HTTP connection setup are reused.
- Provider telemetry is queued in the background for PostgreSQL deployments, so metrics writes do not delay the answer response.
- AI output limits are bounded to the size needed by the question and evaluation payloads.
- Every HTTP response includes a `Server-Timing` header. In browser DevTools, open Network, select a request, and inspect `Server-Timing` to see the server duration.

## Apply the update

From the repository root, extract this ZIP and allow the listed files to overwrite their existing copies. Then rebuild the application image so the Python changes are installed in the container:

```bash
docker compose build app
docker compose up -d app
```

## Measure the database path

Run this after the container is healthy:

```bash
docker compose exec app python -m backend.maintenance.database_timing
```

The first result includes connection and schema initialization. The warm results are the useful comparison. They should be materially lower than the previous ~895–927 ms warm readings, although the remaining network distance to a Tokyo database still contributes one round trip.

## Verify before committing

```bash
uv run python -m unittest discover -s tests -p 'test_*.py'
npm test
```

If the application image uses a virtual environment instead of `uv`, run the equivalent Python unittest command with that interpreter.
