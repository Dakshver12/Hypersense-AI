import { readPresets, savePreset, validatePreset, renderPresets } from "./presets.js";
import { sessionStore, sessionDB, storedSession } from './storage.js';
import { readSavedQuestions, saveQuestion, questionBookmark } from './saved-questions.js';
import { renderDashboard } from './dashboard.js';
import { renderSavedSessions } from './history.js';
import { state } from './state.js';
import { refresh } from './ui.js';
import { $ } from './dom.js';

const MAX_BYTES = 100 * 1024 * 1024;
const object = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const require = (ok, message) => { if (!ok) throw Error(message); };
const idle = () => !state.busy && !state.recording && !state.interviewSession?.active;
let working = false;

function readBlob(blob, method) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(Error('Could not read the backup or recording.'));
    reader[method](blob);
  });
}
function safeTree(value, depth = 0) {
  require(depth < 25, 'Backup nesting is too deep.');
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    require(!['__proto__', 'prototype', 'constructor'].includes(key), 'Invalid backup field.');
    safeTree(child, depth + 1);
  }
}
export function parseBackup(text) {
  require(typeof text === 'string' && text.length <= MAX_BYTES, 'Backup exceeds the 100 MB limit.');
  const data = JSON.parse(text);
  safeTree(data);
  require(data?.format === 'hypersense-backup' && data.version === 1, 'Choose a HyperSense backup version 1 file.');
  require(Array.isArray(data.sessions) && data.sessions.length <= 1000, 'Invalid session list (maximum 1,000).');
  require(Array.isArray(data.savedQuestions) && data.savedQuestions.length <= 100, 'Invalid saved questions.');
  require(data.savedSetups === undefined || (Array.isArray(data.savedSetups) && data.savedSetups.length <= 20), "Invalid saved setups.");
  data.savedSetups = (data.savedSetups || []).map(validatePreset);
  const ids = new Set();
  for (const session of data.sessions) {
    require(object(session) && typeof session.id === 'string' && session.id.length > 0 && session.id.length <= 200 && !ids.has(session.id), 'Invalid or duplicate session ID.');
    ids.add(session.id);
    require(typeof session.date === 'string' && Number.isFinite(Date.parse(session.date)), 'Invalid session date.');
    require(object(session.settings) && Array.isArray(session.answers) && session.answers.length <= 100, 'Invalid session contents.');
    require(Number.isInteger(session.total) && session.total >= session.answers.length && session.total <= 100, 'Invalid question count.');
    for (const value of Object.values(session.settings)) require(value === null || ['string','number','boolean'].includes(typeof value), 'Invalid session settings.');
    delete session.settings.resume_text;
    for (const answer of session.answers) {
      require(object(answer) && typeof answer.question === 'string' && typeof answer.answer === 'string', 'Invalid question or transcript.');
      require(answer.score == null || (Number.isFinite(answer.score) && answer.score >= 0 && answer.score <= 100), 'Invalid answer score.');
      if (answer.assessment?.strengths) require(Array.isArray(answer.assessment.strengths) && answer.assessment.strengths.every(object), 'Invalid assessment.');
      if (answer.recording) {
        const rec = answer.recording;
        require(object(rec) && typeof rec.base64 === 'string' && rec.base64.length % 4 === 0 && /^[A-Za-z0-9+/]*={0,2}$/.test(rec.base64), 'Invalid recording data.');
        require(typeof rec.type === 'string' && /^(audio\/[a-z0-9.+-]+|video\/webm)(;.*)?$/i.test(rec.type), 'Invalid recording format.');
        const binary = atob(rec.base64);
        const bytes = Uint8Array.from(binary, c => c.charCodeAt(0));
        answer.recording = {blob: new Blob([bytes], {type: rec.type}), name: typeof rec.name === 'string' ? rec.name.slice(0,200) : 'answer.webm', bytes: bytes.length};
      }
    }
  }
  data.savedQuestions = data.savedQuestions.map(item => {
    require(object(item) && typeof item.question === 'string' && item.question.trim(), 'Invalid saved question.');
    return questionBookmark({settings:item}, item);
  });
  data.sessions = data.sessions.map(storedSession);
  return data;
}
export async function buildBackup() {
  const sessions = await sessionStore('readonly', store => store.getAll());
  const savedQuestions = readSavedQuestions();
  const savedSetups = readPresets();
  require(sessions.length <= 1000, 'This backup supports up to 1,000 sessions.');
  let estimatedBytes = 0;
  const records = [];
  for (const original of sessions) {
    const session = storedSession(original);
    for (const answer of session.answers) {
      if (!answer.recording) continue;
      const rec = answer.recording;
      require(rec.blob instanceof Blob, 'A saved recording is unavailable. Backup was not created.');
      estimatedBytes += Math.ceil(rec.blob.size / 3) * 4;
      require(estimatedBytes <= MAX_BYTES, 'Recordings exceed the 100 MB backup limit.');
      const data = await readBlob(rec.blob, 'readAsDataURL');
      answer.recording = {name: rec.name, type: rec.blob.type || 'audio/webm', base64: data.slice(data.indexOf(',') + 1)};
    }
    records.push(session);
  }
  const text = JSON.stringify({format:'hypersense-backup',version:1,createdAt:new Date().toISOString(),sessions:records,savedQuestions,savedSetups});
  require(new Blob([text]).size <= MAX_BYTES, 'Backup exceeds the 100 MB limit.');
  return text;
}
// Add all missing sessions in one transaction. Existing IDs are never overwritten.
export async function restoreBackup(data) {
  const db = await sessionDB();
  const counts = await new Promise((resolve, reject) => {
    const tx = db.transaction('sessions','readwrite');
    const store = tx.objectStore('sessions');
    let added = 0, skipped = 0;
    for (const session of data.sessions) {
      const req = store.get(session.id);
      req.onsuccess = () => { if (req.result) skipped++; else { store.add(session); added++; } };
    }
    tx.oncomplete = () => {db.close();resolve({added,skipped});};
    tx.onabort = tx.onerror = () => {db.close();reject(Error('Sessions could not be restored. No sessions were added. Browser storage may be full.'));};
  });
  let questionsAdded = 0, questionsSkipped = 0, questionError = '';
  try {
    for (const item of data.savedQuestions) {
      if (saveQuestion(item)) questionsAdded++; else questionsSkipped++;
    }
  } catch (error) { questionError = error.message; }
  let setupsAdded = 0, setupsSkipped = 0, setupError = '';
  try {for(const item of data.savedSetups || []) {if(savePreset(item))setupsAdded++;else setupsSkipped++;}}
  catch(error) {setupError=error.message;}
  return {...counts, questionsAdded, questionsSkipped, questionError, setupsAdded, setupsSkipped, setupError};
}
export function initBackup() {
  const exportButton = $('backup-export'), importButton = $('backup-import'), fileInput = $('backup-file'), status = $('backup-status');
  if (!exportButton) return;
  async function perform(action) {
    if (working || !idle()) {status.textContent = 'Finish the current interview or operation first.';return;}
    working = true; state.busy = true; refresh(); exportButton.disabled = importButton.disabled = fileInput.disabled = true;
    try {await action();} catch(error) {status.textContent = error.message;}
    finally {working = false;state.busy = false;refresh();exportButton.disabled = importButton.disabled = fileInput.disabled = false;}
  }
  exportButton.onclick = () => perform(async () => {
    status.textContent = 'Preparing backup, including recordings…';
    const text = await buildBackup();
    const url = URL.createObjectURL(new Blob([text],{type:'application/json'}));
    const link = document.createElement('a');link.href=url;link.download=`hypersense-backup-${new Date().toISOString().slice(0,10)}.json`;
    document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);
    status.textContent = 'Backup download requested. Keep this file private: it contains transcripts and recordings.';
  });
  importButton.onclick = () => perform(async () => {
    const file = fileInput.files?.[0];
    require(file, 'Choose a backup file first.');
    require(file.size <= MAX_BYTES, 'Backup exceeds the 100 MB limit.');
    status.textContent = 'Checking backup…';
    const data = parseBackup(await readBlob(file,'readAsText'));
    if (!window.confirm(`Restore ${data.sessions.length} sessions and ${data.savedQuestions.length} saved questions and ${data.savedSetups.length} setups? Existing sessions will be kept. Duplicate session IDs will be skipped.`)) {status.textContent='Restore cancelled.';return;}
    status.textContent = 'Restoring backup… Keep this page open.';
    const result = await restoreBackup(data);
    status.textContent = `Restored ${result.added} sessions; skipped ${result.skipped} existing sessions. Added ${result.questionsAdded} saved questions; skipped ${result.questionsSkipped} duplicates.` + (result.questionError ? ` Sessions are saved, but some questions were not restored: ${result.questionError} You can retry this backup.` : '');
    status.textContent += ` Added ${result.setupsAdded} setups; skipped ${result.setupsSkipped} existing names.` + (result.setupError ? ` Some setups could not be restored: ${result.setupError}` : '');
    try {renderPresets();} catch {}
    fileInput.value = '';
    await renderSavedSessions();await renderDashboard();
  });
}
