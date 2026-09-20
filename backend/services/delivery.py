"""Transcript timing, possible fillers, and recorded audio levels."""

import re
import math
from collections import Counter


def detected_fillers(text):
    tokens = re.findall("(?<!\\w)(?:u+m+|u+h+|e+r+m+|h+m+)(?!\\w)", text.casefold())
    counts = Counter(tokens)
    return {"count": len(tokens), "items": dict(counts)}


def recording_levels(audio, words, sample_rate=16000):
    """RMS in 50 ms frames whose centres fall in recognized-word intervals."""
    import numpy as np

    signal = np.asarray(audio, dtype=float)
    if signal.ndim != 1 or not signal.size or (not np.isfinite(signal).all()):
        return None
    frame_size = int(sample_rate * 0.05)
    n = signal.size // frame_size
    if n < 10:
        return None
    frames = signal[: n * frame_size].reshape(n, frame_size)
    centres = (np.arange(n) + 0.5) * frame_size / sample_rate
    keep = np.zeros(n, dtype=bool)
    for start, end, _ in words:
        keep |= (centres >= start) & (centres <= end)
    selected = frames[keep]
    if len(selected) < 10:
        return None
    rms = np.sqrt(np.mean(selected * selected, axis=1))
    rms = rms[rms > 1e-06]
    if len(rms) < 10:
        return None
    levels = 20 * np.log10(rms)
    floor_dbfs = max(-60.0, float(np.percentile(levels, 90)) - 35.0)
    levels = levels[levels >= floor_dbfs]
    if len(levels) < 10:
        return None
    low, median, high = np.percentile(levels, [10, 50, 90])
    return {
        "variation_db": round(float(high - low), 1),
        "median_dbfs": round(float(median), 1),
        "measured_seconds": round(len(levels) * frame_size / sample_rate, 2),
        "level_floor_dbfs": round(floor_dbfs, 1),
        "method": "gated-rms-v2",
    }


def audio_delivery_report(result, duration, audio=None):
    """Estimate timing from recognized words; gaps are not acoustic silence."""
    words = []
    for segment in result.get("segments", []):
        for item in segment.get("words", []):
            start, end = (item.get("start"), item.get("end"))
            token = str(item.get("word", "")).strip()
            if (
                token
                and isinstance(start, (int, float))
                and isinstance(end, (int, float))
                and math.isfinite(start)
                and math.isfinite(end)
                and (0 <= start < end <= duration + 0.1)
            ):
                words.append((start, min(end, duration), token))
    words.sort()
    if not words:
        return None
    count = sum((len(token.split()) for _, _, token in words))
    span = max((end for _, end, _ in words)) - words[0][0]
    gaps = []
    previous_end = words[0][1]
    for start, end, _ in words[1:]:
        gap = max(0, start - previous_end)
        if gap >= 1.0:
            gaps.append(gap)
        previous_end = max(previous_end, end)
    return {
        "fillers": detected_fillers(result.get("text", "")),
        "levels": recording_levels(audio, words) if audio is not None else None,
        "recognized_words": count,
        "recording_seconds": round(duration, 2),
        "speech_span_seconds": round(span, 2),
        "words_per_minute": (
            round(count * 60 / span, 1) if count >= 3 and span >= 3 else None
        ),
        "pause_count": len(gaps),
        "longest_pause_seconds": round(max(gaps, default=0), 2),
    }
