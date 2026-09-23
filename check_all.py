"""Run HyperSense backend and simulated UI tests without changing dependencies.

Windows Git Bash: ./.venv/Scripts/python.exe check_all.py
PowerShell:       .\\.venv\\Scripts\\python.exe check_all.py
Linux/macOS:      ./.venv/bin/python check_all.py
"""
from __future__ import annotations

import argparse
import os
from pathlib import Path
import shutil
import subprocess
import sys

ROOT = Path(__file__).resolve().parent
DEPENDENCIES = ('fastapi', 'httpx', 'dotenv', 'multipart', 'pydantic', 'google.genai', 'groq', 'numpy')


def project_python(root: Path) -> str:
    """Prefer the project's environment; never invoke uv sync or install packages."""
    for relative in ('.venv/Scripts/python.exe', '.venv/bin/python'):
        candidate = root / relative
        if candidate.is_file():
            return str(candidate)
    return sys.executable


def run_command(command: list[str], root: Path, timeout: int, capture: bool = False):
    env = os.environ.copy()
    env["PYTHONUTF8"] = "1"
    env["PYTHONIOENCODING"] = "utf-8"
    return subprocess.run(command, cwd=root, timeout=timeout, text=True,
                          encoding="utf-8", env=env,
                          capture_output=capture, check=False)


def backend_check(root: Path, timeout: int) -> tuple[str, str]:
    script = root / 'check_hypersense.py'
    if not script.is_file():
        return 'BLOCKED', 'Missing check_hypersense.py. Restore that file in the project root.'
    python = project_python(root)
    print(f'Python: {python}', flush=True)
    probe = """import importlib.util,json
missing=[]
for name in %r:
    try:
        if importlib.util.find_spec(name) is None: missing.append(name)
    except (ModuleNotFoundError, ValueError): missing.append(name)
print(json.dumps(missing))
""" % (DEPENDENCIES,)
    result = run_command([python, '-c', probe], root, timeout, capture=True)
    if result.returncode:
        return 'BLOCKED', 'Python dependency check failed: ' + (result.stderr or result.stdout).strip()
    import json
    try:
        missing = json.loads(result.stdout)
    except (ValueError, TypeError):
        return 'BLOCKED', 'Could not read the Python dependency check. Run check_hypersense.py directly.'
    if missing:
        return 'BLOCKED', ('Missing Python modules: ' + ', '.join(missing) +
                           '\n  Stop the server, then run: uv pip install -r requirements-test.txt --link-mode=copy')
    result = run_command([python, str(script)], root, timeout)
    return ('PASS', 'Backend tests passed.') if result.returncode == 0 else ('FAIL', 'Backend tests failed. See the output above.')


def ui_check(root: Path, timeout: int) -> tuple[str, str]:
    script = root / 'tests' / 'ui.cjs'
    if not script.is_file():
        return 'BLOCKED', 'Missing tests/ui.cjs. Restore the latest UI test file.'
    node = shutil.which('node')
    if not node:
        return 'BLOCKED', 'Node.js was not found. Install a Node version supported by package.json, then reopen your terminal.'
    probe = "for (const name of ['jsdom','esbuild','fake-indexeddb']) require.resolve(name);"
    result = run_command([node, '-e', probe], root, timeout, capture=True)
    if result.returncode:
        return 'BLOCKED', 'UI dependencies could not be loaded. Run: npm ci --include=dev\n  If installation fails, resolve its error before rerunning this check.'
    result = run_command([node, str(script)], root, timeout)
    return ('PASS', 'UI integration tests passed.') if result.returncode == 0 else ('FAIL', 'UI tests failed. See the output above.')


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    scope = parser.add_mutually_exclusive_group()
    scope.add_argument('--backend-only', action='store_true')
    scope.add_argument('--ui-only', action='store_true')
    parser.add_argument('--timeout', type=int, default=120, help='Maximum seconds per test or preflight process (default: 120).')
    args = parser.parse_args(argv)
    if args.timeout < 1:
        parser.error('--timeout must be a positive number')
    checks = []
    if not args.ui_only:
        checks.append(('Backend', backend_check))
    if not args.backend_only:
        checks.append(('UI', ui_check))
    print('HyperSense automated checks', flush=True)
    print(f'Project: {ROOT}', flush=True)
    print('No packages are installed or updated. Camera, audio and API responses in UI tests are simulated.\n', flush=True)
    results = []
    try:
        for label, check in checks:
            print(f'Running {label} checks...', flush=True)
            try:
                status, detail = check(ROOT, args.timeout)
            except subprocess.TimeoutExpired:
                status, detail = 'FAIL', f'Timed out after {args.timeout} seconds. Rerun with --timeout 300 if needed.'
            except OSError as error:
                status, detail = 'BLOCKED', f'Could not launch check: {error}'
            results.append((label, status, detail))
            print(f'{label}: {status}\n{detail}\n', flush=True)
    except KeyboardInterrupt:
        print('\nChecks interrupted. No overall pass result.', flush=True)
        return 130
    print('Check summary', flush=True)
    for label, status, detail in results:
        print(f'  {label}: {status}', flush=True)
    success = all(status == 'PASS' for _, status, _ in results)
    print('All requested checks passed.' if success else 'Checks did not all pass. Fix FAIL or BLOCKED items above, then rerun.', flush=True)
    print('Actual microphone playback, camera hardware and live provider access are not verified by these tests.', flush=True)
    return 0 if success else 1


if __name__ == '__main__':
    raise SystemExit(main())
