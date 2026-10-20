"""Use generated, fingerprinted assets in deployments; retain normal dev sources."""
import os
import re
from pathlib import Path
from backend.config import PROJECT_ROOT


def template_path(name):
    generated = PROJECT_ROOT / 'generated' / 'templates' / name
    # Source templates always remain authoritative in local development/tests.
    if os.getenv('VERCEL') == '1' and generated.is_file():
        names = set(re.findall(r'/assets/([^\"\'<>\s]+)', generated.read_text(encoding='utf-8')))
        runtime = PROJECT_ROOT / 'static' / 'bundles'
        if all((runtime / name).is_file() for name in names):
            return generated
    return PROJECT_ROOT / 'templates' / name


from starlette.staticfiles import StaticFiles


class BundledStaticFiles(StaticFiles):
    """Serve build outputs when the platform does not publish public/assets."""
    async def get_response(self, path, scope):
        response = await super().get_response(path, scope)
        if response.status_code in (200, 304):
            response.headers['Cache-Control'] = 'public, max-age=31536000, immutable'
            response.headers['Vercel-CDN-Cache-Control'] = 'public, max-age=86400'
        return response
