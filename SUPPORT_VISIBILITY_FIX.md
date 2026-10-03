# Support field visibility fix

Extract these files into your HyperSense AI project, replacing the matching files.
This fixes pale text on white backgrounds in support title/details, admin search,
and admin reply fields. It preserves the existing support functionality.

Rebuild from the project folder:

```bash
docker compose up -d --build
```

Refresh with Ctrl+Shift+R. The templates also use a new stylesheet version URL.
Check that both typed text and placeholder text are readable in Help & feedback
and the admin reply dialog.

Commit:

```bash
git add static/css/support.css templates/support.html templates/admin-support.html
git commit -m "Fix support form text contrast in dark theme"
git push
```
