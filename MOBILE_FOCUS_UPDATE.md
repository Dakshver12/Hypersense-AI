# Consolidated phone UI update

Extract into the project root, replacing matching files. This includes the earlier setup task flow, manual-question gate, dashboard disclosures, session history cards and camera request recovery.

Interview: compact heading/timer, no duplicate progress block, smaller action bar, language/upload/self-rating behind an expandable section. The disabled transcript editor is hidden until available; all original controls and handlers are retained. Pause automation stays accessible.

Results: compact header, export buttons in a disclosure, four compact metrics in one row. Review and recordings remain available.

History: individual phone cards with topic/date, interview type, answer count and readable actions. Desktop table remains available.

The new mobile-focus stylesheet loads after existing styles. Full npm UI suite passed. Real phone visual rendering and camera behavior could not be verified here.

```bash
git add static/css/mobile-polish.css static/css/mobile-focus.css static/js/mobile-shell.js static/js/dashboard.js static/js/setup.js static/js/sessions.js static/js/camera.js templates/index.html tests/mobile_layout_ui.cjs tests/camera_recovery_ui.cjs tests/ui.cjs MOBILE_FOCUS_UPDATE.md
git commit -m "Consolidate focused mobile interview, results and history layouts"
git push
```
