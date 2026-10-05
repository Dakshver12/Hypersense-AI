# Mobile dashboard and manual-question correction

Extract into the project root and replace matching files. Includes prior mobile setup/device work.

Mobile setup validates manual questions before the review/device step. It requires the selected question count, separates questions on a line containing ---, and caps each question at 2,000 characters. Errors appear beside the editor and focus it. The generic camera shortcut also checks the question list before opening camera check; the duplicate shortcut is hidden on phones.

Mobile dashboard uses a short title, single scrolling tab row, collapsed filters, two-column stats and expandable detailed reports. All existing report content remains accessible; original desktop layout is restored when resizing.

Validation: full npm UI suite passed, including empty-question blocking, valid manual lists, AI editor visibility, tab/filters behavior and desktop restoration. Visual phone rendering remains unverified in this environment.

```bash
git add static/css/mobile-polish.css static/js/mobile-shell.js static/js/setup.js static/js/sessions.js templates/index.html tests/mobile_layout_ui.cjs tests/ui.cjs MOBILE_REDESIGN.md
git commit -m "Simplify mobile dashboard and validate manual questions before device checks"
git push
```
