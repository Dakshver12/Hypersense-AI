import { accountKey } from "./account-context.js";
import { state } from "./state.js";
import { $ } from "./dom.js";
import { relativeAngles } from "./camera.js";

export function resetDelivery() {
  state.attemptId = Date.now().toString(36) + "-" + Math.random().toString(36).slice(2);
  state.attemptDate = new Date().toISOString();
  $("confidence-rating").value = "";
  $("save-status").textContent = "Save after the timer ends or you submit your answer.";
  state.expressionSamples = [];
  state.deliveryEpoch++;
  state.deliveryAudio = null;
  state.deliveryPose = [];
  state.deliveryFrames = 0;
  $("delivery-report").hidden = true;
}

export function captureDeliveryPose(data, epoch) {
  if (
    epoch !== state.deliveryEpoch ||
    !state.current ||
    state.answerExpired ||
    state.answerSubmitted ||
    Date.now() >= state.deadline
  )
    return;
  state.deliveryFrames++;
  const r = data.rotation;
  if (
    state.calibrating ||
    !state.neutralRotation ||
    data.face_count !== 1 ||
    !Array.isArray(r) ||
    r.length !== 3 ||
    !r.every((row) => Array.isArray(row) && row.length === 3 && row.every(Number.isFinite))
  )
    return;
  state.deliveryPose.push(relativeAngles(state.neutralRotation, r));
}

export function renderDelivery() {
  if (state.interviewSession?.active) {
    $("delivery-report").hidden = true;
    return;
  }
  if (!state.current) return;
  $("delivery-report").hidden = false;
  const a = state.deliveryAudio;
  $("delivery-audio").textContent = a
    ? (a.words_per_minute === null
        ? "Too little timed speech to estimate pace."
        : a.words_per_minute + " words/minute (first to last recognized word, including pauses).") +
      " Recognized words: " +
      a.recognized_words +
      ". Pauses ≥1 second: " +
      a.pause_count +
      ". Longest: " +
      a.longest_pause_seconds +
      " seconds."
    : state.blob
      ? "Transcribe this recording to add voice timing."
      : "Voice timing unavailable: no recording was transcribed.";
  const levels = a?.levels,
    fillers = a?.fillers;
  $("delivery-levels").textContent = levels
    ? "Recorded level variation: " +
      levels.variation_db +
      " dB. Median level: " +
      levels.median_dbfs +
      " dBFS (relative to digital maximum, not room loudness). Based on " +
      levels.measured_seconds +
      " seconds of measured frames."
    : "Volume observations unavailable: transcribe enough recorded speech.";
  $("delivery-fillers").textContent = fillers
    ? fillers.count > 0
      ? "Detected " +
        fillers.count +
        " possible filler sounds: " +
        Object.entries(fillers.items)
          .map(([word, count]) => word + " × " + count)
          .join(", ") +
        "."
      : "No listed filler sounds appeared in the transcript. Replay the audio to check."
    : "Filler observations unavailable: transcribe a recording first.";
  if (state.deliveryPose.length >= 3) {
    const mean = (id) =>
      (
        state.deliveryPose.reduce((sum, p) => sum + Math.abs(p[id]), 0) / state.deliveryPose.length
      ).toFixed(1);
    $("delivery-camera").textContent =
      "Average absolute angle from neutral — Turn: " +
      mean("yaw") +
      "°, Nod: " +
      mean("pitch") +
      "°, Tilt: " +
      mean("roll") +
      "°. Based on " +
      state.deliveryPose.length +
      " calibrated samples out of " +
      state.deliveryFrames +
      " processed frames during the answer.";
  } else {
    $("delivery-camera").textContent =
      "Head summary unavailable: fewer than 3 calibrated samples. Enable and calibrate the camera before answering.";
  }
  renderExpressionSummary();
  renderCoaching();
}

export const EXPRESSION_LABELS = {
  mouth_corners_up: "Mouth corners raised",
  brows_raised: "Brows raised",
  brows_lowered: "Brows lowered",
  jaw_open: "Jaw opening",
};

export function validExpressions(data) {
  return (
    data.face_count === 1 &&
    data.expressions &&
    Object.keys(EXPRESSION_LABELS).every(
      (key) =>
        Number.isFinite(data.expressions[key]) &&
        data.expressions[key] >= 0 &&
        data.expressions[key] <= 1,
    )
  );
}

export function showExpressions(data, epoch) {
  const area = $("expression-live");
  area.replaceChildren();
  if (!validExpressions(data)) {
    area.textContent =
      data.face_count > 1
        ? "Keep one face in view for facial movement estimates."
        : "Facial movements unavailable in this frame.";
    return;
  }
  for (const [key, label] of Object.entries(EXPRESSION_LABELS)) {
    const row = document.createElement("div");
    const value = data.expressions[key];
    const caption = document.createElement("span");
    caption.textContent = label + ": " + value.toFixed(2) + " ";
    const meter = document.createElement("meter");
    meter.min = 0;
    meter.max = 1;
    meter.value = value;
    meter.setAttribute("aria-label", label);
    row.append(caption, meter);
    area.append(row);
  }
  if (
    epoch === state.deliveryEpoch &&
    state.current &&
    !state.answerExpired &&
    !state.answerSubmitted &&
    Date.now() < state.deadline
  ) {
    state.expressionSamples.push({ ...data.expressions });
  }
}

export function summarizeExpressions() {
  if (state.expressionSamples.length < 3) return null;
  return {
    samples: state.expressionSamples.length,
    means: Object.fromEntries(
      Object.keys(EXPRESSION_LABELS).map((key) => [
        key,
        Number(
          (
            state.expressionSamples.reduce((sum, r) => sum + r[key], 0) /
            state.expressionSamples.length
          ).toFixed(3),
        ),
      ]),
    ),
  };
}

export function renderExpressionSummary() {
  const area = $("expression-summary");
  area.replaceChildren();
  const summary = summarizeExpressions();
  if (!summary) {
    area.textContent =
      "Unavailable: fewer than 3 usable facial movement samples during this answer.";
    return;
  }
  const intro = document.createElement("p");
  intro.textContent = "Average model signal (0–1), based on " + summary.samples + " usable frames:";
  area.append(intro);
  const list = document.createElement("ul");
  for (const [key, label] of Object.entries(EXPRESSION_LABELS)) {
    const li = document.createElement("li");
    li.textContent = label + ": " + summary.means[key].toFixed(2);
    list.append(li);
  }
  area.append(list);
}

export const HISTORY_KEY = "hypersense-practice-v1";

export function readAttempts() {
  const raw = JSON.parse(localStorage.getItem(accountKey(HISTORY_KEY)) || "[]");
  if (!Array.isArray(raw)) throw Error("Invalid saved history");
  return raw
    .filter((r) => r && typeof r.id === "string" && typeof r.date === "string")
    .slice(0, 20);
}

export function poseSummary() {
  if (state.deliveryPose.length < 3) return null;
  return Object.fromEntries(
    ["yaw", "pitch", "roll"].map((id) => [
      id,
      Number(
        (
          state.deliveryPose.reduce((sum, p) => sum + Math.abs(p[id]), 0) /
          state.deliveryPose.length
        ).toFixed(1),
      ),
    ]),
  );
}

export function renderCoaching() {
  const tips = [];
  const a = state.deliveryAudio;
  if (a) {
    if (a.pause_count > 0)
      tips.push(
        "The longest recognized-word gap was " +
          a.longest_pause_seconds +
          " seconds. Replay that section: keep a useful thinking pause, or rehearse the transition if you lost your place.",
      );
    else
      tips.push(
        "No recognized-word gap reached 1 second. Try a deliberate pause between your main point and example, then replay both versions for clarity.",
      );
    tips.push(
      "Explain one point, give an example, then conclude. Use playback to decide whether your pace makes each step easy to follow.",
    );
  } else tips.push("Record and transcribe an answer to receive voice-based practice suggestions.");
  if (a?.levels)
    tips.push(
      "Replay a quieter and a louder part of the recording. Keep a comfortable microphone distance and check that sentence endings remain audible; a larger volume range is not automatically better.",
    );
  if (a?.fillers?.count > 0)
    tips.push(
      "The transcript contains " +
        a.fillers.count +
        " possible filler sounds. Listen first; if they distract from your answer, practise replacing one with a short thinking pause.",
    );
  const pose = poseSummary();
  if (pose) {
    const axis = Object.keys(pose).reduce((a, b) => (pose[a] >= pose[b] ? a : b));
    const names = { yaw: "turning", pitch: "nodding", roll: "tilting" };
    tips.push(
      "Your largest average angle was " +
        names[axis] +
        " (" +
        pose[axis] +
        "°). For your next attempt, keep the question near the camera and use a comfortable head position; natural movement is fine.",
    );
  } else
    tips.push("For head observations, enable and calibrate the camera before your next answer.");
  $("delivery-tips").replaceChildren();
  for (const text of tips) {
    const li = document.createElement("li");
    li.textContent = text;
    $("delivery-tips").append(li);
  }
  let previous;
  try {
    previous = readAttempts().find(
      (r) =>
        r.id !== state.attemptId &&
        r.technology === state.current.technology &&
        r.language === state.current.language &&
        r.difficulty === state.current.difficulty,
    );
  } catch {}
  const comparison = [];
  if (previous && Number.isFinite(a?.words_per_minute) && Number.isFinite(previous.pace)) {
    const delta = a.words_per_minute - previous.pace;
    comparison.push(
      "Pace is " +
        Math.abs(delta).toFixed(1) +
        " words/minute " +
        (delta >= 0 ? "higher" : "lower") +
        " than your latest saved attempt with the same settings. A change alone does not indicate improvement.",
    );
  }
  const rating = Number($("confidence-rating").value);
  if (previous && rating && previous.confidence)
    comparison.push(
      "Your confidence rating: " +
        rating +
        "/5; previous: " +
        previous.confidence +
        "/5. These are your own ratings.",
    );
  $("delivery-comparison").textContent =
    comparison.join(" ") ||
    "Save attempts with the same settings to compare your pace and self-rated confidence.";
}

export function renderHistory() {
  const area = $("practice-history");
  area.replaceChildren();
  let rows;
  try {
    rows = readAttempts();
    $("history-status").textContent = "";
  } catch {
    $("history-status").textContent = "Saved summaries could not be read in this browser.";
    return;
  }
  $("clear-history").disabled = !rows.length;
  if (!rows.length) {
    area.textContent = "No saved attempts yet.";
    return;
  }
  const list = document.createElement("ul");
  for (const row of rows) {
    const li = document.createElement("li");
    li.textContent =
      new Date(row.date).toLocaleString() +
      " · " +
      row.technology +
      " · " +
      row.difficulty +
      " · " +
      row.language +
      " · Pace: " +
      (Number.isFinite(row.pace) ? row.pace + " wpm" : "unavailable") +
      " · Pauses: " +
      (row.pauses ?? "unavailable") +
      " · Fillers: " +
      (row.fillers ?? "unavailable") +
      " · Volume range: " +
      (Number.isFinite(row.volumeVariation) ? row.volumeVariation + " dB" : "unavailable") +
      " · Confidence: " +
      (row.confidence ? row.confidence + "/5" : "not rated");
    list.append(li);
  }
  area.append(list);
}
export function initDelivery() {
  $("confidence-rating").onchange = () => {
    if (state.current) renderCoaching();
  };
  $("save-attempt").onclick = () => {
    if (
      !state.current ||
      state.busy ||
      state.recording ||
      !(state.answerExpired || state.answerSubmitted)
    )
      return;
    const rating = Number($("confidence-rating").value);
    const row = {
      id: state.attemptId,
      date: state.attemptDate,
      technology: state.current.technology,
      difficulty: state.current.difficulty,
      language: state.current.language,
      confidence: rating >= 1 && rating <= 5 ? rating : null,
      pace: state.deliveryAudio?.words_per_minute ?? null,
      pauses: state.deliveryAudio?.pause_count ?? null,
      longestPause: state.deliveryAudio?.longest_pause_seconds ?? null,
      volumeVariation: state.deliveryAudio?.levels?.variation_db ?? null,
      volumeMethod: state.deliveryAudio?.levels?.method ?? null,
      fillers: state.deliveryAudio?.fillers?.count ?? null,
      head: poseSummary(),
      expressions: summarizeExpressions(),
    };
    try {
      const rows = readAttempts();
      const exists = rows.some((r) => r.id === state.attemptId);
      const updated = exists
        ? rows.map((r) => (r.id === state.attemptId ? row : r))
        : [row, ...rows];
      localStorage.setItem(accountKey(HISTORY_KEY), JSON.stringify(updated.slice(0, 20)));
      $("save-status").textContent = exists ? "Saved summary updated." : "Attempt summary saved.";
      renderHistory();
      renderCoaching();
    } catch {
      $("save-status").textContent =
        "Could not save in this browser. Your current report is still available.";
    }
  };
  $("clear-history").onclick = () => {
    try {
      localStorage.removeItem(accountKey(HISTORY_KEY));
      renderHistory();
      if (state.current) renderCoaching();
      $("history-status").textContent = "Saved summaries cleared.";
    } catch {
      $("history-status").textContent = "Could not clear saved summaries.";
    }
  };
}
