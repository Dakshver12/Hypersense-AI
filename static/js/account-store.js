import { accountHeaders } from './account-context.js';

export async function accountRequest(path, options={}) {
  const response=await fetch(path,{...options,credentials:'same-origin',cache:'no-store',headers:{...accountHeaders(),...options.headers}});
  const data=await response.json();
  if(!response.ok) {
    const error=Error(typeof data.detail==='string' ? data.detail : 'Account request failed.');
    error.status=response.status;throw error;
  }
  return data;
}

export async function encodeAccountSession(record) {
  const result={...record,answers:[]};
  for(const answer of record.answers) {
    const saved={...answer,recording:null};
    if(answer.recording) {
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
    const {base64,type,name}=answer.recording;
    const raw=atob(base64),bytes=new Uint8Array(raw.length);
    for(let i=0;i<raw.length;i++) bytes[i]=raw.charCodeAt(i);
    const blob=new Blob([bytes],{type:type||'application/octet-stream'});
    return {...answer,recording:{blob,name,bytes:blob.size}};
  })};
}

export async function putAccountSession(record, onlyNew=false) {
  const payload=JSON.stringify(await encodeAccountSession(record));
  if(new Blob([payload]).size>24*1024*1024) throw Error('This session exceeds the 24 MB account limit. Download the session ZIP before leaving.');
  await accountRequest('/api/account/sessions/'+encodeURIComponent(record.id),{method:'PUT',headers:{'Content-Type':'application/json',...(onlyNew?{'If-None-Match':'*'}:{})},body:payload});
  return record.id;
}

export const remoteSessionStore={
  async getAll(){return (await accountRequest('/api/account/sessions')).map(decodeAccountSession);},
  async get(id){try{return decodeAccountSession(await accountRequest('/api/account/sessions/'+encodeURIComponent(id)));}catch(error){if(error.status===404)return undefined;throw error;}},
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
