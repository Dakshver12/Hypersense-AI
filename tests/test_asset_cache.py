"""Asset cache policy, including conditional requests and nested modules."""
import unittest
from fastapi.testclient import TestClient
from main import app


class AssetCacheTests(unittest.TestCase):
    def test_assets_revalidate_on_reload(self):
        with TestClient(app) as client:
            for path in ("/static/js/app.js", "/static/js/results.js",
                         "/static/js/account-store.js", "/static/css/styles.css"):
                with self.subTest(path=path):
                    response = client.get(path)
                    self.assertEqual(response.status_code, 200)
                    self.assertEqual(response.headers["cache-control"],
                                     "no-cache, must-revalidate")
                    cached = client.get(path, headers={"If-None-Match": response.headers["etag"]})
                    self.assertEqual(cached.status_code, 304)
                    self.assertEqual(cached.headers["cache-control"],
                                     "no-cache, must-revalidate")
