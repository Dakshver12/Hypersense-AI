# Support conversations

Apply this update after the working support notifications update.
Extract into the HyperSense AI project root and replace matching files.

```bash
docker compose up -d --build
```
Refresh with Ctrl+Shift+R. Database setup adds thread, message and admin read tables
without deleting existing reports, accounts or saved interviews. Keep the existing
Docker data volume.

What changed:
- Each report has a dated, plain-text conversation history.
- Users send follow-ups. On a resolved report, Reopen & send reopens it and adds
  the explanation in one operation.
- Admin replies append rather than overwrite. The admin message box starts empty.
- Admins can change status without adding a message. Resolving a report requires
  either an existing reply or a new explanation.
- New user messages show New message for each admin until that admin opens them.
- Needs a reply counts unresolved reports whose latest contribution is from the user.
  Reading a report does not remove it from that queue; replying does.
- User unread reply badges and persistent read receipts continue to work.
- Refresh conversation loads new messages while retaining an unsent draft.
- Failed sends keep drafts. Retrying the same request does not duplicate messages.
- Concurrent changes return a conflict: refresh the conversation, review, then resend.
- Drafts survive closing/reopening the dialog in the same page. They are not saved
  across page reloads or sign-outs.
- Existing latest replies are migrated once. Older overwritten replies cannot be recovered.
- The original report appears above the conversation. Messages are append-only.
- Conversations have a 200-message limit; start a new report if reached. Sending is
  limited to 30 user messages/hour or 60 admin messages/hour per account.
- No emails or attachments are added by this update.

Verification: 61 backend tests and the complete existing UI suite passed, including
migration, ownership/origin guards, account deletion cleanup, per-admin read state,
reopen, concurrent changes, safe text rendering, draft preservation and retry checks.
UI tests use JSDOM; a graphical browser preview was not available here.

Git commands (run one line at a time):
```bash
git add backend/accounts/database.py backend/support/routes.py
git add static/support/support.js static/css/support.css
git add templates/support.html templates/admin-support.html
git add tests/test_support.py tests/support_ui.cjs SUPPORT_CONVERSATIONS_SETUP.md
git commit -m "Add support conversation history and follow-up messages"
git push
```
