import { discardSessionNotes } from "./session-notes.js";
import { clearSessionDraft } from "./recovery.js";
import { state } from "./state.js";
import { $ } from "./dom.js";
import { cancelQuestionSpeech } from "./speech.js";
import { releaseSessionRecordings } from "./sessions.js";
import { finishInterviewSession } from "./results.js";
import { clearAudio } from "./recording.js";
import { run } from "./api.js";
import { renderDashboard } from "./dashboard.js";
import { renderSavedSessions } from "./history.js";

export function sessionDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("hypersense-interviews", 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore("sessions", { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(Error("Close other HyperSense tabs and retry."));
  });
}

export async function sessionStore(mode, operation) {
  const db = await sessionDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("sessions", mode);
    let request;
    try {
      request = operation(tx.objectStore("sessions"));
    } catch (error) {
      db.close();
      reject(error);
      return;
    }
    tx.oncomplete = () => {
      db.close();
      resolve(request.result);
    };
    tx.onabort = tx.onerror = () => {
      db.close();
      reject(tx.error || Error("Session storage failed."));
    };
  });
}

export function storedSession(session) {
  const { resume_text, ...savedSettings } = session.settings;
  return {
    id: session.id,
    notes: typeof session.notes === "string" ? session.notes.slice(0, 2000) : "",
    date: session.date,
    total: session.total,
    settings: savedSettings,
    source: session.source,
    active: false,
    loaded: false,
    answers: session.answers.map((answer) => ({
      ...answer,
      recording: answer.recording
        ? {
            blob: answer.recording.blob,
            name: answer.recording.name,
            bytes: answer.recording.bytes,
          }
        : null,
    })),
  };
}

export async function saveFinishedSession(session) {
  const record = storedSession(session);
  state.sessionSavePending = record;
  $("retry-session-save").hidden = true;
  $("session-storage-status").textContent =
    "Saving session and recordings… Please keep this page open.";
  try {
    await sessionStore("readwrite", (store) => store.put(record));
    if (state.sessionSavePending === record) {
      state.sessionSavePending = null;
      $("session-storage-status").textContent = "Session and recordings saved in this browser.";
    }
    await clearSessionDraft(record.id).catch(() => {});
    await renderSavedSessions();
    return true;
  } catch {
    $("session-storage-status").textContent =
      "Could not save this session. Browser storage may be full or unavailable. Download recordings before leaving, or retry saving.";
    $("retry-session-save").hidden = false;
    return false;
  }
}

export async function openSavedSession(id) {
  if (state.busy || state.recording || state.interviewSession?.active) return;
  await run(async () => {
    const saved = await sessionStore("readonly", (store) => store.get(id));
    if (!saved) throw Error("This session is no longer saved.");
    cancelQuestionSpeech(false);
    clearInterval(state.ticker);
    state.ticker = null;
    releaseSessionRecordings();
    clearAudio();
    state.interviewSession = {
      ...saved,
      answers: saved.answers.map((answer) => ({
        ...answer,
        recording: answer.recording
          ? { ...answer.recording, url: URL.createObjectURL(answer.recording.blob) }
          : null,
      })),
    };
    $("result").hidden = true;
    $("delivery-report").hidden = true;
    finishInterviewSession(true);
  });
}

export async function deleteSavedSession(id) {
  if (state.busy || state.recording || state.interviewSession?.active) return;
  if (!window.confirm("Delete this saved session, including its answers and recordings?")) return;
  await run(async () => {
    await sessionStore("readwrite", (store) => store.delete(id));
    discardSessionNotes(id);
    if (state.interviewSession?.id === id) {
      releaseSessionRecordings();
      state.interviewSession = null;
      $("session-report").hidden = true;
    }
    if (state.sessionSavePending?.id === id) {
      state.sessionSavePending = null;
      $("retry-session-save").hidden = true;
    }
    $("session-storage-status").textContent = "Saved session deleted.";
    await renderSavedSessions();
    await renderDashboard();
  });
}
export function initStorage() {
  $("retry-session-save").onclick = () => {
    if (
      state.sessionSavePending &&
      !state.busy &&
      !state.recording &&
      !state.interviewSession?.active
    )
      saveFinishedSession(state.sessionSavePending);
  };
}
