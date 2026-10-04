"""Load bundled GL dispatch libraries before MediaPipe initializes on Vercel."""
import ctypes
import os
from pathlib import Path
from threading import Lock

_lock = Lock()
_loaded = False
_handles = []


def load_native_libraries():
    global _loaded
    if os.getenv('VERCEL') != '1':
        return
    with _lock:
        if _loaded:
            return
        root = Path(__file__).resolve().parent.parent / '.vercel-native'
        for name in ('libGLdispatch.so.0','libEGL.so.1','libGLESv2.so.2'):
            _handles.append(ctypes.CDLL(str(root/name),mode=ctypes.RTLD_GLOBAL))
        _loaded = True
