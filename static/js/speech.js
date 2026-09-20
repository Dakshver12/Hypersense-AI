import { state } from "./state.js";
import { $ } from "./dom.js";
import { resetDelivery } from "./delivery.js";
import { cancelAutomation } from "./automation.js";
import { message } from "./setup.js";
import { refresh } from "./ui.js";
import { startAnswerTimer, clock } from "./timer.js";
import { showInterviewPage } from "./navigation.js";

export function cancelQuestionSpeech(startAnswer) {
  const pending = state.speechPending;
  state.speechToken++;
  clearTimeout(state.speechWatchdog);
  state.speechPending = false;
  state.speechActive = false;
  state.speechUtterance = null;
  if ("speechSynthesis" in window) window.speechSynthesis.cancel();
  if (startAnswer && pending && state.current) {
    startAnswerTimer();
    $("speech-status").textContent = "Readout stopped. Your answer timer has started.";
  }
}

export function speakQuestion(initial) {
  cancelQuestionSpeech(false);
  state.speechPending = initial;
  const token = ++state.speechToken;
  const finish = (notice) => {
    if (token !== state.speechToken) return;
    const pending = state.speechPending;
    state.speechToken++;
    clearTimeout(state.speechWatchdog);
    state.speechActive = false;
    state.speechPending = false;
    state.speechUtterance = null;
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    $("speech-status").textContent = notice;
    if (pending) startAnswerTimer();
    refresh();
  };
  if (!("speechSynthesis" in window) || !window.SpeechSynthesisUtterance) {
    finish(
      "Speech is unavailable in this browser. Read the question; your answer timer is running.",
    );
    return;
  }
  const utterance = new SpeechSynthesisUtterance(state.current.question);
  state.speechUtterance = utterance;
  utterance.lang = state.current.language === "Hindi" ? "hi-IN" : "en-IN";
  const voices = window.speechSynthesis.getVoices();
  const voice =
    voices.find((v) => v.lang.toLowerCase() === utterance.lang.toLowerCase()) ||
    voices.find((v) => v.lang.toLowerCase().startsWith(utterance.lang.slice(0, 2)));
  if (voice) utterance.voice = voice;
  utterance.rate = 0.95;
  state.speechActive = true;
  $("speech-status").textContent = initial
    ? "Reading question. Answer timer starts after readout."
    : "Replaying question. Your answer timer is not paused or reset.";
  utterance.onstart = () => {
    if (token !== state.speechToken) return;
    clearTimeout(state.speechWatchdog);
    state.speechWatchdog = setTimeout(
      () => finish("Readout ended at the time limit. You can answer now."),
      120000,
    );
  };
  utterance.onend = () =>
    finish(initial ? "Readout finished. Your answer timer has started." : "Replay finished.");
  utterance.onerror = () =>
    finish(
      initial
        ? "Readout unavailable. Read the question; your answer timer has started."
        : "Replay unavailable. Read the displayed question.",
    );
  state.speechWatchdog = setTimeout(
    () =>
      finish(
        initial
          ? "Readout did not start. Your answer timer has started; use Replay question to try again."
          : "Replay did not start.",
      ),
    8000,
  );
  try {
    window.speechSynthesis.speak(utterance);
  } catch {
    finish("Readout unavailable. Read the displayed question.");
  }
  refresh();
}

export function beginQuestionReadout() {
  if (!state.interviewSession?.active) showInterviewPage();
  cancelAutomation();
  state.automationPaused = false;
  clearTimeout(state.microphoneReadyTimer);
  $("microphone-status").textContent = "Click Record answer, then wait for “Recording—speak now”.";
  state.sessionEvaluation = null;
  clearInterval(state.ticker);
  state.ticker = null;
  state.answerExpired = false;
  state.answerSubmitted = false;
  state.deadline = 0;
  resetDelivery();
  clock(Number($("duration").value));
  message("Question ready.");
  speakQuestion(true);
}
export function initSpeech() {
  $("replay-question").onclick = () => {
    if (state.current && !state.recording && !state.busy) speakQuestion(false);
  };
  $("stop-speaking").onclick = () => {
    cancelQuestionSpeech(true);
    $("speech-status").textContent = "Readout stopped. Answer time continues.";
    refresh();
  };
}
