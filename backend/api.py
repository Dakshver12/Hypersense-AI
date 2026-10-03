"""HTTP routes. Services are imported on demand to keep startup lightweight."""

from typing import Literal
from backend.usage.store import request_usage
from fastapi import APIRouter, Form, UploadFile
from backend.schemas import QuestionRequest, SessionQuestionsRequest, AnswerRequest, EvaluationResponse

router = APIRouter()


@router.post("/generate-question")
def generate_question(request: QuestionRequest):
    from backend.services.questions import generate_question as generate

    with request_usage("question"):
        return generate(request)


@router.post("/generate-session-questions")
def generate_session_questions(request: SessionQuestionsRequest):
    from backend.services.questions import generate_session_questions as generate

    with request_usage("session_questions"):
        return generate(request)


@router.post("/evaluate-answer", response_model=EvaluationResponse)
def evaluate_answer(request: AnswerRequest):
    from backend.services.evaluation import evaluate_answer as evaluate

    with request_usage("evaluation"):
        return evaluate(request)


@router.post("/transcribe")
def transcribe_audio(
    file: UploadFile, spoken_language: Literal["auto", "en", "hi"] = Form("auto")
):
    from backend.services.transcription import transcribe_audio as transcribe

    return transcribe(file, spoken_language)


@router.post("/detect-face")
def detect_face(file: UploadFile):
    from backend.services.face import detect_face as detect

    return detect(file)
