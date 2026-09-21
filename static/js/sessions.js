import { requireTranscriptReview } from "./transcript-review.js";
import { checkpointSession, draftStore } from "./recovery.js";
import { state } from "./state.js";
import { $, renderQuestion } from "./dom.js";
import { renderDelivery, summarizeExpressions, poseSummary } from "./delivery.js";
import { cancelAutomation } from "./automation.js";
import { cancelQuestionSpeech, beginQuestionReadout } from "./speech.js";
import { recentQuestionsFor, rememberQuestion } from "./questions.js";
import {
  message,
  interviewSettings,
  concreteSettings,
  modeName,
  evaluationContext,
} from "./setup.js";
import { requireSessionCamera } from "./camera.js";
import { finishInterviewSession } from "./results.js";
import { updateAnswerTimer } from "./timer.js";
import { clearAudio } from "./recording.js";
import { api, run } from "./api.js";
import { returnSinglePractice, showCameraCheck, showInterviewPage } from "./navigation.js";

export function releaseSessionRecordings() {
  $("session-report")
    .querySelectorAll("audio")
    .forEach((player) => {
      player.pause();
      player.removeAttribute("src");
      player.load();
    });
  for (const answer of state.interviewSession?.answers || []) {
    if (answer.recording) {
      URL.revokeObjectURL(answer.recording.url);
      answer.recording = null;
    }
  }
}

export function sessionSnapshot() {
  const number = state.interviewSession.answers.length + 1;
  const extension = (state.filename.match(/\.([a-z0-9]{1,8})$/i) || [])[1] || "webm";
  const recording = state.blob?.size
    ? {
        blob: state.blob,
        url: URL.createObjectURL(state.blob),
        name: `answer-${String(number).padStart(2, "0")}.${extension}`,
        bytes: state.blob.size,
      }
    : null;
  return {
    interview_type: state.current.interview_type || "technical",
    question: state.current.question,
    retryOf: state.retryContext?.question === state.current.question ? { ...state.retryContext } : null,
    answer: $("transcript").value.trim(),
    recording,
    score: state.sessionEvaluation?.score ?? null,
    feedback: state.sessionEvaluation?.feedback ?? "Not scored",
    coaching: state.sessionEvaluation?.coaching ?? [],
    assessment: state.sessionEvaluation?.assessment ?? null,
    provider: state.sessionEvaluation?.provider ?? null,
    model: state.sessionEvaluation?.model ?? null,
    audio: state.deliveryAudio ? JSON.parse(JSON.stringify(state.deliveryAudio)) : null,
    head: poseSummary(),
    expressions: summarizeExpressions(),
    confidence: $("confidence-rating").value || null,
  };
}

export async function archiveSessionAnswer() {
  if (!state.interviewSession.loaded) { await checkpointSession(); return; }
  requireTranscriptReview();
  cancelQuestionSpeech(false);
  clearInterval(state.ticker);
  state.ticker = null;
  state.answerSubmitted = true;
  renderDelivery();
  state.interviewSession.answers.push(sessionSnapshot());
  state.interviewSession.loaded = false;
  state.current = null;
  await checkpointSession();
}

export async function loadSessionQuestion() {
  requireSessionCamera();
  const session = state.interviewSession;
  const settings = concreteSettings(session.settings, session.answers.length);
  let question;
  if (session.pendingQuestion) question = session.pendingQuestion.question;
  else if (session.source === "manual") question = session.questions[session.answers.length];
  else {
    message("Generating the next interview question…");
    const data = await api("/generate-question", {
      ...settings,
      recent_questions: recentQuestionsFor(settings.technology),
    });
    if (!data.question) throw Error("No question returned. Use Load / retry next question.");
    question = data.question;
    rememberQuestion(settings.technology, question);
  }
  state.sessionEvaluation = null;
  state.current = { ...settings, question };
  session.loaded = true;
  renderQuestion(question);
  $("question").lang = settings.language === "Hindi" ? "hi" : "en";
  $("context").textContent = [
    modeName(settings.interview_type),
    settings.technology,
    settings.difficulty,
    settings.language,
  ].join(" · ");
  $("spoken").value =
    settings.language === "Hindi" ? "hi" : settings.language === "English" ? "en" : "auto";
  clearAudio();
  $("transcript").value = "";
  $("result").hidden = true;
  await checkpointSession();
  session.pendingQuestion = null;
  beginQuestionReadout();
}

export async function startCheckedSession() {
  state.retryContext = null;
  state.singlePractice = false;
  requireSessionCamera();
  const previous = await draftStore("readonly", s => s.get("active"));
  if (previous) throw Error("An unfinished interview is saved. Return to setup and resume or discard it first.");
  const total = Number($("session-count").value),
    source = $("session-source").value;
  const questions = $("session-questions")
    .value.split(/^\s*---\s*$/m)
    .map((q) => q.trim())
    .filter(Boolean);
  if (source === "manual" && (questions.length !== total || questions.some((q) => q.length > 2000)))
    throw Error(
      `Paste exactly ${total} questions, each under 2,001 characters, separated by a line containing ---.`,
    );
  const settings = interviewSettings();
  if (!settings.technology) throw Error("Enter a technology first.");
  cancelQuestionSpeech(false);
  clearInterval(state.ticker);
  state.ticker = null;
  state.current = null;
  releaseSessionRecordings();
  state.interviewSession = {
    id: crypto.randomUUID(),
    date: new Date().toISOString(),
    active: true,
    loaded: false,
    total,
    source,
    questions,
    settings,
    answers: [],
  };
  $("session-report").hidden = true;
  await checkpointSession();
  await loadSessionQuestion();
}

export async function submitAnswer() {
  requireTranscriptReview();
  if (state.interviewSession?.active || state.singlePractice) requireSessionCamera();
  cancelQuestionSpeech(false);
  updateAnswerTimer();
  clearInterval(state.ticker);
  state.ticker = null;
  state.answerSubmitted = true;
  renderDelivery();
  message(
    state.interviewSession?.active ? "Submitting your answer…" : "Evaluating your reviewed answer…",
  );
  const data = await api("/evaluate-answer", {
    ...evaluationContext(state.current),
    question: state.current.question,
    answer: $("transcript").value.trim(),
    language: state.current.language,
  });
  if (
    !Number.isInteger(data.score) ||
    data.score < 0 ||
    data.score > 100 ||
    typeof data.feedback !== "string"
  )
    throw Error("The evaluation response is invalid.");
  if (state.interviewSession?.active) {
    state.sessionEvaluation = {
      score: data.score,
      feedback: data.feedback,
      provider: data.provider,
      model: data.model,
      coaching: data.coaching || [],
      assessment: data.assessment || null,
    };
    await archiveSessionAnswer();
    if (state.interviewSession.answers.length === state.interviewSession.total)
      finishInterviewSession();
    else await loadSessionQuestion();
    return;
  }
  releaseSessionRecordings();
  state.interviewSession = {
    id: crypto.randomUUID(),
    date: new Date().toISOString(),
    active: false,
    loaded: false,
    total: 1,
    source: "single",
    questions: [state.current.question],
    settings: { ...state.current },
    answers: [],
  };
  state.sessionEvaluation = {
    score: data.score,
    feedback: data.feedback,
    provider: data.provider,
    model: data.model,
    coaching: data.coaching || [],
    assessment: data.assessment || null,
  };
  state.interviewSession.answers.push(sessionSnapshot());
  finishInterviewSession();
}
export function initSessions() {
  $("session-start").onclick = () => {
    if (state.busy || state.recording || state.interviewSession?.active) return;
    if (!$("camera-consent").checked) {
      message("Check the camera consent box before continuing.", true);
      return;
    }
    const total = Number($("session-count").value);
    const questions = $("session-questions")
      .value.split(/^\s*---\s*$/m)
      .map((q) => q.trim())
      .filter(Boolean);
    if (
      $("session-source").value === "manual" &&
      (questions.length !== total || questions.some((q) => q.length > 2000))
    ) {
      message(`Paste exactly ${total} valid questions separated by ---.`, true);
      return;
    }
    showCameraCheck();
  };
  $("camera-check-continue").onclick = () =>
    run(async () => {
      requireSessionCamera();
      if (state.singlePractice && state.current && !state.interviewSession?.active) { returnSinglePractice(); return; }
      showInterviewPage();
      if (!state.interviewSession?.active) await startCheckedSession();
      else if (!state.interviewSession.loaded) await loadSessionQuestion();
      else message("Camera ready. Continue your current answer or load the next question.");
    });
  $("open-camera-check").onclick = () => {
    if (!state.busy && !state.recording) showCameraCheck();
  };
  $("camera-check-back").onclick = () => {
    if (!state.busy && !state.recording) showInterviewPage();
  };
  $("session-next").onclick = () =>
    run(async () => {
      if (!state.interviewSession?.active || state.speechPending) return;
      cancelAutomation();
      await archiveSessionAnswer();
      if (state.interviewSession.answers.length === state.interviewSession.total)
        finishInterviewSession();
      else await loadSessionQuestion();
    });
  $("session-end").onclick = () => run(async () => {
    if (state.recording || !state.interviewSession?.active) return;
    cancelAutomation();
    await archiveSessionAnswer();
    finishInterviewSession();
  });
  $("evaluate").onclick = () => {
    cancelAutomation();
    return run(submitAnswer);
  };
}
