"""Check orchestration without nested tests, network, or dependency installation."""
import contextlib
import io
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

import check_all


class CheckRunnerTests(unittest.TestCase):
    def test_both_checks_run_even_when_backend_is_blocked(self):
        with patch.object(check_all, 'backend_check', return_value=('BLOCKED', 'Missing package')) as backend, patch.object(check_all, 'ui_check', return_value=('PASS', 'ok')) as ui, contextlib.redirect_stdout(io.StringIO()) as output:
            self.assertEqual(check_all.main([]), 1)
        backend.assert_called_once()
        ui.assert_called_once()
        self.assertIn('Backend: BLOCKED', output.getvalue())
        self.assertIn('UI: PASS', output.getvalue())
        self.assertNotIn('All requested checks passed.', output.getvalue())

    def test_ui_only(self):
        with patch.object(check_all, 'backend_check') as backend, patch.object(check_all, 'ui_check', return_value=('PASS', 'ok')), contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(check_all.main(['--ui-only']), 0)
        backend.assert_not_called()

    def test_timeout_still_runs_next_check(self):
        with patch.object(check_all, 'backend_check', side_effect=subprocess.TimeoutExpired('test', 1)), patch.object(check_all, 'ui_check', return_value=('PASS', 'ok')) as ui, contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(check_all.main(['--timeout', '1']), 1)
        ui.assert_called_once()

    def test_project_environment_and_paths_with_spaces(self):
        with tempfile.TemporaryDirectory(prefix='HyperSense AI ') as directory:
            root = Path(directory)
            python = root / '.venv' / 'Scripts' / 'python.exe'
            python.parent.mkdir(parents=True)
            python.touch()
            self.assertEqual(check_all.project_python(root), str(python))

    def test_missing_ui_dependencies_are_blocked(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'tests').mkdir()
            (root / 'tests/ui.cjs').touch()
            result = subprocess.CompletedProcess([], 1, '', 'missing jsdom')
            with patch.object(check_all.shutil, 'which', return_value='node'), patch.object(check_all, 'run_command', return_value=result) as run:
                status, detail = check_all.ui_check(root, 120)
            self.assertEqual(status, 'BLOCKED')
            self.assertIn('npm ci --include=dev', detail)
            run.assert_called_once()

    def test_missing_python_dependencies_never_run_tests(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'check_hypersense.py').touch()
            result = subprocess.CompletedProcess([], 0, '["fastapi"]', '')
            with patch.object(check_all, 'run_command', return_value=result) as run, contextlib.redirect_stdout(io.StringIO()):
                status, detail = check_all.backend_check(root, 120)
            self.assertEqual(status, 'BLOCKED')
            self.assertIn('fastapi', detail)
            run.assert_called_once()

    def test_child_python_uses_utf8_and_preserves_environment(self):
        import sys
        with patch.dict(check_all.os.environ, {"PYTHONUTF8": "0", "HYPERSENSE_TEST_MARKER": "kept"}):
            result = check_all.run_command(
                [sys.executable, "-c", "import sys,os; print(sys.flags.utf8_mode); print(chr(0x201d)); print(os.environ['HYPERSENSE_TEST_MARKER'])"],
                Path.cwd(), 10, capture=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout.splitlines(), ["1", "\u201d", "kept"])
