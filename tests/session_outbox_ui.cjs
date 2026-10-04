const assert = require('node:assert/strict');
const path = require('node:path');
const {JSDOM} = require('jsdom');
const {IDBFactory} = require('fake-indexeddb');
const esbuild = require('esbuild');
const root = path.resolve(__dirname, '..');
const bundle = esbuild.buildSync({stdin:{contents:`import * as outbox from './session-outbox.js'; Object.assign(window,outbox);`,resolveDir:path.join(root,'static/js')},bundle:true,write:false,format:'iife'}).outputFiles[0].text;
const db = new IDBFactory();
let uploads=0, writes=[], failSave=true, holdPut=null;
let lockChain=Promise.resolve();
const locks={request(name, operation){
  assert.equal(name,'hypersense-session-sync:alice');
  const run=lockChain.then(operation);lockChain=run.catch(()=>{});return run;
}};
const reply = (data,status=200) => ({ok:status<300,status,json:async()=>data});
function browser(account, useLocks=false) {
  const dom = new JSDOM(`<meta name="hypersense-account" content="${account}">`,{url:'https://app.test',runScripts:'outside-only'});
  const w=dom.window;w.indexedDB=db;w.Blob=Blob;w.structuredClone=structuredClone;
  if(useLocks)Object.defineProperty(w.navigator,'locks',{value:locks});
  w.fetch=async(url,options={})=>{
    if(url.startsWith('/api/')) assert.equal(options.headers['X-HyperSense-Account'],account);
    if(url.endsWith('/config')) return reply({enabled:true});
    if(url.endsWith('/uploads')) { uploads++; return reply({object_id:'a'.repeat(32),upload_url:'https://storage.test/upload'}); }
    if(url==='https://storage.test/upload') return reply({});
    if(url.endsWith('/complete')) return reply({object_id:'a'.repeat(32),type:'audio/webm',bytes:5,name:'answer.webm'});
    if(url.startsWith('/api/account/sessions/') && options.method==='PUT') {
      const payload=JSON.parse(options.body);writes.push(payload);
      if(holdPut) {const wait=holdPut;holdPut=null;await wait;}
      return failSave ? reply({detail:'Offline'},503) : reply({id:payload.id});
    }
    throw Error('Unexpected request '+url);
  };
  w.eval(bundle);return dom;
}
const record={id:'one',total:1,date:'2026-10-04',settings:{technology:'Python'},notes:'First',answers:[{question:'Q',answer:'A',recording:{blob:new Blob(['audio'],{type:'audio/webm'}),name:'answer.webm'}}]};
(async()=>{
  let dom=browser('alice'),w=dom.window;
  await w.queueFinishedSession(record);
  assert.equal((await w.outboxStore('readonly',s=>s.getAll())).length,1);
  await assert.rejects(w.flushSessionOutbox(),/Offline/);
  const queued=await w.outboxStore('readonly',s=>s.get('one'));
  assert.equal(queued.record.answers[0].recording.object_id,'a'.repeat(32));
  assert.equal(uploads,1);
  dom.window.close();
  const other=browser('bob');await other.window.flushSessionOutbox();
  assert.equal(writes.length,1,'Another account must not sync Alice data');other.window.close();
  dom=browser('alice');w=dom.window;failSave=false;
  await w.flushSessionOutbox();
  assert.equal(uploads,1,'Reload retries reuse the completed audio object');
  assert.equal((await w.outboxStore('readonly',s=>s.getAll())).length,0);
  let release;
  holdPut=new Promise(resolve=>{release=resolve;});
  await w.queueFinishedSession({...queued.record,notes:'Old'});
  const inflight=w.flushSessionOutbox();
  for(let i=0;i<100 && writes.length<3;i++) await new Promise(r=>setTimeout(r,5));
  assert.equal(writes.length,3);
  await w.queueFinishedSession({...queued.record,notes:'New'});
  release();await inflight;
  assert.equal(writes.at(-1).notes,'New','An older PUT must not erase a newer queued edit');
  assert.equal((await w.outboxStore('readonly',s=>s.getAll())).length,0);
  await w.queueFinishedSession(queued.record);
  await w.discardQueuedSession('one');
  assert.equal((await w.outboxStore('readonly',s=>s.getAll())).length,0);
  dom.window.close();
  const first=browser('alice',true),second=browser('alice',true);
  let unblock;
  holdPut=new Promise(resolve=>{unblock=resolve;});
  const initialWrites=writes.length;
  await first.window.queueFinishedSession({...queued.record,notes:'Tab one'});
  const firstFlush=first.window.flushSessionOutbox();
  for(let i=0;i<100 && writes.length===initialWrites;i++) await new Promise(r=>setTimeout(r,5));
  await second.window.queueFinishedSession({...queued.record,notes:'Tab two'});
  const secondFlush=second.window.flushSessionOutbox();
  await new Promise(r=>setTimeout(r,10));
  assert.equal(writes.length,initialWrites+1,'The other tab must wait for the account lock');
  unblock();await Promise.all([firstFlush,secondFlush]);
  assert.equal(writes.at(-1).notes,'Tab two');
  first.window.close();second.window.close();
  console.log('PASS: durable session queue, reload retry, account isolation, upload reuse, newer-edit preservation and queue cancellation.');
})().catch(error=>{console.error(error);process.exitCode=1;});
