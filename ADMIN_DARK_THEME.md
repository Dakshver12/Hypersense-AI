# Restore the dark admin theme

Replace static/css/admin-workspace.css with the included file. This retains the compact redesigned layout while restoring a charcoal background, dark cards, muted mint accents, dark tables and dialogs throughout the admin workspace.

Rebuild, then refresh with Ctrl+Shift+R:

```bash
docker compose up -d --build
```

No JavaScript, account logic or database changes are required. This stylesheet works with the admin workspace and the later visual refresh.

```bash
git add static/css/admin-workspace.css
git commit -m "Restore consistent dark theme across admin workspace"
git push origin main
```
