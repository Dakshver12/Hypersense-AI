"""CPU Whisper singleton and configured Groq transcription."""

import os
import logging
import tempfile
from pathlib import Path
from threading import Lock
from time import perf_counter
from typing import Literal
from fastapi import UploadFile, Form, HTTPException
from faster_whisper import WhisperModel
from faster_whisper.audio import decode_audio
from groq import Groq, APIStatusError, APIConnectionError
from backend.services.delivery import audio_delivery_report

WHISPER_MODEL_NAME = os.getenv("WHISPER_MODEL", "small").strip() or "small"


whisper_model = None


whisper_lock = Lock()


def adapt_transcription(segments, info):
    """Preserve existing text/word timing format for the delivery report."""
    normalized = []
    texts = []
    for segment in segments:
        texts.append(segment.text)
        normalized.append(
            {
                "words": [
                    {"word": word.word, "start": word.start, "end": word.end}
                    for word in segment.words or []
                ]
            }
        )
    return {
        "text": "".join(texts).strip(),
        "language": info.language,
        "segments": normalized,
    }


def adapt_groq_transcription(data):
    text = data.get("text")
    if not isinstance(text, str) or not text.strip():
        raise HTTPException(
            422, "No speech was transcribed. Replay the recording before retrying."
        )
    words = data.get("words") or []
    if not isinstance(words, list) or any(
        (not isinstance(word, dict) for word in words)
    ):
        raise HTTPException(502, "Groq returned invalid word timings.")
    return {
        "text": text.strip(),
        "language": data.get("language"),
        "segments": [{"words": words}],
    }


def transcribe_audio(
    file: UploadFile, spoken_language: Literal["auto", "en", "hi"] = Form("auto")
):
    global whisper_model
    suffix = Path(file.filename or "").suffix.lower()
    allowed_formats = {".wav", ".mp3", ".m4a", ".webm", ".ogg", ".flac"}
    if suffix not in allowed_formats:
        raise HTTPException(
            status_code=400, detail="Upload a WAV, MP3, M4A, WebM, OGG, or FLAC file."
        )
    max_size = 10 * 1024 * 1024
    audio_bytes = file.file.read(max_size + 1)
    if not audio_bytes:
        raise HTTPException(status_code=400, detail="The file is empty.")
    if len(audio_bytes) > max_size:
        raise HTTPException(
            status_code=413, detail="Upload an audio file smaller than 10 MB."
        )
    try:
        with tempfile.TemporaryDirectory() as temp_dir:
            audio_path = Path(temp_dir) / f"recording{suffix}"
            audio_path.write_bytes(audio_bytes)
            try:
                audio = decode_audio(str(audio_path), sampling_rate=16000)
            except (ValueError, RuntimeError, OSError):
                raise HTTPException(
                    status_code=400,
                    detail="Could not decode the audio. Check the recording.",
                ) from None
            if len(audio) == 0:
                raise HTTPException(
                    status_code=400, detail="The recording contains no audio samples."
                )
            if len(audio) > 16000 * 120:
                raise HTTPException(
                    status_code=400,
                    detail="Use a recording no longer than two minutes.",
                )
            started = perf_counter()
            result = None
            engine, model, compute_type = ("faster-whisper", WHISPER_MODEL_NAME, "int8")
            fallback_reason = None
            provider = os.getenv("TRANSCRIPTION_PROVIDER", "groq").strip().lower()
            if provider not in {"groq", "local"}:
                raise HTTPException(
                    503, "TRANSCRIPTION_PROVIDER must be groq or local."
                )
            if provider == "groq":
                groq_key = os.getenv("GROQ_API_KEY", "").strip()
                if groq_key:
                    try:
                        with Groq(
                            api_key=groq_key, timeout=60.0, max_retries=0
                        ) as client:
                            options = {
                                "model": "whisper-large-v3",
                                "response_format": "verbose_json",
                                "timestamp_granularities": ["word", "segment"],
                                "temperature": 0.0,
                            }
                            if spoken_language != "auto":
                                options["language"] = spoken_language
                            with audio_path.open("rb") as source:
                                response = client.audio.transcriptions.create(
                                    file=source, **options
                                )
                        result = adapt_groq_transcription(response.model_dump())
                        engine, model, compute_type = ("groq", "whisper-large-v3", None)
                    except APIStatusError as exc:
                        if exc.status_code not in (429, 500, 502, 503, 504):
                            raise HTTPException(
                                502,
                                f"Groq transcription failed (HTTP {exc.status_code})."
                                " Check Groq access, or set"
                                " TRANSCRIPTION_PROVIDER=local.",
                            ) from None
                        fallback_reason = (
                            "Groq quota reached or service unavailable; used local"
                            " Whisper."
                        )
                    except APIConnectionError:
                        fallback_reason = (
                            "Could not connect to Groq; used local Whisper."
                        )
                else:
                    fallback_reason = "Groq key not configured; used local Whisper."
            if result is None:
                with whisper_lock:
                    if whisper_model is None:
                        if WHISPER_MODEL_NAME not in {
                            "tiny",
                            "base",
                            "small",
                            "medium",
                        }:
                            raise HTTPException(
                                status_code=503,
                                detail=(
                                    "Unknown WHISPER_MODEL. Use medium or small in"
                                    " .env, then restart."
                                ),
                            )
                        logging.warning(
                            "Loading faster-whisper %s (CPU INT8); first use may"
                            " download weights.",
                            WHISPER_MODEL_NAME,
                        )
                        whisper_model = WhisperModel(
                            WHISPER_MODEL_NAME,
                            device="cpu",
                            compute_type="int8",
                            cpu_threads=min(8, os.cpu_count() or 4),
                            num_workers=1,
                        )
                    vocabulary = (
                        "Python, Java, SQL, list, tuple, mutable, immutable, element,"
                        " elements, add, added, remove, removed, replace, replaced,"
                        " value, equality, identity, object, memory, double equals, is"
                        " operator, dictionary, function, class."
                    )
                    if spoken_language == "hi":
                        prompt = "तकनीकी साक्षात्कार। " + vocabulary
                    elif spoken_language == "en":
                        prompt = "Technical interview. " + vocabulary
                    else:
                        prompt = vocabulary
                    segments, info = whisper_model.transcribe(
                        audio,
                        task="transcribe",
                        language=None if spoken_language == "auto" else spoken_language,
                        initial_prompt=prompt,
                        word_timestamps=True,
                        vad_filter=True,
                        temperature=0.0,
                        beam_size=5,
                        condition_on_previous_text=False,
                    )
                    result = adapt_transcription(segments, info)
            transcription_seconds = round(perf_counter() - started, 2)
        text = result["text"].strip()
        if not text:
            raise HTTPException(
                status_code=422,
                detail="No speech was transcribed. Try a clearer recording.",
            )
        return {
            "text": text,
            "language": result.get("language"),
            "transcription_model": model,
            "transcription_engine": engine,
            "compute_type": compute_type,
            "transcription_notice": fallback_reason,
            "transcription_seconds": transcription_seconds,
            "delivery": audio_delivery_report(result, len(audio) / 16000, audio),
        }
    except HTTPException:
        raise
    except Exception:
        logging.exception("Audio transcription failed")
        raise HTTPException(
            status_code=500, detail="Transcription failed. Check the server terminal."
        ) from None
