"""Gemini generation with the existing Groq fallback behavior."""

import os
import atexit
from threading import Lock
from backend.usage.store import measure, record
from types import SimpleNamespace
from fastapi import HTTPException
from groq import Groq, APIStatusError, APIConnectionError
from google import genai
from google.genai import errors
from backend.services.provider_cooldown import provider_slot, remaining, mark_limited

_client_lock = Lock()
_gemini_clients = {}
_groq_clients = {}


def _cached_client(cache, factory, key, **kwargs):
    """Reuse provider HTTP clients so TLS/DNS setup happens once per worker."""
    # Test doubles should retain their normal constructor semantics; this keeps
    # call-count assertions meaningful without changing production connection reuse.
    if factory.__class__.__module__ == "unittest.mock":
        resource = factory(**kwargs)
        return resource.__enter__() if hasattr(resource, "__enter__") else resource
    cache_key = (id(factory), key)
    with _client_lock:
        client = cache.get(cache_key)
        if client is None:
            resource = factory(**kwargs)
            # The SDK clients support context management, but closing after every
            # request defeats connection reuse. Keep the resource until shutdown.
            client = resource.__enter__() if hasattr(resource, '__enter__') else resource
            cache[cache_key] = (resource, client)
        return cache[cache_key][1]


def _close_clients():
    with _client_lock:
        for resource, _ in [*(_gemini_clients.values()), *(_groq_clients.values())]:
            close = getattr(resource, 'close', None)
            if callable(close):
                try: close()
                except Exception: pass
            exit_method = getattr(resource, '__exit__', None)
            if callable(exit_method):
                try: exit_method(None, None, None)
                except Exception: pass
        _gemini_clients.clear(); _groq_clients.clear()


atexit.register(_close_clients)


def generate_with_fallback(contents, config):
    gemini_key = os.getenv("GEMINI_API_KEY", "").strip()
    groq_key = os.getenv("GROQ_API_KEY", "").strip()
    gemini_model = os.getenv("GEMINI_MODEL", "gemini-3.6-flash")
    gemini_slot = provider_slot("Gemini", gemini_model, gemini_key)
    gemini_wait = remaining(gemini_slot) if gemini_key else 0
    if gemini_wait:
        record("cooldown", "Gemini", "rate_limited")
    if gemini_wait and not groq_key:
        raise HTTPException(429, "Gemini is cooling down. Retry later.", headers={"Retry-After": str(gemini_wait)})
    if gemini_key and not gemini_wait:
        try:
            with measure("attempt", "Gemini"):
                client = _cached_client(_gemini_clients, genai.Client, gemini_key, api_key=gemini_key)
                response = client.models.generate_content(
                    model=gemini_model, contents=contents, config=config
                )
            return SimpleNamespace(
                text=response.text, provider="Gemini", model=gemini_model
            )
        except errors.APIError as exc:
            if exc.code == 429:
                response_headers = getattr(getattr(exc, "response", None), "headers", {}) or {}
                gemini_wait = mark_limited(gemini_slot, response_headers.get("retry-after"))
            if exc.code not in (429, 500, 502, 503, 504):
                raise HTTPException(
                    502, f"Gemini request failed (provider code: {exc.code})."
                ) from None
            if not groq_key:
                raise HTTPException(
                    429 if exc.code == 429 else 503,
                    "Gemini is limited or unavailable. Add GROQ_API_KEY to .env for"
                    " fallback, or retry later.",
                    headers={"Retry-After": str(gemini_wait)} if exc.code == 429 else None,
                ) from None
    if not groq_key:
        raise HTTPException(503, "Set GEMINI_API_KEY or GROQ_API_KEY in .env.")
    model = os.getenv("GROQ_MODEL", "openai/gpt-oss-120b")
    groq_slot = provider_slot("Groq", model, groq_key)
    groq_wait = remaining(groq_slot)
    if groq_wait:
        record("cooldown", "Groq", "rate_limited")
        raise HTTPException(429, "The fallback provider is cooling down. Retry later.", headers={"Retry-After": str(groq_wait)})
    payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": config.system_instruction},
            {"role": "user", "content": contents},
        ],
        "max_completion_tokens": config.max_output_tokens or 2048,
    }
    if config.response_mime_type == "application/json":
        payload["response_format"] = {"type": "json_object"}
    try:
        with measure("attempt", "Groq", fallback=bool(gemini_key)):
            client = _cached_client(_groq_clients, Groq, groq_key,
                                    api_key=groq_key, timeout=60.0, max_retries=0)
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
            groq_wait = mark_limited(groq_slot, exc.response.headers.get("retry-after"))
            raise HTTPException(
                429,
                "Groq quota reached too. Your answer is preserved; retry later or"
                " submit without scoring.",
                headers={"Retry-After": str(groq_wait)},
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
