const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const {JSDOM}=require('jsdom');
const {IDBFactory}=require('fake-indexeddb');
const esbuild=require('esbuild');
const root=path.resolve(__dirname,'..');
let shell=fs.readFileSync(path.join(root,'templates/index.html'),'utf8');
for(const name of ['setup','interview','dashboard','camera-check','results']) shell=shell.replace('<!-- include:'+name+' -->',fs.readFileSync(path.join(root,'templates/screens',name+'.html'),'utf8'));
shell=shell.replace('<!-- account-meta -->','<meta name="hypersense-account" content="queue-user">').replace(/<script type="module"[\s\S]*?<\/script>/,'');
const code=esbuild.buildSync({stdin:{contents:`import {saveFinishedSession,initStorage} from './storage.js';import {outboxStore} from './session-outbox.js';import {state} from './state.js';Object.assign(window,{saveFinishedSession,initStorage,outboxStore,state});`,resolveDir:path.join(root,'static/js')},bundle:true,write:false,format:'iife'}).outputFiles[0].text;
const db=new IDBFactory();
let release, pendingPut=new Promise(resolve=>{release=resolve;});
let fail=true;
const waitFor=async fn=>{for(let i=0;i<100;i++){if(await fn())return;await new Promise(r=>setTimeout(r,5));}throw Error('Condition timed out');};
function browser(){
 const dom=new JSDOM(shell,{url:'https://app.test/results',runScripts:'outside-only'}),w=dom.window;
 w.indexedDB=db;w.structuredClone=structuredClone;w.scrollTo=()=>{};
 w.fetch=async(url,options={})=>{
  if(options.method==='PUT'){
   if(pendingPut)await pendingPut;
   return {ok:!fail,status:fail?503:200,json:async()=>fail?{detail:'Offline'}:{id:'completed'}};
  }
  return {ok:true,status:200,json:async()=>url==='/api/account/sessions'?[]:{}};
 };
 w.eval(code);return dom;
}
(async()=>{
 let dom=browser(),w=dom.window;
 const session={id:'completed',date:'2026-10-05',total:1,settings:{technology:'Python',resume_text:'Private resume'},answers:[{question:'Q',answer:'A',recording:null}],active:false};
 w.state.interviewSession=session;
 const saving=w.saveFinishedSession(session);
 await waitFor(()=>w.document.getElementById('session-storage-status').textContent.includes('Saved on this device'));
 assert.equal(w.state.sessionSavePending,null,'Navigation is released after the local transaction commits');
 const entry=await w.outboxStore('readonly',s=>s.get('completed'));
 assert(!('resume_text' in entry.record.settings),'Resume text must not enter the queue');
 release();assert.equal(await saving,true,'A durable device copy counts as saved even while offline');
 assert(w.document.getElementById('session-storage-status').textContent.includes('sync is pending'));
 dom.window.close();fail=false;pendingPut=null;
 dom=browser();w=dom.window;w.initStorage();
 await waitFor(async()=>!(await w.outboxStore('readonly',s=>s.get('completed'))));
 await waitFor(()=>w.document.getElementById('account-status').textContent.includes('synced'));
 w.indexedDB={open(){throw Error('Storage unavailable');}};
 const result=await w.saveFinishedSession(session);
 assert.equal(result,false,'A failed local transaction must not claim device persistence');
 assert(w.state.sessionSavePending);
 const leaving=new w.Event('beforeunload',{cancelable:true});w.dispatchEvent(leaving);
 assert(leaving.defaultPrevented,'Protect the unfinished save while local persistence is unavailable');
 dom.window.close();
 console.log('PASS: safe navigation after local commit, resume exclusion, offline save acknowledgment, startup sync and storage-failure exit protection.');
})().catch(error=>{console.error(error);process.exitCode=1;});
