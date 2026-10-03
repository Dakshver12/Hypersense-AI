import { resetTranscriptReview, transcriptApproved, refreshTranscriptReview } from "./transcript-review.js";
import { state } from "./state.js";
import { $ } from "./dom.js";
import { pauseAutomation } from "./automation.js";
import { controls } from "./setup.js";
import { cameraReady } from "./camera.js";
import { clock } from "./timer.js";

export function refresh() {
  controls.forEach((id) => ($(id).disabled = state.busy || state.recording));
  $("duration").disabled =
    state.busy ||
    state.recording ||
    Boolean(state.current && !state.answerExpired && !state.answerSubmitted);
  $("generate").disabled = state.busy || state.recording;
  $("use-manual").disabled = state.busy || state.recording;
  $("replay-question").disabled =
    state.busy || state.recording || !state.current || state.speechActive;
  $("stop-speaking").disabled = !state.speechActive;

  $("record").disabled =
    (state.singlePractice && !cameraReady()) ||
    state.busy ||
    state.recording ||
    state.speechPending ||
    !state.current ||
    state.answerExpired ||
    state.answerSubmitted;
  $("stop").disabled = !state.recording;
  $("save-attempt").disabled =
    state.busy ||
    state.recording ||
    !state.current ||
    !(state.answerExpired || state.answerSubmitted);
  $("upload").disabled =
    state.busy ||
    state.recording ||
    state.speechPending ||
    !state.current ||
    state.answerExpired ||
    state.answerSubmitted;
  $("transcribe").disabled =
    state.busy || state.recording || !state.current || !state.blob || state.answerSubmitted;
  $("transcript").disabled =
    state.busy ||
    state.recording ||
    state.speechPending ||
    !state.current ||
    state.answerSubmitted ||
    (state.answerExpired && !state.blob);
  refreshSession();
  refreshTranscriptReview();
  $("evaluate").disabled =
    (state.singlePractice && !cameraReady()) ||
    state.busy ||
    state.recording ||
    state.speechPending ||
    !state.current ||
    !$("transcript").value.trim() ||
    !transcriptApproved() ||
    !$("result").hidden;
}

export function refreshSession() {
  const active = Boolean(state.interviewSession?.active);
  $("interview-action-bar").hidden = !active && !state.current;
  $("record").hidden = state.recording;
  $("stop").hidden = !state.recording;
  $("session-more-actions").hidden = !active;
  $("action-hint").textContent = state.recording
    ? "Recording… Stop recording before skipping."
    : state.speechPending ? "Listening to the question. You can skip it below."
    : "Record, review your transcript, then submit.";
  $("action-progress").textContent = active
    ? `Question ${Math.min(state.interviewSession.answers.length + 1, state.interviewSession.total)} of ${state.interviewSession.total}`
    : "Single-question practice";

  $("session-controls").hidden = !active;
  $("nav-dashboard").disabled = active || state.busy || state.recording;
  $("nav-practice").disabled = state.busy || state.recording;
  $("nav-practice").textContent = active ? "Return to interview" : "Interview setup";
  $("confidence-rating").disabled =
    state.busy || state.recording || !state.current || state.answerSubmitted;
  for (const id of ["export-report", "print-report", "download-readable-report"])
    $(id).disabled = active || state.busy || state.recording || !state.interviewSession;
  document
    .querySelectorAll("[data-session-history]")
    .forEach((button) => (button.disabled = active || state.busy || state.recording));
  $("retry-session-save").disabled = active || state.busy || state.recording;
  for (const id of ["save-session-notes", "session-notes-input"]) {
    const control = $(id);
    if (control) control.disabled = active || state.busy || state.recording;
  }
  const pendingButton = $("score-pending");
  if (pendingButton) pendingButton.disabled = active || state.busy || state.recording;
  $("evaluate").textContent = active ? "Submit answer & continue" : "Submit for feedback";
  for (const id of ["session-count", "session-source", "session-questions", "session-start"])
    $(id).disabled = state.busy || state.recording || active;
  $("session-start").disabled =
    state.busy || state.recording || active || !$("camera-consent").checked;
  $("camera-check-continue").disabled = state.busy || state.recording || !cameraReady();
  $("camera-check-continue").textContent = state.singlePractice && state.current ? "Return to question" : active ? "Return to interview" : "Start interview";
  $("camera-check-back").textContent = state.singlePractice && state.current ? "Back to question" : "Back to setup";
  $("camera-check-back").disabled = state.busy || state.recording;
  $("session-skip").hidden = !active;
  $("session-skip").disabled = !active || !state.interviewSession?.loaded || state.busy || state.recording;
  $("session-next").hidden = !active;
  $("session-end").hidden = !active;
  $("session-next").disabled = state.busy || state.recording || state.speechPending;
  $("session-end").disabled = state.busy || state.recording;
  if (active) {
    $("generate").disabled = true;
    $("use-manual").disabled = true;
    for (const id of [
      "auto-flow",
      "candidate-level",
      "resume-text",
      "resume-file",
      "clear-resume",
      "interview-type",
      "target-role",
      "job-description",
      "technology",
      "difficulty",
      "language",
      "duration",
    ])
      $(id).disabled = true;
    const n = state.interviewSession.answers.length;
    $("session-progress").textContent = state.interviewSession.loaded
      ? `Question ${n + 1} of ${state.interviewSession.total} · ${n} processed`
      : `${n} of ${state.interviewSession.total} processed · ready to load the next question`;
    $("session-next").textContent = !state.interviewSession.loaded
      ? "Load / retry next question"
      : n + 1 === state.interviewSession.total
        ? "Submit without scoring & finish"
        : "Submit without scoring & continue";
  }
}
export function initUi() {
  $("duration").onchange = () => {
    if (!state.current) clock(Number($("duration").value));
  };
  $("transcript").oninput = () => {
    resetTranscriptReview();
    pauseAutomation("Transcript editing: submit when ready.");
    $("result").hidden = true;
    refresh();
  };
}
