"""Validated request and response contracts."""

from typing import Annotated, Literal
from pydantic import BaseModel, Field


class QuestionRequest(BaseModel):
    candidate_level: Literal[
        "unspecified", "student", "entry", "experienced", "senior"
    ] = "unspecified"
    resume_text: str = Field(default="", max_length=12000)
    interview_type: Literal["technical", "behavioral", "hr"] = "technical"
    target_role: str = Field(default="", max_length=160)
    job_description: str = Field(default="", max_length=4000)
    technology: str = Field(min_length=1, max_length=80)
    difficulty: Literal["easy", "medium", "hard"] = "easy"
    language: Literal["English", "Hindi", "Hinglish"] = "English"
    recent_questions: list[Annotated[str, Field(min_length=1, max_length=2000)]] = (
        Field(default_factory=list, max_length=20)
    )


class AnswerRequest(BaseModel):
    interview_type: Literal["technical", "behavioral", "hr"] = "technical"
    target_role: str = Field(default="", max_length=160)
    job_description: str = Field(default="", max_length=4000)
    question: str = Field(min_length=1, max_length=2000)
    answer: str = Field(min_length=1, max_length=8000)
    language: Literal["English", "Hindi", "Hinglish"] = "English"


class CoachingObservation(BaseModel):
    category: Literal["clarity", "structure", "ownership", "teamwork", "reflection"]
    evidence: str = Field(min_length=1, max_length=300)
    observation: str = Field(min_length=1, max_length=600)
    suggestion: str = Field(min_length=1, max_length=600)


class EvaluationResult(BaseModel):
    coaching: list[CoachingObservation] = Field(default_factory=list, max_length=3)
    score: int = Field(ge=0, le=100)
    feedback: str = Field(min_length=1, max_length=1500)


class EvaluationResponse(EvaluationResult):
    provider: str
    model: str
