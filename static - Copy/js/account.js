import { refresh } from "./ui.js";
import { renderSavedSessions } from "./history.js";
import { accountId, accountHeaders } from './account-context.js';
import { accountRequest, restoreAccountSessions } from './account-store.js';
import { state } from './state.js';
import { stopCamera } from './camera.js';
import { stopMicrophoneCheck } from './microphone-check.js';
import { cancelAutomation } from './automation.js';
import { cancelQuestionSpeech } from './speech.js';
import { renderDashboard } from './dashboard.js';

export function initAccount() {
  if(!accountId) return;
  const menu=document.getElementById('account-menu'),name=document.getElementById('account-name');
  const status=document.getElementById('account-status');
  menu.hidden=false;
  accountRequest('/auth/me').then(user=>{name.textContent=user.name;name.title=user.email;}).catch(error=>{status.textContent=error.message;});
  document.getElementById('account-logout').onclick=async()=>{
    if(state.busy||state.recording||state.interviewSession?.active||state.sessionSavePending){status.textContent='Finish your interview and save or export your answers before signing out.';return;}
    const button=document.getElementById('account-logout');button.disabled=true;
    try {
      await accountRequest('/auth/logout',{method:'POST',headers:accountHeaders()});
      cancelAutomation();cancelQuestionSpeech(false);stopCamera();stopMicrophoneCheck();
      location.replace('/login');
    }catch(error){status.textContent=error.message;button.disabled=false;}
  };
  document.getElementById('account-import').onclick=async()=>{
    if(state.busy||state.recording||state.interviewSession?.active){status.textContent='Finish the current operation before importing.';return;}
    if(!confirm('Import the interviews previously saved in this browser into your signed-in account? Only continue if these are your interviews. Existing account sessions are kept.'))return;
    const button=document.getElementById('account-import');button.disabled=true;state.busy=true;refresh();
    try {
      status.textContent='Importing browser sessions… Keep this page open.';
      const db=await new Promise((resolve,reject)=>{
        const request=indexedDB.open('hypersense-interviews',1);
        request.onupgradeneeded=()=>request.result.createObjectStore('sessions',{keyPath:'id'});
        request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);
      });
      const records=await new Promise((resolve,reject)=>{
        const tx=db.transaction('sessions','readonly'),request=tx.objectStore('sessions').getAll();
        tx.oncomplete=()=>{db.close();resolve(request.result);};tx.onerror=()=>{db.close();reject(tx.error);};
      });
      const counts=await restoreAccountSessions(records);
      status.textContent=`Imported ${counts.added} sessions; ${counts.skipped} already existed. Original browser data was kept.`;
      await renderSavedSessions();await renderDashboard();
    }catch(error){status.textContent=error.message;}
    finally{button.disabled=false;state.busy=false;refresh();}
  };
  // Recheck when returning to an old tab after logout/account switch elsewhere.
  document.addEventListener('visibilitychange',()=>{
    if(document.visibilityState==='visible')accountRequest('/auth/me').catch(error=>{status.textContent=error.message;});
  });
}
