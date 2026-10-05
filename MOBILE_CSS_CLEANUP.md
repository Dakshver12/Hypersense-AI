# Mobile stylesheet consolidation

Replace static/css/mobile-polish.css and templates/index.html with these versions. All rules previously in mobile-focus.css are now in mobile-polish.css, in their original cascade order. Eleven identical redundant declarations were removed and formatting was normalized. The template references the consolidated stylesheet with a new version query.

Remove the obsolete file and commit:

```bash
git rm static/css/mobile-focus.css
git add static/css/mobile-polish.css templates/index.html MOBILE_CSS_CLEANUP.md
git commit -m "Consolidate mobile workspace styles into one stylesheet"
git push
```

Verification: all 789 final declaration groups retain their values after normalization; full npm UI suite passed. This is a maintenance cleanup intended to preserve the phone layout you tested.
