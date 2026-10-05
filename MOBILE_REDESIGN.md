# Mobile workspace redesign

Extract this ZIP into the project root and replace the matching files. It targets phones up to 600 CSS pixels wide; the desktop arrangement is restored when the viewport grows.

- Compact header and bottom navigation.
- Essential session settings first, with two-column fields.
- Question source and manual questions remain visible. Optional preferences and saved setups collapse below them.
- Browser-session import moves into the account menu.
- Smaller camera, interview, dashboard and report spacing; reachable interview action bar.

UI regression suite passed, including retained values, original event handlers and desktop restoration. Visual browser verification could not run in this environment because Chromium socket creation is restricted. Check the deployed preview at 360, 390 and 430 pixels before merging.

Run `npm test` after installing the project dependencies.

```bash
git add static/css/mobile-polish.css static/js/mobile-shell.js templates/index.html tests/mobile_layout_ui.cjs tests/ui.cjs MOBILE_REDESIGN.md
git commit -m "Redesign mobile workspace for focused interview practice"
git push
```
