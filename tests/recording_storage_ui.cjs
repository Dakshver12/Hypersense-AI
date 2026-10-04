// Exercise the real browser storage adapter with simulated private object storage.
const assert=require('node:assert/strict');
const path=require('node:path');
const {JSDOM}=require('jsdom');
const esbuild=require('esbuild');
const root=path.resolve(__dirname,'..');
const code=esbuild.buildSync({stdin:{contents:`import * as store from './account-store.js';import { buildBackup, parseBackup } from './backup.js';Object.assign(window,store,{buildBackup,parseBackup});`,resolveDir:path.join(root,'static/js')},bundle:true,write:false,format:'iife'}).outputFiles[0].text;
(async()=>{
  const dom=new JSDOM('<meta name="hypersense-account" content="alice">',{url:'http://localhost:8000',runScripts:'outside-only'});
  const w=dom.window;w.structuredClone=structuredClone;w.eval(code);
  const ident='a'.repeat(32),blob=new w.Blob(['test-audio'],{type:'audio/webm;codecs=opus'});
  const record={id:'one',date:'2026-10-03T00:00:00Z',total:1,settings:{technology:'Python'},answers:[{question:'Q',answer:'A',recording:{blob,name:'answer.webm'}}]};
  let uploads=0,downloads=0,saves=0,failSave=true,failUpload=false,payload;
  const response=(data,status=200)=>({ok:status<300,status,json:async()=>data});
  w.fetch=async(url,options={})=>{
    if(url.startsWith('/api/'))assert.equal(options.headers['X-HyperSense-Account'],'alice');
    if(url.endsWith('/config'))return response({enabled:true});
    if(url.endsWith('/uploads')){
      uploads++;const body=JSON.parse(options.body);assert.equal(body.type,'audio/webm');assert.equal(body.bytes,10);
      return response({object_id:ident,upload_url:'https://storage.test/upload?token=private'});
    }
    if(url.startsWith('https://storage.test/upload')){
      assert.equal(options.credentials,'omit');assert.equal(options.headers['x-upsert'],'false');
      assert(!options.headers.apikey);assert(!options.headers.Authorization);assert.equal(options.body,blob);
      return response({},failUpload?503:200);
    }
    if(url.endsWith('/complete'))return response({object_id:ident,name:'answer.webm',type:'audio/webm',bytes:10});
    if(url.endsWith('/playback'))return response({url:'https://storage.test/playback?token=private'});
    if(url.startsWith('https://storage.test/playback')){
      downloads++;assert.equal(options.credentials,'omit');return {ok:true,blob:async()=>blob};
    }
    if(url==='/api/account/sessions/one'){
      if(options.method==='PUT'){
        saves++;payload=JSON.parse(options.body);
        assert(!JSON.stringify(payload).includes('base64'));assert(!JSON.stringify(payload).includes('token='));
        return failSave?response({detail:'Temporary database error'},503):response({id:'one'});
      }
      return response(payload);
    }
    if(url==='/api/account/sessions')return response([payload]);
    throw Error('Unexpected URL: '+url);
  };
  await assert.rejects(w.putAccountSession(record),/Temporary database error/);
  failSave=false;await w.putAccountSession(record);
  assert.equal(uploads,1,'Save retries must reuse uploaded audio');assert.equal(saves,2);
  const listed=await w.remoteSessionStore.getAll();
  assert.equal(downloads,0,'History must not download cloud audio');assert.equal(listed[0].answers[0].recording.object_id,ident);
  const reopened=await w.remoteSessionStore.get('one');
  assert.equal(downloads,1);assert.equal(reopened.answers[0].recording.blob.size,10);
  assert.equal(reopened.answers[0].recording.blob.type,'audio/webm');
  await w.putAccountSession(reopened);assert.equal(uploads,1,'Saving notes or scores must keep the same recording');
  const backup=await w.buildBackup();
  assert(!backup.includes('object_id'));assert(!backup.includes('token='));
  assert.equal(JSON.parse(backup).sessions[0].answers[0].recording.base64,Buffer.from('test-audio').toString('base64'));
  assert.equal(w.parseBackup(backup).sessions[0].answers[0].recording.blob.size,10);
  const before=saves;
  failUpload=true;
  await assert.rejects(w.putAccountSession({...record,id:'two'}),/upload failed/);
  assert.equal(saves,before,'Failed uploads must not publish a broken session');
  dom.window.close();
  console.log('PASS: direct private upload, no secret headers, save retry deduplication, metadata-only history, playback, reference-preserving edits and portable audio backups.');
})().catch(error=>{console.error(error);process.exitCode=1;});
