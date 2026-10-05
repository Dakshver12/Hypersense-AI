# Mobile setup task flow

Replace matching files in the project root. This package includes the prior mobile changes and replaces the long setup form on phones with three screens:

1. Focus: interview type, topic, difficulty, question count; expandable language/timing and saved setups.
2. Questions: source, manual question input when selected, optional personalisation.
3. Ready: current settings review, required camera consent, original camera-check action.

Back and Continue move between screens without starting a session or discarding input. Only one panel is visible. The original desktop arrangement is restored when the viewport exceeds 600 pixels.

Full npm UI suite passed, including step transitions, review output, original controls/listeners, retained values and desktop restoration. Visual browser verification remains unavailable in this environment; review the deployment on a phone.

```bash
git add static/css/mobile-polish.css static/js/mobile-shell.js templates/index.html tests/mobile_layout_ui.cjs tests/ui.cjs MOBILE_REDESIGN.md
git commit -m "Replace mobile setup form with a focused three-screen flow"
git push
```
