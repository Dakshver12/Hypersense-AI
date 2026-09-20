HyperSense completion pass

Replace index.html and check_hypersense.py beside your existing main.py.
Place check_hypersense_ui.cjs in that same directory for the optional integration checks.
No backend dependency or main.py change is needed for this update. Refresh with Ctrl+F5.

Completed in this pass

Session progress, continue-without-scoring, and end-session controls now appear in the interview workspace instead of the hidden setup panel.

Failed evaluation requests preserve the answer and unlock submission state so users can retry or continue without scoring.

Pending answers can be scored later through the existing results-page action.

Back navigation keeps active interviews visible. Dashboard navigation is blocked while a session is active.

Single-question practice opens the interview workspace.

Returning to setup stops question speech, answer timers and camera use. Both normal completion and early completion release the camera.

A browser leave-page warning protects active interviews and unsaved completed sessions; it is not draft recovery.

Self-rated confidence is now accessible before submitting each answer, stored with that answer, and displayed in delivery trends.

Dashboard topic and interview-type filters, separate score averages, pace/self-rating trends, report access and session deletion.

JSON report download with reviewed answers and feedback. Audio downloads remain separate. Exports omit raw resume text, audio bytes and temporary playback URLs.

Print / save-as-PDF view for reports using the browser print dialog.

Existing features retained

Technical, behavioral and HR practice; mixed sessions; resume text context; spoken questions;
automatic camera setup after consent; neutral calibration; recording and in-page playback;
transcript review; provider fallback; saved recordings; results after the session; delivery observations.

Automated checks

Core checks (Python 3.10+ and Node.js):

python check_hypersense.py

Full-page integration checks (Node.js 22.22.2+ on the 22.x line, 24.15+ on the 24.x line, or 26+):

npm install --no-save jsdom@30.1.0 fake-indexeddb@6.2.5
node check_hypersense_ui.cjs

These npm packages are test-only; they are not needed to run HyperSense.
The integration script uses an isolated simulated browser, storage, camera and API responses.
It does not use API keys, consume provider quota, or access your browser's saved interviews.

Verified here: 11 core checks plus full-page integration scenarios for empty/history dashboards,
filters, zero and pending scores, report navigation, quota recovery, continued editing,
normal and early completion, camera cleanup, confidence persistence, later scoring,
deletion and single-question navigation.

Remaining validation and product limits

A real Chromium download was blocked in the execution environment. Visual layout, native media playback, browser print/download behavior and real webcam/microphone performance were not verified here.

Real provider availability and recognition accuracy require the configured backend and keys. Speech recognition can still mishear technical terms; transcript review remains necessary.

Filler counts come from recognized transcript text and can miss spoken fillers.

Confidence remains self-reported. Head/facial observations and audio measurements do not establish inner confidence, emotion or sentiment; this update does not add an automatic score for them.

Resume import remains TXT/pasted text. PDF/DOCX extraction is not included.

Storage remains browser/device-specific. Active sessions cannot be restored after reload; there is no account synchronization or cloud backup.

The concrete session/dashboard gaps identified during this audit are addressed. These validation limits should not be interpreted as production certification.