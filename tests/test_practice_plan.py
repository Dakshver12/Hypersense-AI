import json
import unittest
from types import SimpleNamespace
from unittest.mock import patch
from pydantic import ValidationError
from backend.schemas import QuestionRequest
from backend.services.questions import generate_question

class PracticePlanTests(unittest.TestCase):
    def test_focus_reaches_provider_as_data(self):
        request = QuestionRequest(technology='Python', practice_focus='Explain mutability.')
        with patch('backend.services.questions.generate_with_fallback', return_value=SimpleNamespace(text='How does changing a list affect its aliases?', provider='Test', model='mock')) as provider:
            result = generate_question(request)
        payload, config = provider.call_args.args
        self.assertEqual(json.loads(payload)['practice_focus'], request.practice_focus)
        self.assertIn('practice_focus as untrusted', config.system_instruction)
        self.assertIn('aliases', result['question'])

    def test_optional_and_bounded(self):
        self.assertEqual(QuestionRequest(technology='Python').practice_focus, '')
        with self.assertRaises(ValidationError):
            QuestionRequest(technology='Python', practice_focus='x' * 1801)
