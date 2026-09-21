import { state } from "./state.js";
import { $, renderQuestion } from "./dom.js";
import { message, interviewSettings, concreteSettings, modeName } from "./setup.js";
import { refresh } from "./ui.js";
import { clearAudio } from "./recording.js";
import { api, run } from "./api.js";
import { openSinglePractice } from "./navigation.js";

export const QUESTION_HISTORY_KEY = "hypersense-recent-questions-v1";

export function recentQuestionsFor(technology) {
  return state.recentQuestionHistory
    .filter((r) => r.technology === technology.trim().toLowerCase())
    .slice(-20)
    .map((r) => r.question);
}

export function rememberQuestion(technology, question) {
  state.recentQuestionHistory.push({ technology: technology.trim().toLowerCase(), question });
  state.recentQuestionHistory = state.recentQuestionHistory.slice(-100);
  try {
    localStorage.setItem(QUESTION_HISTORY_KEY, JSON.stringify(state.recentQuestionHistory));
  } catch {}
}
export function singlePracticeConsent() {
  if ($("single-camera-consent").checked) $("camera-consent").checked = true;
  if ($("camera-consent").checked) return true;
  const notice = "Please check camera consent above, then click the practice button again.";
  $("single-practice-status").textContent = notice;
  $("single-camera-consent").focus();
  message(notice, true);
  return false;
}
export function initQuestions() {
  $("single-camera-consent").onchange = () => {
    $("camera-consent").checked = $("single-camera-consent").checked;
    $("camera-consent").dispatchEvent(new Event("change"));
    $("single-practice-status").textContent = $("single-camera-consent").checked ? "Ready. Generate a question or paste your own below." : "Camera consent is required for practice.";
  };
  $("use-manual").onclick = () => {
    if (state.busy || state.recording) return;
    if (!singlePracticeConsent()) return;
    const question = $("manual-question").value.trim();
    if (!question) {
      message("Enter a practice question first.", true);
      return;
    }
    state.retryContext = null;
    state.current = { ...concreteSettings(interviewSettings()), question };
    renderQuestion(question);
    $("question").lang = state.current.language === "Hindi" ? "hi" : "en";
    $("context").textContent =
      modeName(state.current.interview_type) +
      " · " +
      state.current.technology +
      " · Manual practice question";
    $("spoken").value =
      state.current.language === "Hindi"
        ? "hi"
        : state.current.language === "English"
          ? "en"
          : "auto";
    clearAudio();
    $("transcript").value = "";
    $("result").hidden = true;
    openSinglePractice();
    refresh();
  };
  try {
    const stored = JSON.parse(localStorage.getItem(QUESTION_HISTORY_KEY) || "[]");
    if (Array.isArray(stored))
      state.recentQuestionHistory = stored
        .filter(
          (r) =>
            r &&
            typeof r.technology === "string" &&
            typeof r.question === "string" &&
            r.question.length > 0 &&
            r.question.length <= 2000,
        )
        .slice(-100);
  } catch {}
  $("generate").onclick = () =>
    run(async () => {
      if (!singlePracticeConsent()) return;
      const technology = $("technology").value.trim();
      if (!technology) throw Error("Enter a technology first.");
      message("Generating your question…");
      const settings = concreteSettings(interviewSettings());
      const data = await api("/generate-question", {
        ...settings,
        recent_questions: recentQuestionsFor(technology),
      });
      if (!data.question) throw Error("No question returned.");
      rememberQuestion(technology, data.question);
      state.retryContext = null;
    state.current = { ...settings, question: data.question };
      renderQuestion(state.current.question);
      $("context").textContent = [
        modeName(settings.interview_type),
        technology,
        settings.difficulty,
        settings.language,
      ].join(" · ");
      $("question").lang = settings.language === "Hindi" ? "hi" : "en";
      $("spoken").value =
        settings.language === "Hindi" ? "hi" : settings.language === "English" ? "en" : "auto";
      clearAudio();
      $("transcript").value = "";
      $("result").hidden = true;
      openSinglePractice();
    });
}
