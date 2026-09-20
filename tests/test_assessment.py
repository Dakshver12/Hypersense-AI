import json
import unittest
from types import SimpleNamespace
from unittest.mock import patch
from fastapi import HTTPException
from backend.schemas import AnswerRequest
from backend.services.evaluation import evaluate_answer

class AssessmentTests(unittest.TestCase):
    def evaluate(self, payload):
        with patch('backend.services.evaluation.generate_with_fallback', return_value=SimpleNamespace(text=json.dumps(payload), provider='Test', model='mock')):
            return evaluate_answer(AnswerRequest(question='Compare list and tuple mutability.', answer='Lists are mutable.'))

    def test_grounded_strengths_and_required_gap(self):
        result = self.evaluate({'score':50,'feedback':'Tuple mutability is missing.', 'assessment':{
            'strengths':[{'evidence':'Lists are mutable.','explanation':'Correct list mutability.'},{'evidence':'Tuples are immutable.','explanation':'Not actually said.'}],
            'gaps':['Explain that tuples are immutable.'],'next_step':'State both mutability rules together.'}})
        self.assertEqual(len(result.assessment.strengths),1)
        self.assertEqual(result.score,50)

    def test_contradictory_gaps_rejected(self):
        for score,gaps in [(100,['Missing tuple']), (50,[])]:
            with self.assertRaises(HTTPException) as failure:
                self.evaluate({'score':score,'feedback':'Summary', 'assessment':{'strengths':[],'gaps':gaps,'next_step':'Practise again.'}})
            self.assertEqual(failure.exception.status_code,502)

    def test_legacy_and_full_credit(self):
        self.assertIsNone(self.evaluate({'score':100,'feedback':'Correct.'}).assessment)
        result=self.evaluate({'score':100,'feedback':'Correct.','assessment':{'strengths':[],'gaps':[],'next_step':'Practise a comparable question.'}})
        self.assertEqual(result.assessment.gaps,[])
