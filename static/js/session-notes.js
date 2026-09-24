import { state } from './state.js';
import { saveFinishedSession } from './storage.js';
import { refresh } from './ui.js';

// Keep unfinished edits across in-app navigation, scoped to each session.
const drafts = new Map();
export function discardSessionNotes(id) { drafts.delete(id); }
export function renderSessionNotes(parent, session) {
  const box = document.createElement('section');
  box.className = 'session-notes';
  const title = document.createElement('h3');
  title.textContent = 'Your practice notes';
  const hint = document.createElement('p');
  hint.textContent = 'What did you learn? What will you practise next? Notes are saved in this browser and included in report exports and backups. They are not sent to the evaluator.';
  const label = document.createElement('label');
  label.htmlFor = 'session-notes-input';
  label.textContent = 'Personal reflection (optional, up to 2,000 characters)';
  const input = document.createElement('textarea');
  input.id = label.htmlFor;
  input.rows = 4;
  input.maxLength = 2000;
  input.value = drafts.get(session.id) ?? session.notes ?? '';
  const status = document.createElement('p');
  status.id = 'session-notes-status';
  status.setAttribute('role','status');
  input.setAttribute('aria-describedby',status.id);
  const save = document.createElement('button');
  save.id = 'save-session-notes';
  save.type = 'button';
  save.textContent = 'Save notes';
  const setStatus = () => { status.textContent = `${input.value.length}/2,000 characters. ${drafts.has(session.id) ? 'Unsaved changes — click Save notes.' : 'Edit your notes and click Save notes.'}`; };
  input.addEventListener('input', () => {
    if (input.value === (session.notes || '')) drafts.delete(session.id);
    else drafts.set(session.id,input.value);
    setStatus();
  });
  save.onclick = async () => {
    if (state.busy || state.recording || state.interviewSession !== session || session.active) return;
    if (input.value.length > 2000) { status.textContent = 'Keep notes within 2,000 characters.'; return; }
    const value = input.value;
    drafts.set(session.id,value);
    session.notes = value;
    state.busy = true;
    refresh();
    input.disabled = save.disabled = true;
    status.textContent = 'Saving notes…';
    try {
      const saved = await saveFinishedSession(session);
      if (saved) {
        drafts.delete(session.id);
        status.textContent = value ? 'Notes saved in this browser.' : 'Notes cleared and saved.';
      } else status.textContent = 'Notes could not be saved. Your edit is retained in this tab. Retry Save notes before closing.';
    } catch {
      status.textContent = 'Notes could not be saved. Retry Save notes before closing.';
    } finally {
      state.busy = false;
      input.disabled = save.disabled = false;
      refresh();
    }
  };
  setStatus();
  box.append(title,hint,label,input,save,status);
  parent.appendChild(box);
}
window.addEventListener('beforeunload', event => {
  if (drafts.size) { event.preventDefault(); event.returnValue = ''; }
});
