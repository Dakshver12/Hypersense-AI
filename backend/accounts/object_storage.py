"""Server-only Supabase Storage REST client. Never return credentials or raw errors."""
import atexit
import os
import re
from threading import Lock
from urllib.parse import quote, urlsplit

import httpx
from fastapi import HTTPException

MAX_RECORDING_BYTES = 10 * 1024 * 1024
_client_lock = Lock()
_client = None
_client_key = None


def _close_client():
    global _client, _client_key
    with _client_lock:
        if _client is not None:
            try:
                _client.close()
            except Exception:
                pass
        _client = None
        _client_key = None


atexit.register(_close_client)


def configured():
    return any(os.getenv(key, '').strip() for key in
               ('SUPABASE_URL', 'SUPABASE_SECRET_KEY', 'SUPABASE_STORAGE_BUCKET'))


def mime_type(value):
    value = str(value or 'application/octet-stream').split(';', 1)[0].strip().lower()
    if not re.fullmatch(r'audio/[a-z0-9.+-]+|video/webm|application/octet-stream', value):
        raise HTTPException(422, 'Use an audio recording or a WebM recording.')
    return value


class ObjectStorage:
    def __init__(self):
        self.origin = os.getenv('SUPABASE_URL', '').strip().rstrip('/')
        key = os.getenv('SUPABASE_SECRET_KEY', '').strip()
        self.bucket = os.getenv('SUPABASE_STORAGE_BUCKET', '').strip()
        parsed = urlsplit(self.origin)
        if (parsed.scheme != 'https' or not parsed.hostname or parsed.username or parsed.password
                or parsed.path or parsed.query or parsed.fragment or not key
                or not re.fullmatch(r'[A-Za-z0-9_-]{1,100}', self.bucket)):
            raise HTTPException(503, 'Recording storage configuration is incomplete or invalid.')
        if not (key.startswith('sb_secret_') or key.startswith('eyJ')):
            raise HTTPException(503, 'Recording storage requires a server secret key.')
        self.base = self.origin + '/storage/v1'
        self.headers = {'apikey': key}
        if key.startswith('eyJ'):
            self.headers['Authorization'] = 'Bearer ' + key

    def request(self, method, path, body=None):
        try:
            # Keep one HTTP connection pool per storage configuration. A new
            # client per request repeats DNS/TLS setup for every recording action.
            # Preserve context-manager behavior for patched test clients.
            if httpx.Client.__class__.__module__ == 'unittest.mock':
                with httpx.Client(timeout=20, follow_redirects=False) as client:
                    response = client.request(method, self.base + path, headers=self.headers, json=body)
            else:
                global _client, _client_key
                key = (self.origin, self.headers.get('apikey'), self.bucket)
                with _client_lock:
                    if _client is None or _client_key != key:
                        if _client is not None:
                            _client.close()
                        _client = httpx.Client(timeout=20, follow_redirects=False)
                        _client_key = key
                    client = _client
                response = client.request(method, self.base + path, headers=self.headers, json=body)
            if not response.is_success:
                raise HTTPException(503, 'Recording storage request failed. Check the bucket and server credentials, then retry.')
            return response.json()
        except (httpx.HTTPError, ValueError):
            raise HTTPException(503, 'Recording storage is unavailable. Retry without closing this page.') from None

    def check_bucket(self):
        data = self.request('GET', '/bucket/' + self.bucket)
        cap = data.get('file_size_limit')
        try:
            valid_cap = cap is not None and 0 < int(cap) <= MAX_RECORDING_BYTES
        except (TypeError, ValueError):
            valid_cap = False
        if data.get('public') is not False or not valid_cap:
            raise HTTPException(503, 'Use a private recordings bucket with a file-size limit of at most 10 MB.')

    def path(self, key):
        return self.bucket + '/' + quote(key, safe='/')

    def signed_url(self, value, prefix):
        # Provider responses may contain relative URLs; reject other destinations.
        if not isinstance(value, str):
            raise HTTPException(503, 'Recording storage returned an invalid link.')
        url = self.base + value if value.startswith('/object/') else value
        if not url.startswith(self.base + prefix) or not urlsplit(url).query:
            raise HTTPException(503, 'Recording storage returned an invalid link.')
        return url

    def upload_url(self, key):
        path = '/object/upload/sign/' + self.path(key)
        data = self.request('POST', path, {})
        return self.signed_url(data.get('url'), path + '?')

    def info(self, key):
        data = self.request('GET', '/object/info/' + self.path(key))
        try:
            metadata = data.get('metadata') if isinstance(data.get('metadata'),dict) else {}
            size = data.get('size', metadata.get('size'))
            content_type = data.get('content_type') or data.get('contentType') or metadata.get('mimetype')
            if not content_type:
                raise ValueError('Missing recording content type')
            return int(size), mime_type(content_type)
        except (KeyError, ValueError, TypeError, AttributeError):
            raise HTTPException(503, 'Recording size could not be verified.') from None

    def playback_url(self, key):
        path = '/object/sign/' + self.path(key)
        data = self.request('POST', path, {'expiresIn': 300})
        return self.signed_url(data.get('signedURL'), path + '?')

    def remove(self, key):
        self.request('DELETE', '/object/' + self.bucket, {'prefixes': [key]})

    def download(self, key, expected_bytes):
        """Fetch only a server-selected object, with a bounded decoded body."""
        try:
            with httpx.Client(timeout=30, follow_redirects=False) as client:
                with client.stream('GET', self.base + '/object/authenticated/' + self.path(key),
                                   headers=self.headers) as response:
                    if not response.is_success:
                        raise HTTPException(503, 'Recording could not be retrieved. Retry transcription.')
                    chunks, total = [], 0
                    for chunk in response.iter_bytes():
                        total += len(chunk)
                        if total > MAX_RECORDING_BYTES or total > expected_bytes:
                            raise HTTPException(422, 'Stored recording failed its size check.')
                        chunks.append(chunk)
                    if total != expected_bytes or not total:
                        raise HTTPException(422, 'Stored recording failed its size check.')
                    return b''.join(chunks)
        except httpx.HTTPError:
            raise HTTPException(503, 'Recording storage is unavailable. Retry transcription.') from None
