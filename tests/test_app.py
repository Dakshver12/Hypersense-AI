"""Contract and template tests; no network, credentials or model downloads."""

import ast
from html.parser import HTMLParser
import re
import unittest
from unittest.mock import patch
from fastapi.testclient import TestClient
from main import app
from backend.config import PROJECT_ROOT
from backend.pages import render_shell
from backend.schemas import QuestionRequest, AnswerRequest
from backend.services.delivery import audio_delivery_report, detected_fillers


class Markup(HTMLParser):
    def __init__(self):
        super().__init__()
        self.ids = []
        self.stack = []

    def handle_starttag(self, tag, attrs):
        values = dict(attrs)
        if "id" in values:
            self.ids.append(values["id"])
        if tag not in {"input", "meta", "br", "hr", "img", "link", "source"}:
            self.stack.append(tag)

    def handle_endtag(self, tag):
        if not self.stack or self.stack.pop() != tag:
            raise AssertionError("Invalid nesting: " + tag)

    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)
        if tag not in {"input", "meta", "br", "hr", "img", "link", "source"}:
            self.handle_endtag(tag)


class AppTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.client = TestClient(app)

    def test_pages_and_static_assets(self):
        for route in ["/interview", "/camera-check", "/results"]:
            response = self.client.get(route)
            self.assertEqual(response.status_code, 200)
            self.assertIn("/static/js/app.js", response.text)
            self.assertNotIn("<!-- include:", response.text)
        for path in (PROJECT_ROOT / "static").rglob("*"):
            if path.is_file():
                self.assertEqual(
                    self.client.get(
                        "/" + path.relative_to(PROJECT_ROOT).as_posix()
                    ).status_code,
                    200,
                )

    def test_markup_and_bindings(self):
        parser = Markup()
        parser.feed(render_shell())
        self.assertFalse(parser.stack)
        self.assertEqual(len(parser.ids), len(set(parser.ids)))
        ids = set(parser.ids) | {"score-pending", "live-camera-dock"}
        for path in (PROJECT_ROOT / "static/js").glob("*.js"):
            for name in re.findall(r'\$\(["\']([^"\']+)["\']\)', path.read_text(encoding="utf-8-sig")):
                self.assertIn(name, ids, path.name)

    def test_module_imports_resolve(self):
        for path in (PROJECT_ROOT / "static/js").glob("*.js"):
            for module in re.findall(r'from ["\']([^"\']+)["\']', path.read_text(encoding="utf-8-sig")):
                self.assertTrue((path.parent / module).is_file(), module)

    def test_python_syntax(self):
        for path in (PROJECT_ROOT / "backend").rglob("*.py"):
            ast.parse(path.read_text(encoding="utf-8-sig"))

    def test_invalid_question_payload(self):
        self.assertEqual(
            self.client.post("/generate-question", json={"technology": ""}).status_code,
            422,
        )
        self.assertEqual(
            self.client.post(
                "/evaluate-answer", json={"question": "Q", "answer": ""}
            ).status_code,
            422,
        )

    def test_question_route_delegates(self):
        with patch(
            "backend.services.questions.generate_question",
            return_value={"question": "Q"},
        ) as call:
            response = self.client.post(
                "/generate-question", json={"technology": "Python"}
            )
            self.assertEqual(response.json(), {"question": "Q"})
            self.assertIsInstance(call.call_args.args[0], QuestionRequest)

    def test_evaluation_route_preserves_zero(self):
        result = {
            "score": 0,
            "feedback": "Required content missing.",
            "provider": "test",
            "model": "mock",
            "coaching": [],
        }
        with patch(
            "backend.services.evaluation.evaluate_answer", return_value=result
        ) as call:
            response = self.client.post(
                "/evaluate-answer", json={"question": "Q", "answer": "A"}
            )
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json()["score"], 0)
            self.assertIsInstance(call.call_args.args[0], AnswerRequest)

    def test_delivery_timings_and_fillers(self):
        words = [
            {"word": "one", "start": 0, "end": 1},
            {"word": "two", "start": 2.5, "end": 3},
            {"word": "three", "start": 3, "end": 4},
        ]
        result = audio_delivery_report(
            {"text": "um one uh two three", "segments": [{"words": words}]}, 5
        )
        self.assertEqual(result["recognized_words"], 3)
        self.assertEqual(result["words_per_minute"], 45)
        self.assertEqual(result["pause_count"], 1)
        self.assertEqual(result["fillers"]["count"], 2)
        self.assertEqual(detected_fillers("summer human")["count"], 0)

    def test_screen_separation(self):
        for name in ["setup", "camera-check", "interview", "results", "dashboard"]:
            self.assertTrue(
                (PROJECT_ROOT / "templates/screens" / f"{name}.html").is_file()
            )
        self.assertLess(len((PROJECT_ROOT / "main.py").read_text(encoding="utf-8-sig").splitlines()), 30)
        self.assertNotIn(
            "function ", (PROJECT_ROOT / "templates/index.html").read_text(encoding="utf-8-sig")
        )


if __name__ == "__main__":
    unittest.main()
