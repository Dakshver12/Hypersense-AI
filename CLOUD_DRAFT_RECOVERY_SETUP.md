# Cloud draft recovery

Signed-in users now get a private active-session draft in addition to the local browser checkpoint. The draft syncs processed question answers, scores, question queue and current question state. The answer currently being recorded is deliberately not uploaded; audio remains local until the session is completed and saved.

## Apply

Extract this update over the repository root, then rebuild the app so the new `interview_drafts` table is created automatically:

```bash
docker compose build app
docker compose up -d app
```

No manual migration command is required. Existing sessions are unchanged. Test it by signing in, starting an interview, completing one answer, refreshing or opening the app in another browser, and choosing **Resume session**.
