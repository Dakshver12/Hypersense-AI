"""Decode real WAV bytes; simulate the cloud provider without using API keys."""
import io
import os
import unittest
import wave
from types import SimpleNamespace
from unittest.mock import patch
from fastapi import HTTPException, UploadFile
from backend.services import transcription


def recording():
    body=io.BytesIO()
    with wave.open(body,'wb') as wav:
        wav.setnchannels(1); wav.setsampwidth(2); wav.setframerate(16000)
        wav.writeframes(b'\0\0'*32000)
    body.seek(0)
    return UploadFile(filename='answer.wav',file=body)


class CloudTranscriptionTests(unittest.TestCase):
    def test_vercel_cloud_success_preserves_transcript_and_delivery(self):
        result={'text':'Python lists are mutable','language':'en','words':[
            {'word':'Python','start':0.1,'end':0.4},
            {'word':'lists','start':0.5,'end':0.7},
            {'word':'are mutable','start':0.8,'end':1.5}]}
        client=SimpleNamespace(audio=SimpleNamespace(transcriptions=SimpleNamespace(
            create=lambda **kw:SimpleNamespace(model_dump=lambda:result))))
        source=recording()
        try:
            with patch.dict(os.environ,{'VERCEL':'1','TRANSCRIPTION_PROVIDER':'groq','GROQ_API_KEY':'test-only'}), \
                    patch.object(transcription,'get_groq_client',return_value=client), \
                    patch.object(transcription,'WhisperModel') as local:
                data=transcription.transcribe_audio(source,'en')
                self.assertEqual(data['text'],result['text'])
                self.assertEqual(data['transcription_engine'],'groq')
                self.assertEqual(data['delivery']['recognized_words'],4)
                local.assert_not_called()
        finally: source.file.close()

    def test_vercel_missing_key_never_downloads_local_weights(self):
        source=recording()
        try:
            with patch.dict(os.environ,{'VERCEL':'1','TRANSCRIPTION_PROVIDER':'groq','GROQ_API_KEY':''}), \
                    patch.object(transcription,'WhisperModel') as local:
                with self.assertRaises(HTTPException) as caught:
                    transcription.transcribe_audio(source,'en')
                self.assertEqual(caught.exception.status_code,503)
                local.assert_not_called()
        finally: source.file.close()
