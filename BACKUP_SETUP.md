# Verified database backups

Apply after the support-conversation update. Extract into the project root,
replacing matching files. No existing database or Docker volume is replaced.

From Git Bash in your project folder:
```bash
cat BACKUP_GITIGNORE.txt >> .gitignore
docker compose up -d --build
docker compose exec app python -m backend.maintenance.backup create
```
The last command prints the exact backup directory. Refresh the admin overview
with Ctrl+Shift+R to see Backup readiness and the last successful time.
Backups are manual in this update; no recurring schedule has been installed.

Without Docker, use your existing environment:
```bash
./.venv/Scripts/python.exe -m backend.maintenance.backup create
```

## What is protected
The snapshot includes every table in hypersense.sqlite3: accounts, verification
and login records, saved interviews (including recordings stored in those
account session payloads), admin audit, support threads and read receipts.
usage.sqlite3 is included when it exists. Each database is internally consistent;
the two database snapshots may be taken at slightly different times.
Browser-only drafts/data, .env, external recording files, model downloads and code
are not included. Back up deployment configuration separately and privately.

The SQLite backup API captures committed WAL data while the app is running.
Integrity, foreign keys, table counts and SHA-256 checks are verified. A separate
restored copy is tested before success is recorded. Temporary restore-check
copies are removed after this automatic test. Failed backups do not erase the
last successful backup. Backup directories are never automatically deleted.

## Storage and private copies
Default: HYPERSENSE_DATA_DIR/backups. In the current Docker setup this is
/var/lib/hypersense/backups, inside the existing persistent data volume.
HYPERSENSE_BACKUP_DIR can select a different location. For Docker, that custom
location must be mounted persistently; merely changing the environment variable
to an unmounted container directory does not provide durable backup storage.

A backup on the same disk will not protect against loss of that disk.
Copy backups to private storage on another device or service. For a local copy:
```bash
mkdir -p backups
docker compose cp app:/var/lib/hypersense/backups/. ./backups
```
Then transfer the selected backup folder to your private off-device storage.
These files contain private recordings, transcripts and password/session hashes.
They are not encrypted by this command. Keep them private, out of Git, and never
place them under a public web directory. POSIX directories/files use 700/600;
on Windows, use your normal private user folder and appropriate access controls.
No database-download HTTP endpoint is added.

## Verify or restore into a separate test directory
Replace YOUR_BACKUP_ID with the directory name printed by create:
```bash
docker compose exec app python -m backend.maintenance.backup verify /var/lib/hypersense/backups/YOUR_BACKUP_ID
docker compose exec app python -m backend.maintenance.backup restore-test /var/lib/hypersense/backups/YOUR_BACKUP_ID --output /tmp/hypersense-restore-check
```
Restore-test refuses existing destinations, the live data directory and its
children, backup subdirectories, and public static/templates directories.
Choose a different new test directory when running it again. It verifies the
restored database files without starting an application against them.
This update deliberately provides an isolated restore exercise; it does not
perform an in-place production recovery or overwrite live accounts.

The admin card reports verification at backup creation time. It checks whether
the last snapshot files still exist, but does not rehash them on every page load.
Use verify again after copying them. The card flags age over 24 hours, missing
files and a failed latest attempt. It does not claim an off-device copy exists.

## Validation
64 backend tests and the UI suite passed. Coverage includes WAL data, recording
payload preservation, support messages, failed snapshots, corrupt checksums,
path validation, live-data protection, and admin badge states. UI tests use JSDOM.

## Commit
```bash
git add backend/maintenance/ backend/admin/routes.py
git add static/admin/workspace.js templates/admin-workspace.html
git add tests/test_backups.py tests/backup_ui.cjs tests/ui.cjs
git add .gitignore BACKUP_GITIGNORE.txt BACKUP_SETUP.md
git commit -m "Add verified database backups and admin backup status"
git push
```
