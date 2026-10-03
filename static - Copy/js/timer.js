import { state } from "./state.js";
import { $ } from "./dom.js";
import { renderDelivery } from "./delivery.js";
import { queueAutoRecording } from "./automation.js";
import { message } from "./setup.js";
import { refresh } from "./ui.js";
import { stopRecording } from "./recording.js";

export function startAnswerTimer() {
  clearInterval(state.ticker);
  state.answerExpired = false;
  state.answerSubmitted = false;
  state.deadline = Date.now() + Number($("duration").value) * 1000;
  updateAnswerTimer();
  state.ticker = setInterval(updateAnswerTimer, 200);
  queueAutoRecording();
}

export function updateAnswerTimer() {
  if (!state.current || state.speechPending || state.answerSubmitted || state.answerExpired) return;
  const remaining = Math.max(0, Math.ceil((state.deadline - Date.now()) / 1000));
  clock(remaining);
  if (remaining === 0) {
    clearInterval(state.ticker);
    state.ticker = null;
    state.answerExpired = true;
    renderDelivery();
    if (state.recording) stopRecording();
    message("Time is up. Transcribe your recording or submit your saved answer.");
    refresh();
  }
}

export function clock(seconds) {
  $("timer").textContent =
    String(Math.floor(seconds / 60)).padStart(2, "0") + ":" + String(seconds % 60).padStart(2, "0");
}
