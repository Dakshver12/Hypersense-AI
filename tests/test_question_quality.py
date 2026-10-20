"""Question text validation; all provider calls are mocked."""
import json
import unittest
from types import SimpleNamespace
from unittest.mock import patch
from fastapi import HTTPException
from backend.schemas import QuestionRequest, SessionQuestionsRequest
from backend.services.questions import (clean_generated_question, QuestionQualityError,
                                       generate_question, generate_session_questions)

GOOD='How would you split a comma-separated string into a Python list?'
BAD='*Idea 2 (String split):* You are parsing a line of text from a CSV file where'
def response(text):return SimpleNamespace(text=text,provider='Mock',model='test')

class QuestionQualityTests(unittest.TestCase):
    def test_removes_presentation_labels_without_rewriting_question(self):
        for label in ['Idea 2 (String split): ', '*Idea 2 (String split):* ', '**Question 1:** ', 'Question: ', '### Idea 3: ']:
            with self.subTest(label=label):self.assertEqual(clean_generated_question(label+GOOD),GOOD)

    def test_rejects_known_incomplete_or_internal_text(self):
        for value in [BAD,'You are reading a CSV file where','What would you do if','Describe the following:',
                      'How do you parse a CSV file…','Explain lists.\nAnswer: Lists are mutable.',
                      'Idea 1: Explain lists.\nIdea 2: Explain tuples.',
                      '<think>Compare possible prompts.</think> '+GOOD,
                      'What does this code print?\n```python\nprint(1)', 'x'*2001, None]:
            with self.subTest(value=value),self.assertRaises(QuestionQualityError):clean_generated_question(value)

    def test_preserves_multilingual_code_and_imperative_prompts(self):
        for value in [GOOD,'Explain the difference between a list and a tuple.',
                      'Python में list और tuple में क्या अंतर है?',
                      'Python mein list aur tuple ka fark samjhaiye.',
                      'What does this code print?\n```python\nprint("a,b".split(","))\n```',
                      'Option pricing is often simulated. How would you test such a simulation?']:
            self.assertEqual(clean_generated_question(value),value)

    def test_valid_single_question_uses_one_call(self):
        with patch('backend.services.questions.generate_with_fallback',return_value=response('Idea 2: '+GOOD)) as gen:
            result=generate_question(QuestionRequest(technology='Python'))
        self.assertEqual(result['question'],GOOD);self.assertEqual(gen.call_count,1)

    def test_single_question_repairs_once_and_stops(self):
        with patch('backend.services.questions.generate_with_fallback',side_effect=[response(BAD),response(GOOD)]) as gen:
            result=generate_question(QuestionRequest(technology='Python'))
        self.assertEqual(result['question'],GOOD);self.assertEqual(gen.call_count,2)
        self.assertIn('previous output failed',gen.call_args.args[1].system_instruction)
        with patch('backend.services.questions.generate_with_fallback',return_value=response(BAD)) as gen:
            with self.assertRaises(HTTPException) as error:generate_question(QuestionRequest(technology='Python'))
            self.assertEqual(error.exception.status_code,502);self.assertEqual(gen.call_count,2)
            self.assertNotIn(BAD,error.exception.detail)

    def test_cleaned_duplicate_is_not_returned(self):
        with patch('backend.services.questions.generate_with_fallback',return_value=response('Idea 2: '+GOOD)) as gen:
            with self.assertRaises(HTTPException) as error:generate_question(QuestionRequest(technology='Python',recent_questions=[GOOD]))
        self.assertEqual(error.exception.status_code,409);gen.assert_called_once()

    def test_batch_repairs_invalid_text_and_preserves_category_order(self):
        req=SessionQuestionsRequest(technology='Python',interview_types=['technical','hr'])
        def batch(q):return response(json.dumps({'questions':[{'interview_type':'technical','question':q},{'interview_type':'hr','question':'What interests you about this role?'}]}))
        with patch('backend.services.questions.generate_with_fallback',side_effect=[batch(BAD),batch('Idea 2: '+GOOD)]) as gen:
            result=generate_session_questions(req)
        self.assertEqual(gen.call_count,2);self.assertEqual([q['interview_type'] for q in result['questions']],req.interview_types)
        self.assertEqual(result['questions'][0]['question'],GOOD)

    def test_bad_json_or_provider_limits_do_not_trigger_extra_calls(self):
        req=SessionQuestionsRequest(technology='Python',interview_types=['technical'])
        with patch('backend.services.questions.generate_with_fallback',return_value=response('not JSON')) as gen:
            with self.assertRaises(HTTPException):generate_session_questions(req)
            gen.assert_called_once()
        with patch('backend.services.questions.generate_with_fallback',side_effect=HTTPException(429,'Quota reached')) as gen:
            with self.assertRaises(HTTPException) as error:generate_question(QuestionRequest(technology='Python'))
            self.assertEqual(error.exception.status_code,429);gen.assert_called_once()

if __name__=='__main__':unittest.main()
