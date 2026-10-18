const assert=require('node:assert/strict');
const fs=require('node:fs');const path=require('node:path');const {JSDOM}=require('jsdom');
const root=path.resolve(__dirname,'..');
const code=fs.readFileSync(path.join(root,'static/auth/form.js'),'utf8');
const shell=fs.readFileSync(path.join(root,'templates/auth.html'),'utf8').replace('<!-- social-providers -->','<a data-provider="google" href="/auth/oauth/google/start">Continue with Google</a><a data-provider="github" href="/auth/oauth/github/start">Continue with GitHub</a>');
const flush=()=>new Promise(r=>setTimeout(r,0));
(async()=>{
 for(const width of [390,1280]){
  const dom=new JSDOM(shell,{url:'https://example.test/verify-email',runScripts:'outside-only'});const w=dom.window,d=id=>w.document.getElementById(id);w.innerWidth=width;w.scrollTo=()=>{};
  let sent;w.fetch=async(url,options)=>{sent=[url,JSON.parse(options.body)];return {ok:true,json:async()=>({message:'Email sent.'})};};w.eval(code);
  assert.equal(d('auth-submit').textContent,'Send verification email');assert.equal(d('email-field').hidden,false);assert.equal(d('password-field').hidden,true);assert.equal(d('verification-help').hidden,false);
  d('auth-email').value='daksh@example.test';d('auth-form').dispatchEvent(new w.Event('submit',{cancelable:true}));await flush();
  assert.equal(sent[0],'/auth/resend-verification');assert.deepEqual(sent[1],{email:'daksh@example.test'});
  w.fetch=async()=>({ok:false,status:503,json:async()=>({detail:'Email delivery is unavailable.'})});
  d('auth-form').dispatchEvent(new w.Event('submit',{cancelable:true}));await flush();assert.match(d('auth-message').textContent,/could not be sent/);assert.equal(d('auth-submit').disabled,false);
  w.fetch=async(url,options)=>{sent=[url,JSON.parse(options.body)];return {ok:true,json:async()=>({message:'Email verified.'})};};
  d('verification-link').value='https://example.test/verify-email#token='+'a'.repeat(43);d('verification-link-form').dispatchEvent(new w.Event('submit',{cancelable:true}));await flush();
  assert.equal(sent[0],'/auth/verify-email');assert.equal(sent[1].token,'a'.repeat(43));assert.equal(d('auth-form').hidden,true);assert.equal(d('verification-link').value,'');dom.window.close();
 }
 for(const route of ['/login','/signup','/connect-account','/verify-email?token='+'b'.repeat(43)]){
  const dom=new JSDOM(shell,{url:'https://example.test'+route,runScripts:'outside-only'});const w=dom.window,d=id=>w.document.getElementById(id);w.fetch=()=>{throw Error('Unexpected page request');};w.scrollTo=()=>{};w.eval(code);
  if(route.startsWith('/verify-email')){assert.equal(w.location.search,'');assert.equal(d('auth-submit').textContent,'Verify email');assert.equal(d('social-options').hidden,true);assert.equal(d('verification-retry').hidden,false);}
  else{assert.equal(d('social-options').hidden,false);assert.equal(d('social-options').querySelector('a').getAttribute('href'),'/auth/oauth/google/start'+(route==='/connect-account'?'?connect=1':''));}
  if(route==='/login'){d('resend-link').click();assert.equal(w.location.pathname,'/verify-account');assert.equal(d('auth-submit').textContent,'Send verification email');}
  if(route==='/connect-account')assert.equal(d('auth-form').hidden,true);
  dom.window.close();
 }
 console.log('PASS: mobile/desktop verification center, resend retry, copied links, query-token cleanup and provider navigation.');
})().catch(e=>{console.error(e);process.exitCode=1;});
