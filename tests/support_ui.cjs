const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{JSDOM}=require('jsdom'),esbuild=require('esbuild');
const root=path.resolve(__dirname,'..'),bundle=esbuild.buildSync({entryPoints:[path.join(root,'static/support/support.js')],bundle:true,write:false,format:'iife'}).outputFiles[0].text;
async function check(admin){
 const dom=new JSDOM(fs.readFileSync(path.join(root,'templates',admin?'admin-support.html':'support.html'),'utf8'),{url:'http://localhost/'+(admin?'admin/support':'support'),runScripts:'outside-only'}),w=dom.window,$=id=>w.document.getElementById(id);
 let reports=[],posted=[],sent=[],patches=0,reads=0,fail=true,failMessage=true;
 const report={id:'r1',title:'<img src=x onerror=bad()>',category:'bug',description:'Recording stopped early',status:'resolved',reply:'First reply',created:1000,updated:1000,version:2,email:'a@example.com',unread:true,reply_version:2,user_version:1,messages:[{id:'m1',role:'admin',body:'First reply <img src=x>',created:1000,version:2}]};
 if(admin)reports=[report];
 w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;};
 w.fetch=async(url,options)=>{
  let data;
  if(url.endsWith('/read')){reads++;assert($('support-dialog').open);assert.equal(JSON.parse(options.body).reply_version,admin?report.user_version:report.reply_version);report.unread=false;data={read:true};}
  else if(url.endsWith('/messages')){
   const body=JSON.parse(options.body);sent.push(body);
   if(failMessage)return {ok:false,json:async()=>({detail:'Temporary send failure'})};
   report.version++;report.messages.push({id:'m2',role:admin?'admin':'user',body:body.body,created:1100,version:report.version});
   if(!admin){assert(body.reopen);report.status='open';}else{report.reply=body.body;report.status=body.status;}
   data={sent:true};
  }
  else if(options.method==='POST'){posted.push(JSON.parse(options.body));if(fail)return {ok:false,json:async()=>({detail:'Temporary error'})};reports=[report];data={id:'r1',created:true};}
  else if(options.method==='PATCH'){patches++;data={updated:true};}
  else if(url.endsWith('/r1'))data=JSON.parse(JSON.stringify(report));
  else data={reports,total:reports.length,page:1,counts:{open:reports.length},awaiting_reply:0};
  return {ok:true,json:async()=>data};
 };
 const wait=async()=>{await new Promise(r=>setTimeout(r,30));};
 const submit=()=>{$('support-update').dispatchEvent(new w.Event('submit',{cancelable:true}));};
 try{
  w.eval(bundle);await wait();
  if(!admin){
   $('report-title').value='Audio bug';$('report-description').value='The audio stops early.';
   $('support-create').dispatchEvent(new w.Event('submit',{cancelable:true}));await wait();assert.equal($('report-title').value,'Audio bug');assert($('report-result').textContent.includes('Temporary'));
   fail=false;$('support-create').dispatchEvent(new w.Event('submit',{cancelable:true}));await wait();assert.equal(posted[0].request_id,posted[1].request_id);assert.equal($('report-title').value,'');
  }
  assert.equal($('support-list').querySelector('img'),null);$('support-list').querySelector('button').click();await wait();assert($('support-dialog').open);assert.equal(w.document.activeElement,$('detail-close'));
  assert.equal(reads,1);assert.equal($('support-thread').querySelector('img'),null);assert($('support-thread').textContent.includes('First reply <img src=x>'));
  assert.equal($('detail-reply').value,'');
  if(!admin)assert.equal($('detail-save').textContent,'Reopen & send');
  $('detail-reply').value=admin?'A new fix is ready.':'Still broken on the final question.';const draft=$('detail-reply').value;
  submit();await wait();assert.equal($('detail-reply').value,draft);assert($('detail-status').textContent.includes('Temporary send'));
  $('detail-refresh').click();await wait();assert.equal($('detail-reply').value,draft);
  $('support-dialog').dispatchEvent(new w.Event('cancel',{cancelable:true}));assert(!$('support-dialog').open);
  $('support-list').querySelector('button').click();await wait();assert.equal($('detail-reply').value,draft);
  failMessage=false;submit();await wait();assert.equal(sent[0].request_id,sent[1].request_id);assert.equal($('detail-reply').value,'');assert.equal($('support-thread').querySelectorAll('article').length,2);assert($('support-dialog').open);
  if(admin){$('detail-state').value='in_progress';submit();await wait();assert.equal(patches,1);assert.equal(sent.length,2);}
  else assert.equal($('detail-save').textContent,'Send follow-up');
 }finally{w.close();}
}
(async()=>{await check(false);await check(true);console.log('PASS: support thread rendering, safe text, read acknowledgments, reopen, draft preservation, idempotent retries and status-only updates.');})().catch(e=>{console.error(e);process.exitCode=1;});
