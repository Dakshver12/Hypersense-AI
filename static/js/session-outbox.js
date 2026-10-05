import { accountId, accountKey } from './account-context.js';
import { putAccountSession, encodeAccountSession, getRecordingConfig } from './account-store.js';

// A committed IndexedDB transaction survives page navigation and reloads.
// Uploads still require an open, signed-in page; returning resumes the queue.
export async function outboxStore(mode, operation) {
  if (!accountId) throw Error('Sign in before syncing account sessions.');
  const db = await new Promise((resolve, reject) => {
    const request = indexedDB.open(accountKey('hypersense-session-outbox'), 1);
    request.onupgradeneeded = () => request.result.createObjectStore('pending', {keyPath:'id'});
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(Error('Close other HyperSense tabs and retry.'));
  });
  return new Promise((resolve, reject) => {
    const tx = db.transaction('pending', mode);
    let request;
    try { request = operation(tx.objectStore('pending')); }
    catch (error) { tx.abort(); db.close(); reject(error); return; }
    tx.oncomplete = () => { db.close(); resolve(request?.result); };
    tx.onerror = tx.onabort = () => { db.close(); reject(tx.error || Error('Local session queue could not be saved.')); };
  });
}

export async function queueFinishedSession(record) {
  const entry = {id:record.id, revision:crypto.randomUUID(), record};
  await outboxStore('readwrite', store => store.put(entry));
  return entry;
}

async function updateEntry(entry, remove=false) {
  await outboxStore('readwrite', store => {
    const request = store.get(entry.id);
    request.onsuccess = () => {
      // A newer edit must never be cleared or overwritten by an older upload.
      if (request.result?.revision === entry.revision) {
        if (remove) store.delete(entry.id);
        else store.put(entry);
      }
    };
    return request;
  });
}

function withOutboxLock(operation) {
  const locks = globalThis.navigator?.locks;
  return locks ? locks.request(accountKey('hypersense-session-sync'), operation) : operation();
}

let flushing = null;
export function flushSessionOutbox() {
  if (!accountId) return Promise.resolve([]);
  if (flushing) return flushing;
  flushing = withOutboxLock(async () => {
    const saved = [];
    while (true) {
      const entries = await outboxStore('readonly', store => store.getAll());
      if (!entries.length) return saved;
      for (const entry of entries) {
        try {
          if (entry.record.answers.some(answer => answer.recording && !answer.recording.object_id)) {
            const config = await getRecordingConfig();
            if (config.enabled) {
              entry.record = await encodeAccountSession(entry.record, true);
              await updateEntry(entry);
            }
          }
          await putAccountSession(entry.record);
        } catch (error) {
          // Completed audio references are retained even if the final PUT fails.
          await updateEntry(entry);
          throw error;
        }
        await updateEntry(entry, true);
        saved.push(entry.id);
      }
    }
  }).finally(() => { flushing = null; });
  return flushing;
}

export async function discardQueuedSession(id) {
  // Wait for an already-started PUT before the caller deletes the cloud record.
  if (flushing) await flushing.catch(() => {});
  await withOutboxLock(() => outboxStore('readwrite', store => store.delete(id)));
}
