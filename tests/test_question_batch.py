import json
import unittest
import tempfile
from types import SimpleNamespace
from unittest.mock import patch, MagicMock
from fastapi import HTTPException
from pydantic import ValidationError
from google.genai import types, errors
from backend.schemas import SessionQuestionsRequest
from backend.services.questions import generate_session_questions
from backend.services import providers, provider_cooldown as cooldown


class BatchTests(unittest.TestCase):
    def request(self):
        return SessionQuestionsRequest(technology="Python", interview_types=["technical", "behavioral", "hr"])

    def items(self):
        return [{"interview_type": t, "question": "Question " + str(i)} for i, t in enumerate(self.request().interview_types)]

    def test_one_call_and_order(self):
        with patch("backend.services.questions.generate_with_fallback", return_value=SimpleNamespace(text=json.dumps({"questions": self.items()}), provider="Mock", model="test")) as generate:
            result = generate_session_questions(self.request())
        self.assertEqual(result["questions"], self.items())
        generate.assert_called_once()
        payload = json.loads(generate.call_args.args[0])
        self.assertEqual(payload["interview_types"], ["technical", "behavioral", "hr"])

    def test_reject_bad_batches_without_automatic_retry(self):
        wrong_order = self.items(); wrong_order[0]["interview_type"] = "hr"
        duplicate = self.items(); duplicate[1]["question"] = duplicate[0]["question"]
        blank = self.items(); blank[0]["question"] = " "
        for value in [None, [], {"questions": []}, {"questions": wrong_order}, {"questions": duplicate}, {"questions": blank}]:
            with self.subTest(value=value), patch("backend.services.questions.generate_with_fallback", return_value=SimpleNamespace(text=json.dumps(value))) as generate:
                with self.assertRaises(HTTPException) as caught:
                    generate_session_questions(self.request())
                self.assertEqual(caught.exception.status_code, 502)
                generate.assert_called_once()

    def test_recent_duplicates_and_bounds(self):
        req = self.request(); req.recent_questions = ["QUESTION 0?"]
        with patch("backend.services.questions.generate_with_fallback", return_value=SimpleNamespace(text=json.dumps({"questions": self.items()}))):
            with self.assertRaises(HTTPException): generate_session_questions(req)
        for values in [[], ["technical"] * 11, ["mixed"]]:
            with self.assertRaises(ValidationError):
                SessionQuestionsRequest(technology="Python", interview_types=values)


class CooldownTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.env = patch.dict("os.environ", {"HYPERSENSE_DATA_DIR": self.temp.name})
        self.env.start()
        cooldown._deadlines.clear()

    def tearDown(self):
        cooldown._deadlines.clear()
        self.env.stop()
        self.temp.cleanup()

    def test_expiry_and_credential_isolation(self):
        one = cooldown.provider_slot("Gemini", "model", "one")
        two = cooldown.provider_slot("Gemini", "model", "two")
        with patch.object(cooldown.time, "monotonic", return_value=100):
            self.assertEqual(cooldown.mark_limited(one, "120"), 120)
            self.assertEqual(cooldown.remaining(two), 0)
        with patch.object(cooldown.time, "monotonic", return_value=221):
            self.assertEqual(cooldown.remaining(one), 0)

    @patch.dict("os.environ", {"GEMINI_API_KEY": "test-gemini", "GROQ_API_KEY": "test-groq"})
    def test_429_then_skip_gemini_and_use_groq(self):
        config = types.GenerateContentConfig(system_instruction="test", max_output_tokens=8192)
        with patch.object(providers.genai, "Client") as gemini, patch.object(providers, "Groq") as groq:
            gemini.return_value.__enter__.return_value.models.generate_content.side_effect = errors.ClientError(429, {"error": {"message": "limited", "status": "RESOURCE_EXHAUSTED"}})
            groq.return_value.__enter__.return_value.chat.completions.create.return_value = SimpleNamespace(choices=[SimpleNamespace(finish_reason="stop", message=SimpleNamespace(content="valid"))])
            self.assertEqual(providers.generate_with_fallback("data", config).provider, "Groq")
            self.assertEqual(providers.generate_with_fallback("data", config).provider, "Groq")
            self.assertEqual(gemini.call_count, 1)
            self.assertEqual(groq.call_count, 2)
            self.assertEqual(groq.return_value.__enter__.return_value.chat.completions.create.call_args.kwargs["max_completion_tokens"], 8192)

    @patch.dict("os.environ", {"GEMINI_API_KEY": "test", "GROQ_API_KEY": ""})
    def test_no_fallback_returns_retry_after_without_request(self):
        slot = cooldown.provider_slot("Gemini", providers.os.getenv("GEMINI_MODEL", "gemini-3.6-flash"), "test")
        cooldown.mark_limited(slot, 60)
        with patch.object(providers.genai, "Client") as client:
            with self.assertRaises(HTTPException) as caught:
                providers.generate_with_fallback("data", types.GenerateContentConfig())
            self.assertEqual(caught.exception.status_code, 429)
            self.assertGreater(int(caught.exception.headers["Retry-After"]), 0)
            client.assert_not_called()
