"""Evaluate reviewed answers and retain grounded coaching observations."""

from fastapi import HTTPException
from pydantic import ValidationError
from google.genai import types
from backend.schemas import AnswerRequest, EvaluationResult, EvaluationResponse
from backend.services.providers import generate_with_fallback
from backend.services.prompts import evaluation_instruction, COACHING_INSTRUCTION, ASSESSMENT_INSTRUCTION


def grounded_coaching(items, answer):
    return [item for item in items if item.evidence.strip() and item.evidence in answer]


def evaluate_answer(request: AnswerRequest):
    if not request.question.strip() or not request.answer.strip():
        raise HTTPException(
            status_code=422, detail="Question and answer cannot be blank."
        )
    response = generate_with_fallback(
        request.model_dump_json(),
        types.GenerateContentConfig(
            system_instruction=evaluation_instruction(request.interview_type)
            + COACHING_INSTRUCTION + ASSESSMENT_INSTRUCTION,
            response_mime_type="application/json",
            response_schema=EvaluationResult,
            max_output_tokens=3072,
        ),
    )
    try:
        result = EvaluationResult.model_validate_json(response.text or "")
        result.coaching = grounded_coaching(result.coaching, request.answer)
        if result.assessment:
            result.assessment.strengths = [
                item for item in result.assessment.strengths
                if item.evidence.strip() and item.evidence in request.answer
            ]
            if (result.score == 100 and result.assessment.gaps) or (
                result.score < 100 and not result.assessment.gaps
            ):
                raise HTTPException(status_code=502, detail="The evaluator returned inconsistent score and gap details. Please retry.")
        return EvaluationResponse(
            **result.model_dump(), provider=response.provider, model=response.model
        )
    except ValidationError:
        raise HTTPException(
            status_code=502,
            detail="The evaluator returned an incomplete or invalid evaluation.",
        ) from None
