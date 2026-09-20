import { state } from "./state.js";
import { $ } from "./dom.js";
import { cancelAutomation } from "./automation.js";
import { cancelQuestionSpeech } from "./speech.js";
import { message, candidateLevelName, modeName, evaluationContext } from "./setup.js";
import { refresh } from "./ui.js";
import { addRecordingPlayer } from "./recording.js";
import { api } from "./api.js";
import { stopCamera } from "./camera.js";
import { saveFinishedSession } from "./storage.js";
import { showResultsPage } from "./navigation.js";

export function reportText(parent, tag, text) {
  const el = document.createElement(tag);
  el.textContent = text;
  parent.appendChild(el);
  return el;
}

export function renderBehaviorCoaching(parent, answer) {
  reportText(parent, "h5", "Answer communication & behavior examples");
  const items = Array.isArray(answer.coaching)
    ? answer.coaching
        .filter(
          (c) =>
            c &&
            typeof c.evidence === "string" &&
            c.evidence.trim() &&
            typeof answer.answer === "string" &&
            answer.answer.includes(c.evidence) &&
            typeof c.observation === "string" &&
            typeof c.suggestion === "string",
        )
        .slice(0, 3)
    : [];
  if (!items.length) {
    reportText(
      parent,
      "p",
      "No supported transcript coaching available for this answer. Older sessions and unscored answers may not include it.",
    );
    return;
  }
  for (const c of items) {
    const labels = {
      clarity: "Clarity",
      structure: "Structure",
      ownership: "Ownership described",
      teamwork: "Teamwork described",
      reflection: "Reflection described",
    };
    reportText(parent, "strong", labels[c.category] || "Answer observation");
    reportText(parent, "blockquote", c.evidence);
    reportText(parent, "p", c.observation);
    reportText(parent, "p", "Try next: " + c.suggestion);
  }
}

export function renderInterviewDelivery(parent, answers) {
  const box = document.createElement("section");
  box.className = "interview-delivery";
  parent.appendChild(box);
  reportText(box, "h3", "Interview Delivery & Behavior");
  reportText(
    box,
    "p",
    "Delivery measurements and optional practice suggestions are separate from answer scores. Transcript examples describe what you said, not verified conduct or personality.",
  );
  if (!answers.length) {
    reportText(box, "p", "Complete an answer to see observations.");
    return;
  }
  const list = document.createElement("ol");
  box.appendChild(list);
  for (const a of answers) {
    const row = document.createElement("li");
    list.appendChild(row);
    reportText(row, "h4", modeName(a.interview_type) + " · " + (a.question || "Answer"));
    const audio = a.audio;
    const number = (x) => typeof x === "number" && Number.isFinite(x);
    if (audio && number(audio.words_per_minute))
      reportText(
        row,
        "p",
        `Speaking pace: ${audio.words_per_minute} words/minute. Replay the explanation and check whether each point is easy to follow; faster is not automatically better.`,
      );
    else
      reportText(
        row,
        "p",
        "Speaking pace unavailable. Record and transcribe an answer to measure it.",
      );
    if (audio && number(audio.pause_count) && number(audio.longest_pause_seconds))
      reportText(
        row,
        "p",
        `Gaps of at least 1 second between recognized words: ${audio.pause_count}. Longest: ${audio.longest_pause_seconds} seconds. ${audio.pause_count ? "Replay the gaps: keep useful thinking pauses and rehearse transitions where you lost your place." : "Shorter pauses may still be present."}`,
      );
    if (audio?.levels && number(audio.levels.variation_db))
      reportText(
        row,
        "p",
        `Recorded volume variation: ${audio.levels.variation_db} dB. Replay quieter and louder sections to check audibility. This does not measure tone, confidence or vocal expressiveness; microphone gain affects it.`,
      );
    if (audio?.fillers && number(audio.fillers.count))
      reportText(
        row,
        "p",
        `Possible filler sounds in the original transcript: ${audio.fillers.count}. Recognition may omit fillers; check the recording before drawing conclusions.`,
      );
    if (a.head)
      reportText(
        row,
        "p",
        `Head orientation relative to calibration: turn ${a.head.yaw}°, nod ${a.head.pitch}°, tilt ${a.head.roll}° on average. Use playback or the camera preview to check framing; natural movement is fine.`,
      );
    else reportText(row, "p", "Calibrated camera observations unavailable.");
    const rating = Number(a.confidence);
    reportText(
      row,
      "p",
      Number.isInteger(rating) && rating >= 1 && rating <= 5
        ? `Your self-rated confidence: ${rating}/5. Compare this with your own later attempts.`
        : "Self-rated confidence: not provided.",
    );
    renderBehaviorCoaching(row, a);
  }
  reportText(
    box,
    "small",
    "Word timings are transcription estimates, not measured silence. Facial movements do not establish emotion or confidence. Tone, sentiment and an automatic confidence score are not measured here.",
  );
}

export function finishInterviewSession(restored = false) {
  cancelAutomation();
  state.interviewSession.active = false;
  stopCamera("Session ended. Camera is off.");
  cancelQuestionSpeech(false);
  clearInterval(state.ticker);
  state.ticker = null;
  state.current = null;
  const answers = state.interviewSession.answers;
  const scored = answers.filter((a) => a.score !== null);
  const report = $("session-report");
  report.querySelectorAll("audio").forEach((player) => player.pause());
  report.replaceChildren();
  report.hidden = false;
  const add = (parent, tag, text) => {
    const el = document.createElement(tag);
    el.textContent = text;
    parent.appendChild(el);
    return el;
  };
  add(report, "h3", "Interview session report");
  add(
    report,
    "p",
    `${answers.length} of ${state.interviewSession.total} questions completed. Target role: ${state.interviewSession.settings.target_role || "Not specified"}.`,
  );
  add(
    report,
    "p",
    "Selected experience level: " +
      candidateLevelName(state.interviewSession.settings.candidate_level) +
      ".",
  );
  for (const mode of ["technical", "behavioral", "hr"]) {
    const group = scored.filter((answer) => (answer.interview_type || "technical") === mode);
    if (group.length)
      add(
        report,
        "p",
        `${modeName(mode)} ${mode === "technical" ? "accuracy" : "answer quality"}: ${(group.reduce((sum, a) => sum + a.score, 0) / group.length).toFixed(1)}/100 across ${group.length} scored answers.`,
      );
  }
  if (!scored.length) add(report, "p", "No answers scored yet.");
  add(
    report,
    "p",
    "Unscored answers are excluded. Each interview type uses its own rubric; delivery observations remain separate.",
  );
  const pending = answers.filter((answer) => answer.score === null && answer.answer?.trim());
  if (pending.length) {
    add(
      report,
      "p",
      `${pending.length} answers await scoring. This sends their saved, reviewed transcripts to the configured evaluator and uses API quota.`,
    );
    const button = add(report, "button", "Score pending answers");
    button.id = "score-pending";
    button.type = "button";
    button.onclick = scorePendingAnswers;
  }
  const empty = answers.filter((answer) => answer.score === null && !answer.answer?.trim()).length;
  if (empty)
    add(report, "p", `${empty} unscored answers have no transcript and cannot be evaluated.`);
  const list = add(report, "ol", "");
  for (const a of answers) {
    const item = add(list, "li", "");
    add(item, "h4", modeName(a.interview_type) + " · " + a.question);
    if (a.recording) {
      addRecordingPlayer(item, a.recording);
    } else add(item, "p", "No recording was captured or uploaded for this answer.");
    add(item, "p", a.answer || "No reviewed transcript saved for this answer.");
    add(
      item,
      "p",
      a.score === null
        ? "Not scored"
        : `${modeName(a.interview_type)} ${!a.interview_type || a.interview_type === "technical" ? "accuracy" : "answer quality"}: ${a.score}/100. ${a.feedback}`,
    );
    if (a.provider) add(item, "p", `Evaluator: ${a.provider} (${a.model}).`);
    const audio = a.audio;
    add(
      item,
      "p",
      audio
        ? `Pace: ${audio.words_per_minute ?? "unavailable"} words/minute. Pauses ≥1 second: ${audio.pause_count ?? "unavailable"}. Longest recognized-word gap: ${audio.longest_pause_seconds ?? "unavailable"} seconds.`
        : "Voice timing unavailable.",
    );
    add(
      item,
      "p",
      a.head
        ? `Average absolute head angles: turn ${a.head.yaw}°, nod ${a.head.pitch}°, tilt ${a.head.roll}°.`
        : "Calibrated head observations unavailable.",
    );
    if (audio?.levels)
      add(
        item,
        "p",
        `Recorded volume variation: ${audio.levels.variation_db} dB; median: ${audio.levels.median_dbfs} dBFS.`,
      );
    if (audio?.fillers)
      add(item, "p", `Possible filler sounds in the original transcript: ${audio.fillers.count}.`);
    if (a.expressions)
      add(
        item,
        "p",
        "Facial movement signals (0–1): " +
          Object.entries(a.expressions.means)
            .map(([key, value]) => key + ": " + value.toFixed(2))
            .join(", "),
      );
    if (a.confidence) add(item, "p", `Self-rated confidence: ${a.confidence}/5.`);
  }
  renderInterviewDelivery(report, answers);
  add(report, "h4", "Next practice");
  add(
    report,
    "p",
    scored.some((a) => a.score < 100)
      ? "Revisit the specific gaps listed above, then explain the answer again in your own words."
      : "Practise structuring each answer as one main point, an example, and a brief conclusion.",
  );
  add(
    report,
    "p",
    "Compare the pace and pauses across your answers. Replay recordings you downloaded to decide which pauses helped your explanation. Head angles describe orientation, not confidence.",
  );
  $("session-progress").textContent =
    `Session finished: ${answers.length} of ${state.interviewSession.total} questions.`;
  if (!restored) saveFinishedSession(state.interviewSession);
  message("Session report ready.");
  refresh();
  showResultsPage(state.interviewSession.id);
}

export async function scorePendingAnswers() {
  if (state.busy || state.recording || !state.interviewSession || state.interviewSession.active)
    return;
  const session = state.interviewSession;
  const pending = session.answers.filter(
    (answer) => answer.score === null && answer.answer?.trim(),
  );
  if (!pending.length) return;
  state.busy = true;
  refresh();
  let completed = 0,
    errorMessage = "";
  try {
    // Preserve an earlier unsaved result before requesting any new evaluations.
    if (!(await saveFinishedSession(session)))
      throw Error("Save failed. Retry saving before requesting more scores.");
    for (const answer of pending) {
      message(`Scoring pending answer ${completed + 1} of ${pending.length}…`);
      const result = await api("/evaluate-answer", {
        ...evaluationContext({
          ...session.settings,
          interview_type: answer.interview_type || "technical",
        }),
        question: answer.question,
        answer: answer.answer.trim(),
        language: session.settings.language || "English",
      });
      if (
        !Number.isInteger(result.score) ||
        result.score < 0 ||
        result.score > 100 ||
        typeof result.feedback !== "string" ||
        !result.feedback.trim()
      )
        throw Error("The evaluator returned an invalid result. This answer remains unscored.");
      answer.score = result.score;
      answer.feedback = result.feedback;
      answer.coaching = result.coaching || [];
      answer.provider = result.provider || null;
      answer.model = result.model || null;
      completed++;
      if (!(await saveFinishedSession(session)))
        throw Error(
          "The latest score is visible but could not be saved. Keep this page open and use Retry saving session.",
        );
    }
  } catch (error) {
    errorMessage = error.message || "Scoring failed. Remaining answers are still pending.";
  } finally {
    state.busy = false;
    finishInterviewSession(true);
    message(
      errorMessage
        ? `${completed} new results received. ${errorMessage}`
        : `${completed} pending answers scored and saved.`,
      Boolean(errorMessage),
    );
  }
}

export function exportSessionReport(session) {
  const { resume_text, ...settings } = session.settings || {};
  return {
    format: "hypersense-report-v1",
    id: session.id,
    date: session.date,
    total: session.total,
    settings,
    note: "Recordings are downloaded separately. Confidence is self-rated; facial and voice observations are not emotion or confidence measurements.",
    answers: session.answers.map(({ recording, ...answer }) => ({
      ...answer,
      recording: recording ? { name: recording.name, bytes: recording.bytes } : null,
    })),
  };
}
export function initResults() {
  $("export-report").onclick = () => {
    if (state.busy || state.recording || !state.interviewSession || state.interviewSession.active)
      return;
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(exportSessionReport(state.interviewSession), null, 2)], {
        type: "application/json",
      }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = "hypersense-report-" + state.interviewSession.id + ".json";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  $("print-report").onclick = () => {
    if (!state.busy && !state.recording && state.interviewSession && !state.interviewSession.active)
      window.print();
  };
  window.addEventListener("beforeunload", (event) => {
    if (state.interviewSession?.active || state.recording || state.sessionSavePending) {
      event.preventDefault();
      event.returnValue = "";
    }
  });
}
