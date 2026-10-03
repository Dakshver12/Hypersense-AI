import { state } from "./state.js";
import { $ } from "./dom.js";
import { run } from "./api.js";

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
        if (!/\.txt$/i.test(file.name) || file.size > 65536)
          throw Error("Choose a .txt file up to 64 KB, or paste résumé text.");
        const text = await file.text();
        if (!text.trim() || text.includes("\u0000"))
          throw Error("This file has no readable résumé text. Paste the text instead.");
        if (text.length > 12000)
          throw Error("The résumé exceeds 12,000 characters. Paste the relevant sections instead.");
        $("resume-text").value = text;
        resumeStatus();
        message("Résumé imported. Review it and select your experience level.");
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
