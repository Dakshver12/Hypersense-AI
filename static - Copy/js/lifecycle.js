import { state } from "./state.js";
import { cancelAutomation } from "./automation.js";
import { cancelQuestionSpeech } from "./speech.js";
import { releaseSessionRecordings } from "./sessions.js";
import { updateAnswerTimer } from "./timer.js";
import { stopCamera } from "./camera.js";

export function initLifecycle() {
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) updateAnswerTimer();
  });
  window.addEventListener("pagehide", () => {
    cancelAutomation();
    clearTimeout(state.microphoneReadyTimer);
    releaseSessionRecordings();
    cancelQuestionSpeech(false);
    stopCamera();
    clearInterval(state.ticker);
    state.stream?.getTracks().forEach((t) => t.stop());
    if (state.playUrl) URL.revokeObjectURL(state.playUrl);
  });
}
