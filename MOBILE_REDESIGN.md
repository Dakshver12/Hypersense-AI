# Mobile workspace and device-screen update

Extract this ZIP into the project root and replace matching files. Includes all earlier mobile setup task-flow changes.

- Three-screen setup with retained controls, selections and event handlers.
- Shorter headings and consistent spacing.
- Manual editor explicitly hidden for AI source, including after saved-value restoration.
- Focused setup navigation: Back/Continue plus a compact Dashboard action.
- Compact camera preview, enabled actions only, expandable optional microphone test.
- Fixed Back/Start controls during device check with camera/calibration gate preserved.
- Desktop layout and microphone-panel position restored at wider viewports.

Validation: full npm UI suite passed. Mobile regression checks cover source visibility, step transitions, review, retained values, microphone-panel relocation and desktop restoration. Visual rendering could not be checked here because browser socket creation is restricted. Test the deployed phone preview, particularly camera permission, calibration and keyboard opening.

```bash
git add static/css/mobile-polish.css static/js/mobile-shell.js templates/index.html tests/mobile_layout_ui.cjs tests/ui.cjs MOBILE_REDESIGN.md
git commit -m "Polish mobile setup navigation and simplify device checks"
git push
```
