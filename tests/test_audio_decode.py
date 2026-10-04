import io
import wave
import unittest
import numpy as np
from backend.services.audio import decode_audio


class AudioDecodeTests(unittest.TestCase):
    def test_stereo_and_sample_rates_match_existing_decoder(self):
        from faster_whisper.audio import decode_audio as reference
        for rate in (8000, 16000, 44100, 48000):
            for channels in (1, 2):
                with self.subTest(rate=rate, channels=channels):
                    signal = (np.sin(np.arange(rate) * 2 * np.pi * 440 / rate) * 12000).astype(np.int16)
                    samples = signal if channels == 1 else np.column_stack((signal, -signal // 2))
                    source = io.BytesIO()
                    with wave.open(source, 'wb') as output:
                        output.setnchannels(channels)
                        output.setsampwidth(2)
                        output.setframerate(rate)
                        output.writeframes(samples.tobytes())
                    raw = source.getvalue()
                    actual = decode_audio(io.BytesIO(raw))
                    expected = reference(io.BytesIO(raw))
                    self.assertEqual(actual.dtype, np.float32)
                    self.assertEqual(len(actual), 16000)
                    np.testing.assert_allclose(actual, expected, atol=1 / 32768)

    def test_invalid_audio_is_rejected(self):
        with self.assertRaises((ValueError, RuntimeError, OSError)):
            decode_audio(io.BytesIO(b'not an audio file'))
