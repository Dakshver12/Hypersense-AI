# Unread support replies

Apply on top of the feedback/support update. Extract into the project root and replace matching files.

Run:
```bash
docker compose up -d --build
```
Refresh the app with Ctrl+Shift+R to reload JavaScript modules.

Features:
- Help & feedback shows the number of reports with unread replies.
- Checks once per minute in visible app tabs, on load, and on returning to the tab.
- Reports show New reply; opening the detail dialog acknowledges the displayed reply.
- Read receipts persist in the account database across sign-ins and devices.
- A concurrent newer reply remains unread. Status-only updates do not create notifications.
- Admin Needs a reply counts unresolved reports without a response; matching rows are labelled.
- Existing replies are initially unread because historical read status was never recorded.
- Database setup adds the receipt table automatically and preserves existing reports.
- In-app notifications only; this does not send email.

Checks: 59 backend tests, existing UI suite, support dialog acknowledgment and menu badge refresh checks passed.

Git:
```bash
git add backend/accounts/database.py backend/support/routes.py
git add static/support/support.js static/js/account.js static/css/account-menu.css static/css/support.css
git add templates/support.html templates/admin-support.html templates/index.html
git add tests/test_support.py tests/support_ui.cjs tests/support_badge_ui.cjs tests/ui.cjs
git commit -m "Add persistent unread support reply notifications"
git push
```
