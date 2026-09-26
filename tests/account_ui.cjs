// Focused tests for real auth-page controls and authenticated storage adapters.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {JSDOM}=require('jsdom');
const esbuild=require('esbuild');
const root=path.resolve(__dirname,'..');
const auth=fs.readFileSync(path.join(root,'static/auth/form.js'),'utf8');
const shell=fs.readFileSync(path.join(root,'templates/auth.html'),'utf8');
const flush=()=>new Promise(r=>setTimeout(r,10));
(async()=>{
  for(const route of ['/signup','/login','/forgot-password','/reset-password#token='+'a'.repeat(43),'/verify-email#token='+'b'.repeat(43)]) {
    const dom=new JSDOM(shell,{url:'http://localhost:8000'+route,runScripts:'outside-only'});
    const w=dom.window,d=id=>w.document.getElementById(id);let sent;
    w.fetch=async(url,options)=>{sent={url,body:JSON.parse(options.body)};return {ok:false,json:async()=>({detail:'Test error'})};};
    w.eval(auth);
    assert.equal(d('password-hint').hidden,!(route==='/signup'||route.startsWith('/reset-password')));
    assert(w.document.querySelector('.mail-help summary'));
    if(route==='/login')assert.equal(d('auth-title').textContent,'Welcome back.');
    assert.equal(w.location.hash,'');
    d('auth-name').value='Daksh';d('auth-email').value='daksh@example.com';d('auth-password').value='test-password-1234';
    d('password-toggle').click();assert.equal(d('auth-password').type,'text');d('password-toggle').click();assert.equal(d('auth-password').type,'password');
    d('auth-form').dispatchEvent(new w.Event('submit',{cancelable:true}));await flush();
    assert(sent.url.startsWith('/auth/'));assert.equal(d('auth-message').textContent,'Test error');assert.equal(d('auth-submit').disabled,false);
    if(route.startsWith('/reset'))assert.equal(sent.body.token,'a'.repeat(43));
    if(route.startsWith('/verify'))assert.equal(sent.body.token,'b'.repeat(43));
    if(route==='/signup')assert.equal(sent.body.name,'Daksh');
    if(route==='/signup'){
      w.fetch=async()=>({ok:true,json:async()=>({message:'Check your email',dev_link:'http://localhost:8000/verify-email#token=test'})});
      d('auth-form').dispatchEvent(new w.Event('submit',{cancelable:true}));await flush();
      assert.equal(d('dev-link').hidden,false);assert.equal(d('dev-link').querySelector('a').textContent,'Verify email →');
      w.fetch=async()=>({ok:true,json:async()=>({message:'Check your email',dev_link:'https://other.example/verify-email#token=test'})});
      d('auth-form').dispatchEvent(new w.Event('submit',{cancelable:true}));await flush();
      assert.equal(d('dev-link').hidden,true);
    }
    dom.window.close();
  }
  const code=esbuild.buildSync({stdin:{contents:`import * as store from './account-store.js'; import * as context from './account-context.js';Object.assign(window,store,context);`,resolveDir:path.join(root,'static/js')},bundle:true,write:false,format:'iife'}).outputFiles[0].text;
  const dom=new JSDOM('<meta name="hypersense-account" content="account-a">',{url:'http://localhost:8000',runScripts:'outside-only'}),w=dom.window;
  w.eval(code);
  assert.equal(w.accountKey('drafts'),'drafts:account-a');assert.equal(w.accountHeaders()['X-HyperSense-Account'],'account-a');
  const record={id:'one',settings:{technology:'Python'},answers:[{question:'Q',answer:'A',score:0,recording:{blob:new w.Blob(['test-audio'],{type:'audio/webm'}),name:'answer.webm'}}]};
  const encoded=await w.encodeAccountSession(record);assert.equal(encoded.answers[0].recording.base64,Buffer.from('test-audio').toString('base64'));
  const decoded=w.decodeAccountSession(encoded);assert.equal(decoded.answers[0].recording.blob.size,10);assert.equal(decoded.answers[0].score,0);
  let received=[];
  w.fetch=async(url,options)=>{received.push(options);return {ok:true,json:async()=>({id:'one'})};};
  await w.putAccountSession(record,true);
  assert.equal(received[0].headers['X-HyperSense-Account'],'account-a');assert.equal(received[0].headers['If-None-Match'],'*');
  w.fetch=async()=>({ok:false,status:409,json:async()=>({detail:'The signed-in account changed. Reload this page before continuing.'})});
  await assert.rejects(()=>w.restoreAccountSessions([record]),/account changed/);
  w.fetch=async()=>({ok:false,status:409,json:async()=>({detail:'This session already exists.'})});
  const counts=await w.restoreAccountSessions([record]);assert.equal(counts.skipped,1);
  dom.window.close();
  console.log('PASS: signup/login/reset/verification controls, password visibility, errors, token cleanup, account headers, recording conversion and safe import conflicts.');
})().catch(error=>{console.error(error);process.exitCode=1;});
