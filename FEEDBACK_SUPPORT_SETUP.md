# HyperSense AI — Feedback & Support

## Install

This update builds on the admin workspace and its dark-theme update. Extract into your project root, preserving the backend, static, templates and tests folders. Replace matching files; merge any newer local changes before replacing files you have edited separately.

No additional dependencies or environment settings are required. Existing HYPERSENSE_ADMIN_EMAILS permissions are used.

```bash
docker compose up -d --build
```

Refresh with Ctrl+Shift+R. For local development without Docker, restart your Python server instead.

## Where to find it

- Users: **Help & feedback** in the account menu, or /support.
- Admins: **Feedback & support** in the admin sidebar, or /admin/support.

Use the same hostname you normally use to sign in. Links away from an active interview are guarded so the user can finish and save first.

## User workflow

1. Choose Bug report, Confusing interview question, or Feedback.
2. Enter a title and details, then submit.
3. Open the report in Your reports to see its status and the latest support reply.

The form preserves text when submission fails. Retrying the same submission uses the same request ID to avoid duplicate reports. Reports are private to their author and authorized administrators. No recording, transcript or session data is automatically attached. Users must choose what to describe or paste.

## Admin workflow

1. Open the support inbox.
2. Search report titles or user emails, or filter by status.
3. Open a report, write a reply and choose Open, In progress or Resolved.
4. Save. The user sees the latest reply when they open or refresh their report.

Resolving a report requires a reply. Admins can reopen a resolved report by changing its status. If two admins edit the same report, a version check rejects the stale update; close and reopen the report before saving again.

Status changes and reply saves create a support_update entry in the existing audit log. The log stores actor ID, report ID and status transition, not the report text or reply. The audit page now labels both account-access and support actions accurately.

## Current scope

This version stores the original user report and the latest admin reply. It is not a threaded conversation: saving another reply replaces the previous reply. It does not send email notifications, accept attachments or automatically fix flagged questions. Status changes are visible in the application.

Each account may create up to 10 reports per rolling 24 hours and retain up to 100 reports. Lists use 20-row pagination. Database initialization adds the support_reports table and indexes automatically on the existing persistent data volume. Reports survive container restarts while that volume is preserved. Deleting an account deletes its reports; administrative audit entries remain.

## Verification

58 backend tests and the UI suite passed during implementation. New tests cover author isolation, verified/admin authorization, origin checks, input bounds, rate limits, duplicate-submission prevention, admin edit conflicts, resolution requirements, audit logging, account-deletion cleanup, safe text rendering and submission-error recovery. No provider calls, email sends or real interview data are needed by these tests. Visual screenshot validation was not performed.

To run locally from Windows Git Bash:

```bash
./.venv/Scripts/python.exe check_hypersense.py
npm test
```

## Git commands

```bash
git add backend/support backend/accounts/database.py backend/application.py static/support/support.js static/css/support.css static/css/account-menu.css static/js/account.js static/admin/workspace.js templates/support.html templates/admin-support.html templates/admin-nav.html templates/admin-workspace.html tests/test_support.py tests/support_ui.cjs tests/ui.cjs FEEDBACK_SUPPORT_SETUP.md
git diff --cached --stat
git commit -m "Add private feedback reports and admin support workflow"
git push origin main
```
