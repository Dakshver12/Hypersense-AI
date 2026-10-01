"""Process-local rate-limit backoff; no API keys or user content are stored."""
import hashlib
import math
import os
import time
from threading import Lock

_lock = Lock()
_deadlines = {}


def provider_slot(provider, model, key):
    return provider, model, hashlib.sha256(key.encode()).hexdigest()


def remaining(slot):
    with _lock:
        return max(0, math.ceil(_deadlines.get(slot, 0) - time.monotonic()))


def mark_limited(slot, retry_after=None):
    try:
        seconds = float(retry_after)
        if not math.isfinite(seconds) or seconds <= 0:
            raise ValueError()
    except (TypeError, ValueError):
        try:
            seconds = float(os.getenv("PROVIDER_COOLDOWN_SECONDS", "60"))
            if not math.isfinite(seconds) or seconds <= 0:
                raise ValueError()
        except ValueError:
            seconds = 60
    seconds = min(seconds, 86400)
    with _lock:
        now = time.monotonic()
        for old in list(_deadlines):
            if _deadlines[old] <= now:
                del _deadlines[old]
        _deadlines[slot] = max(_deadlines.get(slot, 0), now + seconds)
    return remaining(slot)
