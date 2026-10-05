"""Run offline backend checks with isolated storage, never the configured live DB."""
from pathlib import Path
import os
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))


def main():
    # Set before importing any test/backend module: load_dotenv does not overwrite
    # existing environment values. Individual tests may override these defaults.
    with tempfile.TemporaryDirectory(prefix='hypersense-checks-') as directory:
        isolated = {
            'DATABASE_URL': '', 'HYPERSENSE_DATA_DIR': directory,
            'APP_ENV': 'development', 'APP_ORIGIN': 'http://testserver',
            'MAIL_MODE': 'file', 'VERCEL': '0',
            'SUPABASE_URL': '', 'SUPABASE_SECRET_KEY': '',
            'SUPABASE_STORAGE_BUCKET': '',
            'GROQ_API_KEY': '', 'GEMINI_API_KEY': '', 'GOOGLE_API_KEY': '',
        }
        with patch.dict(os.environ, isolated):
            print('Backend checks: isolated temporary SQLite storage; live database and storage settings are disabled.', flush=True)
            suite = unittest.defaultTestLoader.discover(str(ROOT / 'tests'), pattern='test_*.py')
            result = unittest.TextTestRunner(verbosity=2).run(suite)
            return 0 if result.wasSuccessful() else 1


if __name__ == '__main__':
    raise SystemExit(main())
