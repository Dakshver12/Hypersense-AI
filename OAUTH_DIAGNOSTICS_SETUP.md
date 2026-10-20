# Diagnose the provider sign-in failure

The previous callback mapped several unrelated failures to “provider could not be reached,” including rejected client credentials and database failures. This patch preserves the OAuth flow and adds classified errors plus sanitized runtime logging. It does not claim that your live credentials or provider configuration have been repaired.

## Apply

Extract into the project, replace the included files, then run:

```bash
python -m unittest tests.test_oauth_diagnostics tests.test_social_auth -v
git add backend/accounts/oauth.py static/auth/form.js templates/auth.html tests/test_oauth_diagnostics.py OAUTH_DIAGNOSTICS_SETUP.md
git commit -m "Expose safe OAuth failure categories for provider troubleshooting"
git push origin main
```

After Vercel Production shows Ready, start a fresh provider sign-in from `/login`. Do not reuse an old callback URL or sign-in code. The frontend build will create a new JS hash; the source template's script version is also updated.

## Capture the failure

1. In Vercel, open the HyperSense project → Logs.
2. Attempt sign-in once with the failing provider.
3. Filter for `OAuth failure` or open the callback request's runtime output.
4. Copy only the diagnostic line, for example:

```text
OAuth failure provider=github stage=token status=200 reason=incorrect_client_credentials
```

Do not copy callback URLs, authorization codes, cookies, client secrets or access tokens. The diagnostic lines deliberately exclude response bodies and raw exception messages.

## How to interpret it

| Category or log | Check |
|---|---|
| `oauth-credentials` / `invalid_client` / `incorrect_client_credentials` | Correct provider client ID and client secret from the same OAuth app, Production environment, no surrounding quote characters in the Vercel value; redeploy after editing. |
| `oauth-callback` / `redirect_uri_mismatch` | Registered callback exactly matches APP_ORIGIN plus `/auth/oauth/google/callback` or `/auth/oauth/github/callback`. |
| `oauth-code` / `invalid_grant` / `bad_verification_code` | Start a fresh sign-in. Codes are single-use; check callback/client pairing if every fresh attempt fails. |
| `oauth-network` | Runtime could not connect to the provider; log names the failed step and exception class without printing its private message. |
| `oauth-permissions` / profile or emails status 403 | Required profile/email permission, provider app availability, and verified email access. |
| `oauth-database` / stage account | Provider identity was retrieved but account persistence failed. Check the private database schema and permissions. |
| Other token/profile/emails status | Use that exact stage/status to investigate; do not assume the provider is unreachable. |

The diagnostic patch was checked with 11 mocked backend tests, including credential rejection returned as HTTP 200, network failures, unknown error redaction, normal sign-in, linking and revocation. Existing auth and verification UI tests also passed. A real failed callback is still needed to identify your installation's cause.
