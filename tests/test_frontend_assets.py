"""Fingerprint/static build checks do not connect to a database or providers."""
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile
import unittest
from unittest.mock import patch
from backend import assets

ROOT=Path(__file__).resolve().parents[1]

class FrontendAssetTests(unittest.TestCase):
    def test_template_selection_is_deployment_only(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder);(root/'templates').mkdir();(root/'generated/templates').mkdir(parents=True)
            source=root/'templates/auth.html';generated=root/'generated/templates/auth.html'
            source.write_text('source');generated.write_text('generated')
            with patch.object(assets,'PROJECT_ROOT',root),patch.dict(os.environ,{'VERCEL':''}):
                self.assertEqual(assets.template_path('auth.html'),source)
            with patch.object(assets,'PROJECT_ROOT',root),patch.dict(os.environ,{'VERCEL':'1'}):
                self.assertEqual(assets.template_path('auth.html'),generated)
                generated.write_text('<link href="/assets/auth.abc.css">')
                self.assertEqual(assets.template_path('auth.html'),source)
                (root/'static/bundles').mkdir(parents=True)
                (root/'static/bundles/auth.abc.css').write_text('body{}')
                self.assertEqual(assets.template_path('auth.html'),generated)
                generated.unlink();self.assertEqual(assets.template_path('auth.html'),source)

    def test_generated_assets_and_template_placeholders(self):
        # Run the Node build before this test: node scripts/build_frontend.cjs
        folder=ROOT/'generated/templates'
        if not (folder/'manifest.json').is_file():
            self.skipTest('Generated assets are checked after node scripts/build_frontend.cjs; source-only backend CI skips this build check.')
        manifest=json.loads((folder/'manifest.json').read_text())
        self.assertEqual(len(manifest),7)
        for name,entry in manifest.items():
            html=(folder/name).read_text()
            self.assertEqual(len(entry['styles']),1)
            self.assertEqual(len(entry['scripts']),1)
            for url in entry['styles']+entry['scripts']:
                self.assertRegex(url,r'^/assets/[\w-]+\.[a-f0-9]{16}\.(css|js)$')
                self.assertTrue((ROOT/'public'/url.lstrip('/')).is_file())
            self.assertIn('rel="modulepreload"',html)
        for marker in ['<!-- account-meta -->','<!-- include:setup -->','<!-- include:results -->']:
            self.assertIn(marker,(folder/'index.html').read_text())
        self.assertIn('<!-- social-providers -->',(folder/'auth.html').read_text())
        js=(ROOT/'public'/manifest['index.html']['scripts'][0].lstrip('/')).read_text()
        self.assertNotRegex(js,r'\bfrom\s*["\']\./')
        self.assertIn('/detect-face',js);self.assertIn('/static/js/microphone-pcm-worklet.js',js)
        self.assertLess(len(js),250_000)
        config=json.loads((ROOT/'vercel.json').read_text())
        policy=next(x for x in config['headers'] if x['source']=='/assets/(.*)')
        self.assertTrue(any('immutable' in x['value'] for x in policy['headers']))

    def test_every_bundle_is_served_by_app_fallback_with_correct_headers(self):
        from fastapi import FastAPI
        from fastapi.testclient import TestClient
        from backend.accounts.middleware import AccountSafetyMiddleware
        from backend.assets import BundledStaticFiles
        folder=ROOT/'generated/templates'
        if not (folder/'manifest.json').is_file():self.skipTest('Build frontend assets first.')
        manifest=json.loads((folder/'manifest.json').read_text())
        app=FastAPI();app.add_middleware(AccountSafetyMiddleware)
        app.mount('/assets',BundledStaticFiles(directory=ROOT/'static/bundles'))
        @app.get('/private-page')
        def private_page():return {'private':True}
        with TestClient(app) as client:
            for entry in manifest.values():
                for url in entry['styles']+entry['scripts']:
                    response=client.get(url)
                    self.assertEqual(response.status_code,200,url)
                    self.assertEqual(response.content,(ROOT/'public'/url.lstrip('/')).read_bytes())
                    self.assertIn('text/css' if url.endswith('.css') else 'javascript',response.headers['content-type'])
                    self.assertIn('immutable',response.headers['cache-control'])
                    self.assertNotIn('no-store',response.headers['cache-control'])
                    cached=client.get(url,headers={'If-None-Match':response.headers['etag']})
                    self.assertEqual(cached.status_code,304)
            self.assertEqual(client.get('/private-page').headers['cache-control'],'no-store')
            self.assertEqual(client.get('/assets/missing.css').status_code,404)
            self.assertEqual(client.get('/assets/%2e%2e/%2e%2e/backend/accounts/security.py').status_code,404)

if __name__=='__main__':unittest.main()
