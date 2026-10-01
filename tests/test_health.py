"""The public probe must be safe for unauthenticated host monitoring."""
import unittest
import tempfile
from unittest.mock import patch
from fastapi.testclient import TestClient
from main import app

class HealthTests(unittest.TestCase):
    def test_public_liveness(self):
        with tempfile.TemporaryDirectory() as folder, patch.dict('os.environ', {
            'APP_ENV': 'development', 'APP_ORIGIN': 'http://127.0.0.1:8000',
            'MAIL_MODE': 'file', 'HYPERSENSE_DATA_DIR': folder,
        }), TestClient(app) as client:
            response = client.get('/healthz')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {'status': 'ok'})
        self.assertEqual(response.headers['cache-control'], 'no-store')
