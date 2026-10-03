import { state } from "./state.js";
import { $ } from "./dom.js";
import { run } from "./api.js";
import { transcribeAnswer } from "./recording.js";

export function cancelAutomation() {
  clearTimeout(state.automationTimer);
  state.automationTimer = null;
  state.automationToken++;
}

export function autoEnabled() {
  return Boolean(state.current?.auto_flow) && !state.automationPaused;
}

export function pauseAutomation(
  notice = "Automation paused. Use Record, Transcribe or Submit when ready.",
) {
  state.automationPaused = true;
  cancelAutomation();
  $("automation-status").textContent = notice;
}

export function queueAutoRecording() {
  if (!autoEnabled()) return;
  const question = state.current,
    token = state.automationToken;
  const attempt = () => {
    if (
      token !== state.automationToken ||
      state.current !== question ||
      !autoEnabled() ||
      state.answerSubmitted ||
      state.answerExpired
    )
      return;
    if (state.busy || state.speechPending) {
      state.automationTimer = setTimeout(attempt, 100);
      return;
    }
    if (!state.recording) {
      $("automation-status").textContent = "Starting microphone… Wait for “Recording—speak now”.";
      $("record").onclick();
    }
  };
  state.automationTimer = setTimeout(attempt, 200);
}

export async function autoProcessRecording() {
  if (!autoEnabled() || state.busy || !state.blob?.size) return;
  clearInterval(state.ticker);
  state.ticker = null;
  state.answerExpired = true;
  const question = state.current,
    token = state.automationToken;
  await run(async () => {
    $("automation-status").textContent = "Transcribing your answer…";
    await transcribeAnswer();
    if (token !== state.automationToken || question !== state.current || !autoEnabled()) return;
    $("automation-status").textContent = "Transcription ready. Review, confirm, then submit to continue.";

  });
}
export function initAutomation() {
  $("pause-automation").onclick = () => pauseAutomation();
}
