const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {JSDOM}=require('jsdom'),esbuild=require('esbuild');
const root=path.resolve(__dirname,'..');
const html=fs.readFileSync(path.join(root,'templates/admin-workspace.html'),'utf8').replace('<!-- admin-nav -->',fs.readFileSync(path.join(root,'templates/admin-nav.html'),'utf8'));
const code=esbuild.buildSync({entryPoints:[path.join(root,'static/admin/workspace.js')],bundle:true,write:false,format:'iife'}).outputFiles[0].text;
(async()=>{
 const dom=new JSDOM(html,{url:'http://localhost/admin/users',runScripts:'outside-only'}),w=dom.window,$=id=>w.document.getElementById(id);
 let suspended=false,actions=0,lastURL='',fail=false;
 w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;};
 w.fetch=async(url,options)=>{
  lastURL=url;let data;
  if(fail)return {ok:false,status:403,json:async()=>({detail:'Administrator access is required.'})};
  if(options.method==='POST'){
   const change=JSON.parse(options.body);assert.equal(change.reason,'Review complete');suspended=change.action==='suspend';actions++;data={changed:true};
  }else data={total:1,users:[{id:'user',name:'<script>bad</script>',email:'person@example.com',verified:1,suspended,protected:false,sessions:3,created:1000}]};
  return {ok:true,json:async()=>data};
 };
 const wait=async()=>{for(let i=0;i<50;i++){await new Promise(r=>setTimeout(r,10));if(!$('admin-refresh').disabled&&!$('access-confirm').disabled)return;}throw Error('Timed out');};
 try{
  w.eval(code);await wait();assert.equal($('admin-users').querySelector('script'),null);assert($('admin-users').textContent.includes('<script>bad</script>'));
  $('admin-users').querySelector('button').click();assert($('access-dialog').open);assert.equal(w.document.activeElement,$('access-cancel'));
  $('access-cancel').click();assert.equal(actions,0);assert(!$('access-dialog').open);
  $('admin-users').querySelector('button').click();$('access-reason').value='Review complete';$('access-form').dispatchEvent(new w.Event('submit',{cancelable:true}));await wait();
  assert.equal(actions,1);assert(!$('access-dialog').open);assert($('admin-users').textContent.includes('Restore access'));
  $('user-query').value='person';$('user-search').dispatchEvent(new w.Event('submit',{cancelable:true}));await wait();assert(lastURL.includes('q=person'));
  fail=true;$('admin-refresh').click();await wait();assert($('users-view').hidden);assert($('admin-status').textContent.includes('Administrator'));
  console.log('PASS: user management safely renders metadata, confirms changes, cancels, submits reasons, refreshes status, searches and handles denied access.');
 }finally{w.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
