# Résumé file import

The setup screen now accepts `.txt`, `.pdf`, and `.docx` résumés. TXT files are read in the browser. PDF and DOCX files are sent to the authenticated `/api/account/resume-text` endpoint, extracted in memory, and returned to the editable résumé field. Uploaded files are not written to disk or included in session history.

Install the new server dependencies after pulling the change:

```bash
python -m pip install -r requirements.txt
```

For a Docker deployment, rebuild the app image so the dependencies are installed:

```bash
docker compose build app
docker compose up -d app
```

If you use `uv run` locally, refresh the lockfile with the local `uv` version before running the project:

```bash
uv lock
uv run python check_hypersense.py
```

PDFs must contain selectable text; scanned image-only PDFs still need OCR or pasted text.
