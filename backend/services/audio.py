"""Decode cloud transcription audio without importing the local Whisper engine."""
import io
import av
import numpy as np


def decode_audio(input_file, sampling_rate=16000):
    resampler = av.AudioResampler(format='s16', layout='mono', rate=sampling_rate)
    raw = io.BytesIO()
    with av.open(input_file, mode='r', metadata_errors='ignore') as container:
        for frame in container.decode(audio=0):
            frame.pts = None
            for output in resampler.resample(frame):
                raw.write(output.to_ndarray().tobytes())
        for output in resampler.resample(None):
            raw.write(output.to_ndarray().tobytes())
    return np.frombuffer(raw.getvalue(), dtype=np.int16).astype(np.float32) / 32768.0
