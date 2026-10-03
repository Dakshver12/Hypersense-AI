# HyperSense AI — admin workspace

This update builds on the API usage dashboard. It adds a shared navigation layout and working Overview, Users and Audit log pages while preserving API usage at /admin/usage.

## Apply

1. Make a Git checkpoint or backup of your current project.
2. Extract into the project root, preserving folder paths and replacing matching files. The archive includes complete updated files from the shared working copy; merge any newer local changes before replacing those files.
3. Keep your existing .env configuration. If not already set, add your verified login email:

```dotenv
HYPERSENSE_ADMIN_EMAILS=your-email@example.com
```

4. Rebuild and refresh:

```bash
docker compose up -d --build
```

Press Ctrl+Shift+R and select **Admin workspace** in the account menu. You can also open http://127.0.0.1:8000/admin (use your configured app hostname). A non-Docker development server needs a restart instead.

The account database automatically creates two new tables: account_suspensions and admin_audit. Existing user columns, sessions and recordings are not rewritten. Keep the existing data volume; do not remove it.

## Included

- **Overview:** total accounts, verification counts, new accounts over seven days, unexpired signed-in accounts, saved interviews, recent accounts, and seven-day aggregate API activity.
- **Users:** literal name/email search, status filters, stable 20-row pagination, verified/unverified/suspended status, and saved-session counts.
- **Access management:** explicit confirmation and mandatory reason for suspension/restoration. Suspension revokes login sessions and outstanding email links, then blocks future logins and authenticated account requests. Saved interview data remains intact. Restoration requires a new login; it does not restore old sessions or bypass email verification.
- **Audit log:** paginated suspension/restoration records containing actor ID, target ID, action, timestamp and reason. No editing/deleting audit entries is exposed.
- **API usage:** existing detailed metrics inside the shared sidebar layout.
- **Permissions:** backend-enforced verified admin allowlist on every page/API, origin checks for mutations, existing account-switch protection, and protected admin accounts. Self-suspension and suspending another allowlisted admin are rejected.

Only account metadata and operational aggregates are exposed. Recordings, answers and transcripts are not loaded by these admin endpoints. Administrative reasons are stored in the audit log; do not enter sensitive personal information in them. Audit records are retained until a deliberate database retention process is introduced; they are not an externally tamper-proof security log. Account IDs remain in audit records after account deletion.

## Metric limits

“Signed-in” means an account has an unexpired login, not that the user is currently online. “Saved interviews” includes sessions ended early; it is not a completion rate. Verification counts can include suspended accounts. API metrics begin at installation of tracking. No live health claims or remaining-quota estimates are shown. Already-authorized requests may finish while suspension is being applied; subsequent requests are denied.

Feedback/support management, configurable site settings, and interview completion/skip analytics are not yet implemented and are not shown as nonworking navigation links. This release establishes the functioning admin foundation and user access management.

## Checks

54 backend tests and the UI suite pass with simulated providers and temporary account databases. New tests cover page/API permissions, account search, server-side suspension, expired login access, restored sign-in, preservation of interview data, audit entries, origin rejection, admin-account protection, safe text rendering and the confirmation flow. No graphical browser was available for screenshot validation; responsive layout was implemented but should be checked in your browser.

```bash
./.venv/Scripts/python.exe check_hypersense.py
npm test
```

## Git

```bash
git add backend/admin backend/accounts/database.py backend/accounts/security.py backend/accounts/routes.py backend/application.py backend/usage/routes.py static/js/account.js static/admin/workspace.js static/css/admin-workspace.css templates/admin-nav.html templates/admin-workspace.html templates/admin-usage.html tests/test_admin_workspace.py tests/admin_workspace_ui.cjs tests/ui.cjs ADMIN_WORKSPACE_SETUP.md
git diff --cached --stat
git commit -m "Build admin workspace with user access management and audit log"
git push origin main
```
