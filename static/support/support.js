const $=id=>document.getElementById(id),admin=document.body.dataset.supportAdmin==='true';
const base=admin?'/api/admin/support':'/api/support';
const account=document.querySelector('meta[name="hypersense-account"]')?.content||'';
const labels={open:'Open',in_progress:'In progress',resolved:'Resolved',bug:'Bug report',question:'Question issue',feedback:'Feedback'};
let page=1,total=0,loading=false,saving=false,creating=false,current=null,requestId=crypto.randomUUID(),filters={q:'',status:'all'},opener=null;
const drafts=new Map();
const date=n=>new Date(n*1000).toLocaleDateString();
function status(id,message,error=false){$(id).textContent=message;$(id).classList.toggle('support-error',error);}
async function request(url,options={}){
 const response=await fetch(url,{...options,cache:'no-store',headers:{'X-HyperSense-Account':account,...(options.body?{'Content-Type':'application/json'}:{})}});
 if(!response.ok){let message='Unable to complete this request. Please retry.';try{const data=await response.json();if(typeof data.detail==='string')message=data.detail;else if(response.status===422)message='Check the report fields and try again.';}catch{}throw Error(message);}
 return response.json();
}
function badge(value){const span=document.createElement('span');span.className='badge '+(value==='open'?'warn':'');span.textContent=labels[value]||value;return span;}
function cell(row,value){const td=document.createElement('td');if(value instanceof Node)td.append(value);else td.textContent=String(value);row.append(td);return td;}
async function load(){
 if(loading)return;loading=true;$('support-refresh').disabled=true;$('support-prev').disabled=true;$('support-next').disabled=true;status('support-status','Loading reports…');
 try{
  const data=await request(base+'?'+new URLSearchParams({page,...(admin?filters:{})}));total=data.total;
  const body=$('support-list');body.replaceChildren();
  for(const report of data.reports){
   const row=document.createElement('tr'),title=document.createElement('div'),category=document.createElement('small');title.textContent=report.title;category.textContent=labels[report.category];title.append(category);if((!admin&&report.unread)||(admin&&(report.awaiting_reply||report.admin_unread))){const flag=document.createElement('span');flag.className='support-unread';flag.textContent=admin?(report.admin_unread?'New message':'Needs reply'):'New reply';title.append(flag);}cell(row,title).className='support-title-cell';
   if(admin)cell(row,report.email);
   cell(row,badge(report.status));cell(row,date(report.updated));
   const button=document.createElement('button');button.dataset.reportId=report.id;button.type='button';button.className='secondary';button.textContent='Open';button.addEventListener('click',()=>openReport(report.id,button));cell(row,button);body.append(row);
  }
  if(!data.reports.length){const row=document.createElement('tr');const td=cell(row,admin?'No reports match these filters.':'No reports yet. Submit your first report using the form.');td.colSpan=admin?5:4;td.className='empty-cell';body.append(row);}
  if(admin){$('count-awaiting-reply').textContent=data.awaiting_reply||0;$('count-open').textContent=data.counts.open||0;$('count-in-progress').textContent=data.counts.in_progress||0;$('count-resolved').textContent=data.counts.resolved||0;}
  $('support-total').textContent=total+' reports';$('support-page').textContent=`Page ${page} of ${Math.max(1,Math.ceil(total/20))}`;
  $('support-prev').disabled=page<=1;$('support-next').disabled=page*20>=total;status('support-status','Updated '+new Date().toLocaleTimeString());
 }catch(error){$('support-list').replaceChildren();status('support-status',error.message,true);}
 finally{loading=false;$('support-refresh').disabled=false;}
}
function keepDraft(){if(current)drafts.set(current.id,{...(drafts.get(current.id)||{}),text:$('detail-reply').value});}
function closeDialog(){if(saving)return;keepDraft();const id=current?.id;$('support-dialog').close();current=null;const target=[...document.querySelectorAll('[data-report-id]')].find(b=>b.dataset.reportId===id);(target||opener)?.focus();}
function renderDetail(data){
 current=data;
 $('detail-title').textContent=data.title;$('detail-category').textContent=labels[data.category];$('detail-meta').textContent=labels[data.status]+' · Created '+date(data.created)+' · Updated '+date(data.updated);$('detail-description').textContent=data.description;
 const thread=$('support-thread');thread.replaceChildren();
 for(const message of data.messages||[]){
  const card=document.createElement('article'),meta=document.createElement('p'),body=document.createElement('p');
  card.className='thread-message '+(message.role==='admin'?'from-support':'from-user');
  meta.className='thread-meta';meta.textContent=(message.role==='admin'?'Support':admin?'User':'You')+' · '+new Date(message.created*1000).toLocaleString();
  body.className='thread-body';body.textContent=message.body;card.append(meta,body);thread.append(card);
 }
 if(!thread.childElementCount){const empty=document.createElement('p');empty.className='hint';empty.textContent='No follow-up messages yet.';thread.append(empty);}
 if(admin)$('detail-state').value=data.status;
 $('detail-reply').value=drafts.get(data.id)?.text||'';
 $('detail-save').textContent=admin?'Send reply / save status':data.status==='resolved'?'Reopen & send':'Send follow-up';
 $('reply-hint').textContent=admin?'Replies are added to the conversation. Leave the message empty for a status-only update.':data.status==='resolved'?'Sending a follow-up reopens this report for support.':'Your message will be added to this conversation.';
}
async function acknowledge(data){
 if(!data.unread)return;
 try{await request(base+'/'+encodeURIComponent(data.id)+'/read',{method:'POST',body:JSON.stringify({reply_version:admin?data.user_version:data.reply_version})});await load();}
 catch{if(current?.id===data.id)status('detail-status','Message displayed, but read status could not be saved. Refresh the conversation to retry.',true);}
}
async function openReport(id,button){
 if(current||saving)return;current={id};opener=button;button.disabled=true;
 try{
  const data=await request(base+'/'+encodeURIComponent(id));renderDetail(data);
  status('detail-status','');$('support-dialog').showModal();$('detail-close').focus();await acknowledge(data);
 }catch(error){current=null;status('support-status',error.message,true);}finally{button.disabled=false;}
}
$('detail-refresh').addEventListener('click',async()=>{
 if(saving||!current)return;keepDraft();const id=current.id;saving=true;$('detail-refresh').disabled=true;$('detail-save').disabled=true;$('detail-reply').disabled=true;if(admin)$('detail-state').disabled=true;
 try{const data=await request(base+'/'+id);renderDetail(data);status('detail-status','Conversation refreshed. Your draft is kept.');await acknowledge(data);}
 catch(error){status('detail-status',error.message,true);}
 finally{saving=false;$('detail-refresh').disabled=false;$('detail-save').disabled=false;$('detail-reply').disabled=false;if(admin)$('detail-state').disabled=false;}
});
$('support-update').addEventListener('submit',async event=>{
 event.preventDefault();if(saving||!current)return;const body=$('detail-reply').value.trim(),id=current.id;
 if(!admin&&!body){status('detail-status','Enter a message before sending.',true);return;}
 if(admin&&!body&&$('detail-state').value==='resolved'&&!current.reply){status('detail-status','Add a reply explaining the resolution.',true);return;}
 keepDraft();const draft=drafts.get(id),signature=JSON.stringify([body,admin?$('detail-state').value:current.status]);
 if(draft.signature!==signature){draft.requestId=crypto.randomUUID();draft.signature=signature;}
 saving=true;for(const key of ['detail-save','detail-close','detail-refresh','detail-reply'])$(key).disabled=true;if(admin)$('detail-state').disabled=true;
 try{
  if(body)await request(base+'/'+id+'/messages',{method:'POST',body:JSON.stringify({request_id:draft.requestId,body,version:current.version,...(admin?{status:$('detail-state').value}:{reopen:current.status==='resolved'})})});
  else await request(base+'/'+id,{method:'PATCH',body:JSON.stringify({status:$('detail-state').value,reply:'',version:current.version})});
  drafts.delete(id);$('detail-reply').value='';
  // Sending succeeded even if the subsequent history refresh fails.
  status('detail-status',body?'Message sent.':'Status updated.');
  try{const data=await request(base+'/'+id);renderDetail(data);await acknowledge(data);}catch{status('detail-status','Saved. Refresh the conversation to load the latest messages.');}
  await load();
 }catch(error){status('detail-status',error.message,true);}
 finally{saving=false;for(const key of ['detail-save','detail-close','detail-refresh','detail-reply'])$(key).disabled=false;if(admin)$('detail-state').disabled=false;}
});
$('detail-close').addEventListener('click',closeDialog);
$('support-dialog').addEventListener('cancel',event=>{event.preventDefault();closeDialog();});
$('support-refresh').addEventListener('click',load);
$('support-prev').addEventListener('click',()=>{if(!loading&&page>1){page--;load();}});
$('support-next').addEventListener('click',()=>{if(!loading&&page*20<total){page++;load();}});
if(admin){
 $('support-search').addEventListener('submit',event=>{event.preventDefault();if(loading)return;page=1;filters={q:$('support-query').value.trim(),status:$('support-filter').value};load();});
}else{
 $('support-create').addEventListener('submit',async event=>{
  event.preventDefault();if(creating)return;const title=$('report-title').value.trim(),description=$('report-description').value.trim();
  if(title.length<3||description.length<10){status('report-result','Enter a title and at least ten characters of detail.',true);return;}
  creating=true;$('report-submit').disabled=true;status('report-result','Submitting report…');
  try{await request(base,{method:'POST',body:JSON.stringify({request_id:requestId,category:$('report-category').value,title,description})});requestId=crypto.randomUUID();$('support-create').reset();page=1;status('report-result','Report submitted. You can check its status below.');await load();}
  catch(error){status('report-result',error.message,true);}finally{creating=false;$('report-submit').disabled=false;}
 });
}
load();
