import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from scripts import build_vercel


class VercelAssetTests(unittest.TestCase):
    def test_public_assets_are_current_and_source_is_untouched(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            (root / 'static/css').mkdir(parents=True)
            (root / 'static/js').mkdir()
            (root / 'static/css/site.css').write_text('body {color: white}')
            (root / 'static/js/app.js').write_text('import "./module.js"')
            (root / 'public/static').mkdir(parents=True)
            (root / 'public/static/stale.css').write_text('old')
            with patch.object(build_vercel, 'ROOT', root):
                build_vercel.prepare_static_assets()
            self.assertEqual((root / 'public/static/css/site.css').read_bytes(), (root / 'static/css/site.css').read_bytes())
            self.assertEqual((root / 'public/static/js/app.js').read_text(), 'import "./module.js"')
            self.assertFalse((root / 'public/static/stale.css').exists())
