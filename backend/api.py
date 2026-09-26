"""HTTP routes. Services are imported on demand to keep startup lightweight."""

from typing import Literal
from fastapi import APIRouter, Form, UploadFile
from backend.schemas import QuestionRequest, AnswerRequest, EvaluationResponse

router = APIRouter()


@router.post("/generate-question")
def generate_question(request: QuestionRequest):
    from backend.services.questions import generate_question as generate

    return generate(request)


@router.post("/evaluate-answer", response_model=EvaluationResponse)
def evaluate_answer(request: AnswerRequest):
    from backend.services.evaluation import evaluate_answer as evaluate

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
