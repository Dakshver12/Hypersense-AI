import { state } from "./state.js";
import { $ } from "./dom.js";
import { refresh } from "./ui.js";
let approvedText = null, approvedBlob = null, approvedQuestion = null;
export function reviewRequired() {
  return Boolean(state.blob?.size && $("transcript").value.trim());
}
export function transcriptApproved() {
  return !reviewRequired() || ($("transcript-confirm").checked &&
    approvedText === $("transcript").value && approvedBlob === state.blob && approvedQuestion === state.current);
}
export function resetTranscriptReview() {
  approvedText = approvedBlob = approvedQuestion = null;
  $("transcript-confirm").checked = false;
}
export function requireTranscriptReview() {
  if (!transcriptApproved()) throw Error("Review the transcript against your recording and confirm it before submitting.");
}
export function refreshTranscriptReview() {
  const needed = reviewRequired();
  $("transcript-review-confirmation").hidden = !needed;
  $("transcript-confirm").disabled = state.busy || state.recording || state.speechPending;
  $("transcript-review-status").textContent = !needed ? "" : transcriptApproved()
    ? "Transcript confirmed. You can submit your answer."
    : "Check technical terms against playback, correct any errors, then confirm below. Your answer will not submit automatically.";
}
export function initTranscriptReview() {
  // Keep the existing player and download link; move them beside transcript editing.
  $("transcript-audio-slot").appendChild($("recording-preview"));
  $("transcript-confirm").onchange = () => {
    approvedText = $("transcript").value; approvedBlob = state.blob; approvedQuestion = state.current;
    refresh();
  };
}
