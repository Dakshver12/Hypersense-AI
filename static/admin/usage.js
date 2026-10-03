const $ = id => document.getElementById(id);
const labels = {question:'Single question',session_questions:'Session questions',evaluation:'Answer scoring',other:'Other'};
const number = value => Number(value || 0).toLocaleString();
const count = rows => rows.reduce((total,row)=>total+row.count,0);
const average = rows => count(rows) ? (rows.reduce((total,row)=>total+row.total_ms,0)/count(rows)/1000).toFixed(2)+' s' : '—';
const milliseconds = rows => count(rows) ? Math.round(rows.reduce((total,row)=>total+row.total_ms,0)/count(rows))+' ms' : '—';
function table(id, rows) {
  const body=$(id);body.replaceChildren();
  for(const values of rows){
    const row=document.createElement('tr');
    for(const value of values){const cell=document.createElement('td');cell.textContent=String(value);row.append(cell);}
    body.append(row);
  }
}
export function renderUsage(data) {
  const rows=data.rows, attempts=rows.filter(r=>r.kind==='attempt');
  const requests=rows.filter(r=>r.kind==='request');
  const fallback=count(attempts.filter(r=>r.fallback));
  $('metric-requests').textContent=number(count(requests));
  $('metric-attempts').textContent=number(count(attempts));
  $('metric-limits').textContent=number(count(attempts.filter(r=>r.outcome==='rate_limited')));
  $('metric-fallbacks').textContent=number(fallback);
  $('metric-fallback-rate').textContent=(count(attempts)?(100*fallback/count(attempts)).toFixed(1):'0')+'% of provider attempts';
  $('metric-app-latency').textContent=milliseconds(requests);
  table('usage-providers',['Gemini','Groq'].map(provider=>{
    const selected=attempts.filter(r=>r.provider===provider);
    return [provider,number(count(selected)),number(count(selected.filter(r=>r.outcome==='success'))),number(count(selected.filter(r=>r.outcome==='rate_limited'))),number(count(selected.filter(r=>r.outcome==='error'))),average(selected),number(count(rows.filter(r=>r.kind==='cooldown'&&r.provider===provider)))];
  }));
  table('usage-operations',Object.entries(labels).filter(([key])=>key!=='other'||requests.some(r=>r.operation==='other')).map(([key,label])=>{
    const selected=requests.filter(r=>r.operation===key);
    return [label,number(count(selected)),number(count(selected.filter(r=>r.outcome==='success'))),average(selected)];
  }));
  const daily=new Map(data.daily.map(row=>[row.day,row]));const dates=[];
  for(let day=data.since;day<=data.until;day+=86400){
    const item=daily.get(day)||{requests:0,attempts:0,rate_limits:0};
    dates.push([new Date(day*1000).toISOString().slice(0,10),number(item.requests),number(item.attempts),number(item.rate_limits)]);
  }
  table('usage-daily',dates.reverse());
  $('usage-updated').textContent='Updated '+new Date(data.until*1000).toLocaleTimeString();
  $('usage-content').hidden=false;
  $('usage-status').textContent=rows.length?'Showing aggregate activity for the selected UTC period.':'No activity recorded in this period. Complete a question-generation or scoring request to see usage.';
}
let pending=false;
export async function loadUsage(){
  if(pending)return;pending=true;
  $('usage-refresh').disabled=true;$('usage-days').disabled=true;
  $('usage-status').className='';$('usage-status').textContent='Loading usage…';
  try{
    const response=await fetch('/api/admin/usage?days='+encodeURIComponent($('usage-days').value),{
      cache:'no-store',headers:{'X-HyperSense-Account':document.querySelector('meta[name="hypersense-account"]')?.content||''}
    });
    if(!response.ok){
      if(response.status===401)throw Error('Your session has expired. Sign in again to view usage.');
      if(response.status===403)throw Error('Administrator access is required.');
      if(response.status===409)throw Error('The signed-in account changed. Reload this page.');
      throw Error('Usage data could not be loaded. Try refreshing.');
    }
    const data=await response.json();
    if(!Array.isArray(data.rows)||!Array.isArray(data.daily)||!Number.isFinite(data.since)||!Number.isFinite(data.until))throw Error('The server returned invalid usage data.');
    renderUsage(data);
  }catch(error){$('usage-content').hidden=true;$('usage-updated').textContent='';$('usage-status').className='error';$('usage-status').textContent=error.message;}
  finally{pending=false;$('usage-refresh').disabled=false;$('usage-days').disabled=false;}
}
if($('usage-filters')){
  $('usage-filters').addEventListener('submit',event=>{event.preventDefault();loadUsage();});
  $('usage-days').addEventListener('change',loadUsage);
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')loadUsage();});
  loadUsage();
}
