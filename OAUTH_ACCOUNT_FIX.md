# OAuth account decisions with PostgreSQL

## Confirmed code issue

GitHub's token, profile and email requests succeeded. The next step reported OperationalError.

The new OAuth flow raised ValueError for expected outcomes such as `existing-account`. The legacy PostgreSQL adapter catches ValueError inside its transaction context and converts it to sqlite3.OperationalError. This obscured a normal account decision as a database outage. SQLite-only OAuth tests did not exercise that translation.

The adapter behavior was reproduced locally. The narrow fix introduces a separate OAuthAccountError for account decisions and handles it explicitly in the callback. It does not change database credentials, migrations or transaction behavior elsewhere.

This is a confirmed bug that can cause the reported error. If a real SQL/connection error remains after deployment, the diagnostic log can still report a database failure; that would need further investigation.

## Apply

Extract the ZIP in your repository and replace the included files.

```bash
python -m unittest tests.test_oauth_postgres_decisions tests.test_oauth_diagnostics tests.test_social_auth -v
git add backend/accounts/oauth.py tests/test_oauth_postgres_decisions.py requirements-test.txt OAUTH_ACCOUNT_FIX.md
git commit -m "Preserve OAuth account decisions across PostgreSQL transactions"
git push origin main
```

The tests use fake PostgreSQL results through the real adapter, and mocked provider calls. They do not connect to your live database. The test requirements include the already-used psycopg driver/pool so CI can execute these adapter tests.

## After Vercel shows Ready

Start a fresh sign-in from your website; do not reuse the callback URL.

If the provider email already has a HyperSense account, you should now see the existing-account explanation instead of a database error:

1. Sign in with the account's email and password.
2. Open Account settings → Connected accounts.
3. Choose GitHub or Google to connect it to that same account.
4. Sign out, then sign in using that provider.

Your saved sessions remain with the existing account. The app deliberately does not merge two accounts merely because their email text matches. If you forgot the password, use password reset first.

New provider accounts with a new email can still be created directly. Suspension and conflicting provider links remain blocked.

Fifteen targeted tests passed, including adapter-level existing-email handling, suspension, conflicts, returning identities, safe diagnostics, normal OAuth creation and explicit linking. Live sign-in still requires a post-deployment test.
