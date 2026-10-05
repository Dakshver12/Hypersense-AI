import { state } from "./state.js";
import { $ } from "./dom.js";
import { api, run } from "./api.js";

export const controls = [
  "practice-focus",
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
  "spoken",
];

export function message(text, error = false) {
  $("status").textContent = text;
  $("status").className = error ? "error" : "";
  if ($("single-practice-status")) {
    $("single-practice-status").textContent = text;
    $("single-practice-status").className = error ? "error" : "muted";
  }
}

export function interviewSettings() {
  return {
    practice_focus: $("practice-focus").value.trim(),
    technology: $("technology").value.trim() || "General",
    difficulty: $("difficulty").value,
    language: $("language").value,
    interview_type: $("interview-type").value,
    target_role: $("target-role").value.trim(),
    job_description: $("job-description").value.trim(),
    candidate_level: $("candidate-level").value,
    resume_text: $("resume-text").value.trim(),
    auto_flow: $("auto-flow").value === "auto",
  };
}

export function concreteSettings(settings, index = null) {
  return {
    ...settings,
    interview_type:
      settings.interview_type === "mixed"
        ? ["technical", "behavioral", "hr"][
            index === null ? Math.floor(Math.random() * 3) : index % 3
          ]
        : settings.interview_type || "technical",
  };
}

export function candidateLevelName(level) {
  return (
    {
      student: "Student / learning",
      entry: "Entry-level / fresher",
      experienced: "Experienced professional",
      senior: "Senior / lead",
    }[level] || "Not specified"
  );
}

export function resumeStatus() {
  const n = $("resume-text").value.trim().length;
  $("resume-status").textContent = n
    ? `${n.toLocaleString()} / 12,000 characters. Review before starting.`
    : "No résumé added. You can still start a session.";
}

export function modeName(mode) {
  return (
    { technical: "Technical", behavioral: "Behavioral", hr: "HR", mixed: "Mixed" }[mode] ||
    "Technical"
  );
}

export function evaluationContext(settings) {
  return {
    interview_type: settings.interview_type || "technical",
    target_role: settings.target_role || "",
    job_description: settings.job_description || "",
  };
}
export function manualQuestionError() {
  if ($('session-source').value !== 'manual') return '';
  const total = Number($('session-count').value);
  const questions = $('session-questions').value.split(/^\s*---\s*$/m).map(q=>q.trim()).filter(Boolean);
  if(questions.length !== total) return `Add exactly ${total} questions, separated by a line containing ---. You have ${questions.length}.`;
  if(questions.some(q=>q.length > 2000)) return 'Keep each question within 2,000 characters.';
  return '';
}

export function initSetup() {
  const updateQuestionSource = () => {
    $("manual-question-fields").hidden = $("session-source").value !== "manual";
  };
  $("session-source").addEventListener("change", updateQuestionSource);
  updateQuestionSource();
  $("resume-text").addEventListener("input", resumeStatus);
  $("resume-file").onchange = () =>
    run(async () => {
      if (state.interviewSession?.active)
        throw Error("Finish the current session before changing your résumé.");
      const file = $("resume-file").files[0];
      if (!file) return;
      try {
        const suffix = file.name.toLowerCase().match(/\.(txt|pdf|docx)$/)?.[1];
        if (!suffix) throw Error("Choose a .txt, .pdf or .docx résumé file.");
        if (file.size > (suffix === "txt" ? 65536 : 5 * 1024 * 1024))
          throw Error(suffix === "txt" ? "Choose a .txt file up to 64 KB." : "Choose a PDF or DOCX file up to 5 MB.");
        let text;
        if (suffix === "txt") {
          text = await file.text();
          if (!text.trim() || text.includes("\u0000"))
            throw Error("This file has no readable résumé text. Paste the text instead.");
        } else {
          const form = new FormData();
          form.append("file", file, file.name);
          const result = await api("/api/account/resume-text", form, true);
          text = result.text;
        }
        if (text.length > 12000)
          throw Error("The résumé exceeds 12,000 characters. Paste the relevant sections instead.");
        $("resume-text").value = text;
        resumeStatus();
        message(`Résumé imported from ${suffix.toUpperCase()}. Review it and select your experience level.`);
      } finally {
        $("resume-file").value = "";
      }
    });
  $("clear-resume").onclick = () => {
    if (state.busy || state.recording || state.interviewSession?.active) return;
    $("resume-text").value = "";
    $("resume-file").value = "";
    resumeStatus();
  };
}
