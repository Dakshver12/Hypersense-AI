"""Use generated, fingerprinted assets in deployments; retain normal dev sources."""
import os
from pathlib import Path
from backend.config import PROJECT_ROOT


def template_path(name):
    generated = PROJECT_ROOT / 'generated' / 'templates' / name
    # Source templates always remain authoritative in local development/tests.
    if os.getenv('VERCEL') == '1' and generated.is_file():
        return generated
    return PROJECT_ROOT / 'templates' / name
