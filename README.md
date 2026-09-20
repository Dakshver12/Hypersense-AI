# HyperSense AI — modular project

The application now separates backend services, screen markup, styles and frontend behavior.
The existing FastAPI endpoints, session storage keys and browser URLs are preserved.

## Install this update into your existing project

1. Stop Uvicorn with Ctrl+C and save a backup of the current project outside its folder.
2. Extract the archive. Copy **all its contents** into your existing HyperSense AI project, replacing matching files.
3. Keep your existing `.env`, `face_landmarker.task`, `pyproject.toml`, `uv.lock` and `.venv`. This archive does not include credentials, model weights or those uv project files.
4. The old root `index.html` is no longer served. Move it to your backup so you do not accidentally keep editing it. The new shell is `templates/index.html`.
5. Start the backend from the project directory:

```powershell
uv run uvicorn main:app --reload
```

6. Open `http://127.0.0.1:8000/interview` and press Ctrl+F5.

Copying only `main.py` will not work: it imports the new `backend` package and serves `templates` and `static`.
Use the same hostname and port as before to retain access to your browser's existing saved sessions.
There is no frontend build step and no new runtime dependency for an already working installation.

## Where to edit

| Task | File or directory |
|---|---|
| App registration and static assets | `main.py` |
| HTTP endpoints | `backend/api.py` |
| Request/response validation | `backend/schemas.py` |
| Project paths and environment loading | `backend/config.py` |
| HTML composition and page routes | `backend/pages.py` |
| Question generation | `backend/services/questions.py` |
| Answer scoring | `backend/services/evaluation.py` |
| Scoring rubrics and coaching instructions | `backend/services/prompts.py` |
| Gemini/Groq fallback | `backend/services/providers.py` |
| Speech transcription | `backend/services/transcription.py` |
| Audio timing, volume and filler observations | `backend/services/delivery.py` |
| Face landmarks and expression coefficients | `backend/services/face.py` |
| Header, navigation and shared page wrapper | `templates/index.html` |
| Setup, camera check, interview, results, dashboard markup | `templates/screens/` |
| All visual styling and print styles | `static/css/styles.css` |
| Camera access, frame requests and calibration | `static/js/camera.js` |
| Microphone recording, uploads and playback | `static/js/recording.js` |
| Session lifecycle and answer submission | `static/js/sessions.js` |
| Timer and question readout | `static/js/timer.js`, `static/js/speech.js` |
| Automatic record/transcribe/submit flow | `static/js/automation.js` |
| IndexedDB persistence | `static/js/storage.js` |
| Dashboard calculations and rendering | `static/js/dashboard.js` |
| Results, pending scoring and report export | `static/js/results.js` |
| Navigation between screens | `static/js/navigation.js` |
| Shared mutable state | `static/js/state.js` |
| Event binding and initialization | `static/js/app.js`, `static/js/boot.js` |

Other small frontend files separate setup controls, question history, DOM rendering, button states and lifecycle cleanup. Functions are exported and imported explicitly; mutable values are accessed through the shared `state` object.

## Why the screens share a shell

Each screen has its own source file, but FastAPI assembles them into one document from a fixed list of local templates. Navigation shows one workspace at a time. The camera video element is moved between the camera-check screen and interview screen without reloading the document.

This preserves webcam access, neutral calibration, recording and session state. A full browser refresh still releases device streams. Completed sessions remain in IndexedDB; unfinished sessions are not restored.

The frontend uses native ES modules. Open it through FastAPI, not by double-clicking an HTML file. No Node.js server is needed to run the app.

## Tests

Backend tests require `httpx` in addition to the existing runtime packages. If needed:

```powershell
uv add --dev httpx
uv run python check_hypersense.py
```

Frontend integration tests require Node.js 22.22.2+ on the 22.x line, 24.15+ on the 24.x line, or 26+:

```powershell
npm ci
npm test
```

`node check_hypersense_ui.cjs` remains available as a compatibility command after `npm ci`.
Node packages are test-only. The test bundles the native modules in memory and exercises the page with jsdom, simulated IndexedDB, media devices and provider responses. It never uses your API keys or browser history.

`.github/workflows/hypersense-checks.yml` runs both suites on GitHub pushes and pull requests. The workflow is included but has not been run on your repository here.

## Fresh installation only

If you are starting in a new folder rather than upgrading the working project:

```powershell
uv init
uv add -r requirements.txt
```

Then supply your existing provider settings in `.env` and place `face_landmarker.task` beside `main.py`.
Keep secrets out of Git. Model downloads and API access depend on your machine and configured providers.

## Validation and limits

- Nine backend/structure tests pass, including actual FastAPI page and static-asset responses, validation and mocked service delegation.
- Full-page integration scenarios pass for camera consent gating, neutral calibration, code formatting, session completion, early ending, camera cleanup, quota recovery, saved reports, dashboard filters, later scoring, deletion and single-question practice.
- The 20 extracted Python functions/classes were checked against their prior syntax trees. The face-model lookup was deliberately changed to the project root; the processing logic is unchanged.
- No real webcam, microphone, external API or visual browser test was performed in this environment. The simulated tests do not establish recognition accuracy or provider availability.
- This is a structural refactor. It does not add account sync, active-session recovery, PDF/DOCX resume extraction, or automatic confidence/emotion scoring. Confidence remains self-rated; facial and audio outputs remain descriptive practice observations.

## Suggested Git commit

Review the changes first with `git status`, then stage the new structure (never `.env`):

```powershell
git add main.py backend templates static tests check_hypersense.py check_hypersense_ui.cjs README.md requirements.txt requirements-test.txt package.json package-lock.json .github/workflows/hypersense-checks.yml .gitignore
git commit -m "Refactor HyperSense into backend services and frontend modules"
git push
```

If the obsolete root `index.html` was tracked and you removed it, stage that removal with `git add -u -- index.html` before committing.
