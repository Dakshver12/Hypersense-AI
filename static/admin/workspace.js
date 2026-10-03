const $=id=>document.getElementById(id);
const view=location.pathname==='/admin/users'?'users':location.pathname==='/admin/audit'?'audit':'overview';
const account=document.querySelector('meta[name="hypersense-account"]')?.content||'';
let page=1,total=0,busy=false,target=null,filters={q:'',status:'all'};
const num=n=>Number(n||0).toLocaleString();
const date=n=>new Date(n*1000).toLocaleDateString(undefined,{year:'numeric',month:'short',day:'numeric'});
async function request(path,options={}){
  const response=await fetch(path,{...options,cache:'no-store',headers:{'X-HyperSense-Account':account,...(options.body?{'Content-Type':'application/json'}:{})}});
  if(!response.ok){
    let message='The request failed. Please retry.';
    try{const data=await response.json();if(typeof data.detail==='string')message=data.detail;}catch{}
    throw Error(message);
  }
  return response.json();
}
function cell(row,value){const td=document.createElement('td');if(value instanceof Node)td.append(value);else td.textContent=String(value);row.append(td);}
function table(id,rows,cols){
  const body=$(id);body.replaceChildren();
  for(const values of rows){const tr=document.createElement('tr');values.forEach(v=>cell(tr,v));body.append(tr);}
  if(!rows.length){const tr=document.createElement('tr'),td=document.createElement('td');td.colSpan=cols;td.className='empty-cell';td.textContent='No records to show.';tr.append(td);body.append(tr);}
}
function badge(text,style=''){const span=document.createElement('span');span.className='badge '+style;span.textContent=text;return span;}
function stat(parent,label,value){const p=document.createElement('p'),strong=document.createElement('strong');p.textContent=label;strong.textContent=num(value);p.append(strong);parent.append(p);}
function pagination(){
  $('admin-pagination').hidden=view==='overview';$('page-previous').disabled=page===1;
  $('page-next').disabled=page*20>=total;$('page-number').textContent=`Page ${page} of ${Math.max(1,Math.ceil(total/20))}`;
}
async function overview(){
  const [data,usage]=await Promise.all([request('/api/admin/overview'),request('/api/admin/usage?days=7').catch(()=>null)]);
  const recovery=data.backup||{},backupState=$('backup-state');
  const stale=recovery.last_success_at&&Date.now()/1000-recovery.last_success_at>86400;
  backupState.className='badge '+(!recovery.available||stale||recovery.last_attempt_ok===false?'warn':'');
  backupState.textContent=!recovery.last_success_at?'No backup yet':!recovery.available?'Backup unavailable':recovery.last_attempt_ok===false?'Latest attempt failed':stale?'Backup over 24 hours old':'Verified backup';
  $('backup-summary').textContent=recovery.last_success_at?'Last successful backup: '+new Date(recovery.last_success_at*1000).toLocaleString():'No successful backup has been recorded.';
  $('backup-detail').textContent=recovery.last_success_at?(recovery.available?'Database integrity and a separate restore copy were checked when this backup was created.':'The last backup files could not be found at the configured location.'):'Run the backup command to create your first verified snapshot.';
  if(recovery.backend==='postgresql'){
    backupState.textContent='External backup required';
    $('backup-summary').textContent='PostgreSQL is the active database.';
    $('backup-detail').textContent='SQLite snapshots do not protect this database. Maintain private PostgreSQL backups and verify restoration separately.';
  }
  $('overview-total').textContent=num(data.users.total);$('overview-new').textContent=num(data.users.new_week)+' joined in the last 7 days';
  $('overview-verified').textContent=num(data.users.verified);$('overview-signed').textContent=num(data.users.signed_in);$('overview-sessions').textContent=num(data.sessions.saved);
  const attention=$('account-attention');attention.replaceChildren();stat(attention,'Awaiting verification',data.users.total-data.users.verified);stat(attention,'Suspended accounts',data.users.suspended);
  const summary=$('service-summary');summary.replaceChildren();
  if(usage){
    const requests=usage.rows.filter(r=>r.kind==='request');
    stat(summary,'App requests',requests.reduce((s,r)=>s+r.count,0));
    stat(summary,'Unsuccessful requests',requests.filter(r=>r.outcome!=='success').reduce((s,r)=>s+r.count,0));
    stat(summary,'Provider rate limits',usage.rows.filter(r=>r.kind==='attempt'&&r.outcome==='rate_limited').reduce((s,r)=>s+r.count,0));
  }else summary.textContent='Usage metrics are currently unavailable. Account totals are still available.';
  table('recent-users',data.recent_users.map(u=>[u.name,u.email,badge(u.verified?'Verified':'Pending',u.verified?'':'warn'),date(u.created)]),4);
}
async function users(){
  const data=await request('/api/admin/users?'+new URLSearchParams({...filters,page}));total=data.total;
  table('admin-users',data.users.map(u=>{
    let action='Administrator';
    if(!u.protected){action=document.createElement('button');action.type='button';action.className='secondary';action.textContent=u.suspended?'Restore access':'Suspend';action.addEventListener('click',()=>openAccess(u));}
    return [u.name,u.email,badge(u.suspended?'Suspended':u.verified?'Verified':'Unverified',u.suspended?'danger':u.verified?'':'warn'),num(u.sessions),date(u.created),action];
  }),6);
  $('users-count').textContent=num(total)+' matching accounts';
}
async function audit(){
  const data=await request('/api/admin/audit?page='+page);total=data.total;
  table('admin-audit',data.events.map(e=>[new Date(e.at*1000).toLocaleString(),badge(e.action==='suspend'?'Suspended':e.action==='restore'?'Restored':'Support updated',e.action==='suspend'?'danger':''),e.actor_id,e.target_id,e.reason]),5);
  $('audit-count').textContent=num(total)+' recorded changes';
}
async function load(){
  if(busy)return;busy=true;$('admin-refresh').disabled=true;$('admin-status').textContent='Loading workspace…';
  $('page-previous').disabled=true;$('page-next').disabled=true;
  try{
    if(view==='overview')await overview();else if(view==='users')await users();else await audit();
    $(view+'-view').hidden=false;pagination();$('admin-status').textContent='Updated '+new Date().toLocaleTimeString();
  }catch(error){$(view+'-view').hidden=true;$('admin-pagination').hidden=true;$('admin-status').textContent=error.message;}
  finally{busy=false;$('admin-refresh').disabled=false;}
}
function openAccess(user){
  if(busy)return;target=user;const suspend=!user.suspended;
  $('access-title').textContent=suspend?'Suspend account?':'Restore account access?';
  $('access-description').textContent=(suspend?'This will sign out ':'This will allow sign-in for ')+user.email+(suspend?' and block account access. Saved interviews will be kept.':'. Existing sign-ins will not be restored.');
  $('access-reason').value='';$('access-error').textContent='';$('access-confirm').textContent=suspend?'Suspend account':'Restore access';
  $('access-dialog').showModal();$('access-cancel').focus();
}
$('access-cancel').addEventListener('click',()=>{if(!busy)$('access-dialog').close();});
$('access-dialog').addEventListener('cancel',event=>{if(busy)event.preventDefault();});
$('access-form').addEventListener('submit',async event=>{
  event.preventDefault();if(busy||!target)return;
  const reason=$('access-reason').value.trim();if(reason.length<3){$('access-error').textContent='Enter a reason of at least three characters.';return;}
  busy=true;$('access-confirm').disabled=true;$('access-cancel').disabled=true;
  try{
    await request('/api/admin/users/'+encodeURIComponent(target.id)+'/access',{method:'POST',body:JSON.stringify({action:target.suspended?'restore':'suspend',reason})});
    $('access-dialog').close();target=null;busy=false;await load();
  }catch(error){$('access-error').textContent=error.message;}
  finally{busy=false;$('access-confirm').disabled=false;$('access-cancel').disabled=false;}
});
const titles={overview:['Overview','Workspace overview','A clear view of your community and platform activity.'],users:['Users','User directory','Find accounts, check verification and manage access responsibly.'],audit:['Audit log','Access history','Review who suspended or restored an account, when and why.']};
$('page-crumb').textContent=titles[view][0].toUpperCase();$('page-title').textContent=titles[view][1];$('page-description').textContent=titles[view][2];document.title=titles[view][0]+' · HyperSense admin';
$('admin-refresh').addEventListener('click',load);
$('user-search').addEventListener('submit',event=>{event.preventDefault();if(busy)return;page=1;filters={q:$('user-query').value.trim(),status:$('user-filter').value};load();});
$('page-previous').addEventListener('click',()=>{if(!busy&&page>1){page--;load();}});
$('page-next').addEventListener('click',()=>{if(!busy&&page*20<total){page++;load();}});
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&!$('access-dialog').open)load();});
load();
