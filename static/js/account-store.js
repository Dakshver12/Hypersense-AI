import { accountHeaders } from './account-context.js';

async function fetchAccountRequest(path, options={}) {
  const response=await fetch(path,{...options,credentials:'same-origin',cache:'no-store',headers:{...accountHeaders(),...options.headers}});
  const data=await response.json();
  if(!response.ok) {
    const error=Error(typeof data.detail==='string' ? data.detail : 'Account request failed.');
    error.status=response.status;throw error;
  }
  return data;
}

// Share only overlapping default GETs. Never cache completed responses or writes.
const pendingAccountReads = new Map();
export async function accountRequest(path, options={}) {
  if (Object.keys(options).length) return fetchAccountRequest(path, options);
  const key=JSON.stringify([path, accountHeaders()]);
  let pending=pendingAccountReads.get(key);
  if(!pending){
    pending=fetchAccountRequest(path, options);
    pendingAccountReads.set(key,pending);
  }
  try {return structuredClone(await pending);}
  finally {if(pendingAccountReads.get(key)===pending)pendingAccountReads.delete(key);}
}

// Configuration is not an authorization decision; each write is checked by the server.
let recordingConfig;
let recordingConfigAt = 0;
export async function getRecordingConfig() {
  if (!recordingConfig || Date.now() - recordingConfigAt > 30000) {
    recordingConfig = await accountRequest('/api/account/recordings/config');
    recordingConfigAt = Date.now();
  }
  return recordingConfig;
}

export function uploadedRecordingReference(sessionId, blob) {
  const key = JSON.stringify([sessionId, accountHeaders()]);
  const entry = uploadedRecordings.get(blob)?.get(key);
  return entry?.recording ? {...entry.recording} : null;
}

// Keep successful uploads across session-save retries without retaining blobs forever.
const uploadedRecordings = new WeakMap();
export async function uploadRecording(sessionId, rec) {
  const {blob,name}=rec;
  if(!(blob instanceof Blob) || !blob.size) throw Error('The recording is unavailable. Keep this page open and retry.');
  if(blob.size>10*1024*1024) throw Error('Each recording must be 10 MB or smaller.');
  let entries=uploadedRecordings.get(blob);
  if(!entries){entries=new Map();uploadedRecordings.set(blob,entries);}
  const key=JSON.stringify([sessionId,accountHeaders()]);
  let entry=entries.get(key);
  if(!entry || Date.now()-entry.at>3600000){
    entry={at:Date.now(),promise:(async()=>{
      const type=blob.type.split(';')[0].trim().toLowerCase() || 'application/octet-stream';
      const upload=await accountRequest('/api/account/recordings/uploads',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({session_id:sessionId,name:name||'answer.webm',type,bytes:blob.size})});
      const response=await fetch(upload.upload_url,{method:'PUT',credentials:'omit',referrerPolicy:'no-referrer',headers:{'Content-Type':type,'x-upsert':'false'},body:blob});
      if(!response.ok) throw Error('Recording upload failed. Keep this page open and retry saving.');
      return accountRequest('/api/account/recordings/'+upload.object_id+'/complete',{method:'POST'});
    })()};
    entries.set(key,entry);
  }
  try {
    entry.recording = await entry.promise;
    return {...entry.recording};
  }
  catch(error){if(entries.get(key)===entry)entries.delete(key);throw error;}
}

export async function encodeAccountSession(record, cloud=false) {
  const result={...record,answers:[]};
  for(const answer of record.answers) {
    const saved={...answer,recording:null};
    if(answer.recording) {
      if(answer.recording.object_id){
        const {object_id,name,type,bytes}=answer.recording;
        saved.recording={object_id,name,type,bytes};
        result.answers.push(saved);continue;
      }
      if(cloud){
        saved.recording=await uploadRecording(record.id,answer.recording);
        result.answers.push(saved);continue;
      }
      const {blob,name}=answer.recording;
      if(!(blob instanceof Blob)||!blob.size) throw Error('A recording is unavailable. Export your remaining recordings before leaving.');
      const data=await new Promise((resolve,reject)=>{
        const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(Error('Recording could not be read.'));reader.readAsDataURL(blob);
      });
      saved.recording={name,bytes:blob.size,type:blob.type,base64:data.slice(data.indexOf(',')+1)};
    }
    result.answers.push(saved);
  }
  return result;
}

export function decodeAccountSession(record) {
  return {...record,answers:record.answers.map(answer=>{
    if(!answer.recording) return answer;
    if(answer.recording.object_id) return {...answer,recording:{...answer.recording}};
    const {base64,type,name}=answer.recording;
    const raw=atob(base64),bytes=new Uint8Array(raw.length);
    for(let i=0;i<raw.length;i++) bytes[i]=raw.charCodeAt(i);
    const blob=new Blob([bytes],{type:type||'application/octet-stream'});
    return {...answer,recording:{blob,name,bytes:blob.size}};
  })};
}

export async function putAccountSession(record, onlyNew=false) {
  // Fail closed when cloud configuration is broken; never silently store large audio in JSON.
  const hasNewAudio=record.answers.some(a=>a.recording && !a.recording.object_id);
  const config=hasNewAudio ? await getRecordingConfig() : {enabled:false};
  if(onlyNew){
    try {
      await accountRequest('/api/account/sessions/'+encodeURIComponent(record.id));
      const error=Error('This session already exists.');error.status=409;throw error;
    }catch(error){if(error.status!==404)throw error;}
  }
  const payload=JSON.stringify(await encodeAccountSession(record,config.enabled));
  if(config.enabled && new Blob([payload]).size>1024*1024) throw Error('Session text exceeds the 1 MB cloud document limit.');
  if(new Blob([payload]).size>24*1024*1024) throw Error('This session exceeds the 24 MB account limit. Download the session ZIP before leaving.');
  await accountRequest('/api/account/sessions/'+encodeURIComponent(record.id),{method:'PUT',headers:{'Content-Type':'application/json',...(onlyNew?{'If-None-Match':'*'}:{})},body:payload});
  return record.id;
}

export async function hydrateAccountSession(record) {
  const decoded=decodeAccountSession(record);
  for(const answer of decoded.answers){
    const rec=answer.recording;
    if(!rec?.object_id || rec.blob instanceof Blob)continue;
    const {url}=await accountRequest('/api/account/recordings/'+encodeURIComponent(rec.object_id)+'/playback');
    const response=await fetch(url,{credentials:'omit',cache:'no-store',referrerPolicy:'no-referrer'});
    if(!response.ok)throw Error('A saved recording could not be loaded. Reopen the report to retry.');
    const blob=await response.blob();
    if(blob.size!==rec.bytes || blob.size>10*1024*1024)throw Error('A saved recording failed its size check.');
    rec.blob=new Blob([blob],{type:rec.type || blob.type});
  }
  return decoded;
}

export const remoteSessionStore={
  async getAll(){return (await accountRequest('/api/account/sessions')).map(decodeAccountSession);},
  async get(id){
    let record;
    try{record=await accountRequest('/api/account/sessions/'+encodeURIComponent(id));}
    catch(error){if(error.status===404)return undefined;throw error;}
    return hydrateAccountSession(record);
  },
  put:putAccountSession,
  async delete(id){await accountRequest('/api/account/sessions/'+encodeURIComponent(id),{method:'DELETE'});}
};

export async function restoreAccountSessions(records) {
  let added=0,skipped=0;
  for(const record of records) {
    try {await putAccountSession(record,true);added++;}
    catch(error) {
      if(error.status===409 && error.message==='This session already exists.') {skipped++;continue;}
      throw Error(`${added} sessions imported, ${skipped} already existed. Import stopped: ${error.message} You can retry; existing sessions will be kept.`);
    }
  }
  return {added,skipped};
}


export async function transcribeStoredRecording(sessionId, rec, language, onProgress=()=>{}) {
  onProgress('Uploading your recording securely…');
  const recording = await uploadRecording(sessionId, rec);
  onProgress('Recording uploaded. Transcribing your answer…');
  return accountRequest('/api/account/recordings/' + recording.object_id + '/transcribe', {
    method:'POST', headers:{'Content-Type':'application/json'},
    body:JSON.stringify({spoken_language:language})
  });
}
