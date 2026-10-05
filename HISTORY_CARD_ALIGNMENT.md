# History card alignment correction

Replace matching files in the project root. Explicit column positions support both old and current session-renderer markup. Session heading spans the card; type and answer count occupy the metadata row; actions use a separate full-width row. Open report stretches while Delete remains secondary. Search instructions are collapsed under How search works on phones.

The template versions mobile-focus.css to request the updated stylesheet. Full npm UI suite passed; physical phone rendering remains unverified here.

```bash
git add static/css/mobile-focus.css static/js/mobile-shell.js static/js/dashboard.js templates/index.html HISTORY_CARD_ALIGNMENT.md
git commit -m "Align mobile history metadata and actions in separate rows"
git push
```
