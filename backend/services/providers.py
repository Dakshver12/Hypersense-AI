"""Gemini generation with the existing Groq fallback behavior."""

import os
from types import SimpleNamespace
from fastapi import HTTPException
from groq import Groq, APIStatusError, APIConnectionError
from google import genai
from google.genai import errors


def generate_with_fallback(contents, config):
    gemini_key = os.getenv("GEMINI_API_KEY", "").strip()
    groq_key = os.getenv("GROQ_API_KEY", "").strip()
    gemini_model = os.getenv("GEMINI_MODEL", "gemini-3.6-flash")
    if gemini_key:
        try:
            with genai.Client(api_key=gemini_key) as client:
                response = client.models.generate_content(
                    model=gemini_model, contents=contents, config=config
                )
            return SimpleNamespace(
                text=response.text, provider="Gemini", model=gemini_model
            )
        except errors.APIError as exc:
            if exc.code not in (429, 500, 502, 503, 504):
                raise HTTPException(
                    502, f"Gemini request failed (provider code: {exc.code})."
                ) from None
            if not groq_key:
                raise HTTPException(
                    429 if exc.code == 429 else 503,
                    "Gemini is limited or unavailable. Add GROQ_API_KEY to .env for"
                    " fallback, or retry later.",
                ) from None
    if not groq_key:
        raise HTTPException(503, "Set GEMINI_API_KEY or GROQ_API_KEY in .env.")
    model = os.getenv("GROQ_MODEL", "openai/gpt-oss-120b")
    payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": config.system_instruction},
            {"role": "user", "content": contents},
        ],
        "max_completion_tokens": 2048,
    }
    if config.response_mime_type == "application/json":
        payload["response_format"] = {"type": "json_object"}
    try:
        with Groq(api_key=groq_key, timeout=60.0, max_retries=0) as client:
            response = client.chat.completions.create(**payload)
        choice = response.choices[0]
        text = choice.message.content
        if (
            choice.finish_reason != "stop"
            or not isinstance(text, str)
            or (not text.strip())
        ):
            raise ValueError("Incomplete response")
        return SimpleNamespace(text=text, provider="Groq", model=model)
    except APIStatusError as exc:
        if exc.status_code == 403:
            raise HTTPException(
                502,
                "Groq denied access (403). If error 1010 persists with the official"
                " SDK, contact Groq support to review the access block.",
            ) from None
        if exc.status_code == 429:
            raise HTTPException(
                429,
                "Groq quota reached too. Your answer is preserved; retry later or"
                " submit without scoring.",
            ) from None
        raise HTTPException(
            502,
            f"Groq request failed (provider code: {exc.status_code}). Check the Groq"
            " key and model settings.",
        ) from None
    except (APIConnectionError, TimeoutError):
        raise HTTPException(
            503, "Groq is unavailable. Your answer is preserved; retry later."
        ) from None
    except (ValueError, AttributeError, IndexError, TypeError):
        raise HTTPException(
            502, "Groq returned an incomplete or invalid response. Retry later."
        ) from None
