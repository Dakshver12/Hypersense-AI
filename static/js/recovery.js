import { state } from "./state.js";
import { $ } from "./dom.js";
import { storedSession, sessionStore } from "./storage.js";
import { releaseSessionRecordings } from "./sessions.js";
import { showCameraCheck } from "./navigation.js";
import { finishInterviewSession } from "./results.js";
import { run } from "./api.js";

// Separate database keeps unfinished work out of completed-session reports.
export async function draftStore(mode, operation) {
  const db = await new Promise((resolve, reject) => {
    const request = indexedDB.open("hypersense-recovery", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("drafts");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(Error("Close other HyperSense tabs and retry."));
  });
  return new Promise((resolve, reject) => {
    const tx = db.transaction("drafts", mode);
    const request = operation(tx.objectStore("drafts"));
    tx.oncomplete = () => { db.close(); resolve(request.result); };
    tx.onerror = tx.onabort = () => { db.close(); reject(tx.error || Error("Draft storage failed.")); };
  });
}

export async function checkpointSession() {
  const session = state.interviewSession;
  if (!session?.active) return;
  const { resume_text, ...current } = state.current || {};
  const draft = { ...storedSession(session), active: true,
    questions: session.questions, duration: $("duration").value,
    pendingQuestion: session.loaded ? current : null,
    savedAt: new Date().toISOString() };
  try {
    await draftStore("readwrite", s => s.put(draft, "active"));
    $("checkpoint-status").textContent = `${draft.answers.length} processed question(s) saved on this browser. The unfinished answer is not saved.`;
  } catch {
    $("checkpoint-status").textContent = "Progress could not be saved. Keep this tab open and retry before continuing.";
    throw Error("Could not save progress. Browser storage may be full or unavailable. Use Load / retry next question to retry.");
  }
}

export async function clearSessionDraft(id) {
  // One transaction prevents a completion from clearing a different session.
  await draftStore("readwrite", store => {
    const request = store.get("active");
    request.onsuccess = () => { if (request.result?.id === id) store.delete("active"); };
    return request;
  });
  $("session-recovery").hidden = true;
}

export async function offerSessionRecovery() {
  try {
    const draft = await draftStore("readonly", s => s.get("active"));
    if (!draft || state.interviewSession?.active) return;
    const finished = await sessionStore("readonly", s => s.get(draft.id));
    if (finished) { await clearSessionDraft(draft.id); return; }
    $("recovery-description").textContent = `${draft.answers.length} of ${draft.total} questions processed. Resume at question ${Math.min(draft.answers.length + 1, draft.total)}. The unfinished answer restarts with a fresh timer. Camera permission and calibration are required again. Résumé text is not retained.`;
    $("session-recovery").hidden = false;
  } catch {
    $("checkpoint-status").textContent = "Session recovery is unavailable in this browser.";
  }
}

export async function resumeSessionDraft() {
  if (state.interviewSession?.active) return;
  const draft = await draftStore("readonly", s => s.get("active"));
  if (!draft) throw Error("No unfinished session is saved.");
  if (await sessionStore("readonly", s => s.get(draft.id))) {
    await clearSessionDraft(draft.id);
    throw Error("This session is already completed. Open it from the dashboard.");
  }
  if (draft.answers.length < draft.total && !$("recovery-consent").checked)
    throw Error("Check the camera consent box to resume.");
  releaseSessionRecordings();
  state.current = null;
  state.interviewSession = { ...draft, loaded: false,
    settings: { ...draft.settings, resume_text: "" },
    answers: draft.answers.map(a => ({ ...a, recording: a.recording ?
      { ...a.recording, url: URL.createObjectURL(a.recording.blob) } : null })) };
  $("duration").value = draft.duration;
  $("auto-flow").value = draft.settings.auto_flow ? "auto" : "manual";
  $("session-recovery").hidden = true;
  if (draft.answers.length >= draft.total) { finishInterviewSession(); return; }
  $("camera-consent").checked = true;
  showCameraCheck();
}

export function initRecovery() {
  $("resume-session").onclick = () => run(resumeSessionDraft);
  $("discard-session").onclick = () => run(async () => {
    if (state.interviewSession?.active) return;
    if (!window.confirm("Discard the unfinished session and its saved answers and recordings?")) return;
    const draft = await draftStore("readonly", s => s.get("active"));
    if (draft) await clearSessionDraft(draft.id);
  });
  offerSessionRecovery();
}
