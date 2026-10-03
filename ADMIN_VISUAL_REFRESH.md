# Admin visual refresh

Apply this after the admin workspace update. Extract into the project root, preserving folder paths and replacing matching files. This is a frontend update: no backend, account permission or database changes are included.

## Design changes
- Charcoal-green sidebar with consistent SVG navigation icons and a restrained active state.
- Warm light content canvas, white surfaces, smaller headings and compact metrics.
- Cleaner tables, quieter supporting text and clear account status badges.
- Matching light confirmation dialogs and responsive navigation for narrow screens.
- A styled Admin workspace entry in the main application's account menu.

The interview setup page retains its existing layout; the account-menu link is the only change on that page. Overview, Users, API usage and Audit log receive the new admin styling. All existing actions and DOM IDs are preserved.

## Apply

```bash
docker compose up -d --build
```

Open /admin and refresh with Ctrl+Shift+R. The content area should now be light with a dark green sidebar. If it still looks entirely navy, confirm the files were replaced in static/css and that the rebuilt container serves this project folder.

The existing UI suite passed after the changes, including search, confirmation, suspension/restoration UI, usage and error handling. A graphical browser download failed in this environment, so desktop/mobile screenshot validation could not be completed here.

## Git

```bash
git add static/css/admin-workspace.css static/css/account-menu.css static/admin/workspace.js templates/admin-nav.html templates/admin-workspace.html templates/admin-usage.html ADMIN_VISUAL_REFRESH.md
git commit -m "Refine admin workspace layout typography and navigation"
git push origin main
```
