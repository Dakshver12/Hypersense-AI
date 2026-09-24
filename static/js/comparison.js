import { $ } from './dom.js';
import { state } from './state.js';
import { openSavedSession } from './storage.js';
import { modeName } from './setup.js';

let available = [];
const validScore = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100;
const average = values => values.length ? values.reduce((a,b)=>a+b,0)/values.length : null;
const clean = value => String(value || '').trim().toLowerCase();
const add = (parent, tag, text) => {const node=document.createElement(tag);node.textContent=text;parent.appendChild(node);return node;};
export function comparisonStats(session) {
  const answers = (session.answers || []).filter(a=>a && typeof a==='object' && !a.skipped);
  const groups = {};
  for(const type of ['technical','behavioral','hr']) {
    const scores = answers.filter(a=>(a.interview_type || (session.settings?.interview_type !== 'mixed' ? session.settings?.interview_type : null))===type && validScore(a.score)).map(a=>a.score);
    groups[type]={count:scores.length,average:average(scores)};
  }
  const paces=answers.map(a=>a.audio?.words_per_minute).filter(v=>typeof v==='number' && Number.isFinite(v) && v>0);
  const confidence=answers.map(a=>Number(a.confidence)).filter(v=>Number.isInteger(v) && v>=1 && v<=5);
  return {
    id:session.id,date:session.date,settings:session.settings || {},total:session.total,
    submitted:answers.length,answered:answers.filter(a=>typeof a.answer==='string' && a.answer.trim()).length,
    scored:answers.filter(a=>validScore(a.score)).length,
    unscored:answers.filter(a=>!validScore(a.score)).length,
    retries:answers.filter(a=>a.retryOf).length,groups,
    pace:average(paces),paceCount:paces.length,confidence:average(confidence),confidenceCount:confidence.length,
    evaluators:[...new Set(answers.filter(a=>validScore(a.score)).map(a=>`${a.provider || 'unknown provider'} / ${a.model || 'unknown model'}`))].sort(),
  };
}
export function comparisonDifferences(a,b) {
  return [['technology','topic'],['interview_type','interview type'],['difficulty','difficulty'],['language','language'],['candidate_level','experience level'],['target_role','target role']]
    .filter(([key])=>(['technology','interview_type','difficulty','language'].includes(key) && (!clean(a.settings[key]) || !clean(b.settings[key]))) || clean(a.settings[key])!==clean(b.settings[key]))
    .map(([,label])=>label);
}
function label(s) {
  return `${new Date(s.date).toLocaleString()} · ${s.settings.technology || 'General'} · ${modeName(s.settings.interview_type)} · ${s.settings.difficulty || 'unspecified'}`;
}
export function setComparisonSessions(sessions) {
  const left=$('compare-left'),right=$('compare-right');if(!left)return;
  const previous=[left.value,right.value];
  available=sessions.map(comparisonStats);
  for(const [index,select] of [left,right].entries()) {
    select.replaceChildren(new Option('Choose a session',''));
    for(const [i,session] of available.entries())select.add(new Option(`${i+1}. ${label(session)}`,session.id));
    select.value=available.some(s=>s.id===previous[index])?previous[index]:'';
  }
  $('comparison-output').replaceChildren();
  $('comparison-status').textContent=available.length<2?'Save at least two interviews to compare them.':'Choose session A and session B. All saved sessions are available, independently of dashboard filters.';
}
export function renderComparison() {
  if(state.busy || state.recording || state.interviewSession?.active)return;
  const host=$('comparison-output');host.replaceChildren();
  const a=available.find(s=>s.id===$('compare-left').value),b=available.find(s=>s.id===$('compare-right').value);
  if(!a || !b || a.id===b.id){$('comparison-status').textContent='Choose two different saved sessions.';return;}
  const differences=comparisonDifferences(a,b);
  $('comparison-status').textContent=differences.length ? `Different or missing settings: ${differences.join(', ')}. Review the results side by side; score changes are not shown.` : 'Recorded settings match. Questions and grading may still differ; score changes describe these attempts, not proven improvement.';
  if(JSON.stringify(a.evaluators)!==JSON.stringify(b.evaluators))add(host,'p','Evaluator information differs between these sessions. Scores may reflect differences in models or providers.');
  if(a.retries || b.retries)add(host,'p','These results include retries. Prior exposure to a question can affect scores.');
  const table=add(host,'table','');table.className='dashboard-table';
  add(table,'caption','Session comparison: B minus A where shown');
  const header=add(add(table,'thead',''),'tr','');
  for(const title of ['Measure','Session A','Session B','Difference (B − A)'])add(header,'th',title).scope='col';
  const body=add(table,'tbody','');
  const row=(title,x,y,change='—')=>{const tr=add(body,'tr','');add(tr,'th',title).scope='row';add(tr,'td',x);add(tr,'td',y);add(tr,'td',change);};
  row('Session',label(a),label(b));
  row('Reviewed answers',`${a.answered} of ${a.total}`,`${b.answered} of ${b.total}`);
  row('Submitted / scored / unscored',`${a.submitted} / ${a.scored} / ${a.unscored}`,`${b.submitted} / ${b.scored} / ${b.unscored}`);
  const fmt=g=>g.average===null?'No scored answers':`${g.average.toFixed(1)}/100 (${g.count} scored)`;
  for(const type of ['technical','behavioral','hr']) {
    const x=a.groups[type],y=b.groups[type];
    const delta=!differences.length && x.average!==null && y.average!==null ? y.average-x.average : null;
    row(`${modeName(type)} average`,fmt(x),fmt(y),delta===null?'—':`${delta>0?'+':''}${delta.toFixed(1)} points`);
  }
  const metric=(value,count,unit)=>value===null?'Not available':`${value.toFixed(1)} ${unit} (${count} answers)`;
  row('Average speaking pace',metric(a.pace,a.paceCount,'words/min'),metric(b.pace,b.paceCount,'words/min'));
  row('Self-rated confidence',metric(a.confidence,a.confidenceCount,'/5'),metric(b.confidence,b.confidenceCount,'/5'));
  row('Retries included',String(a.retries),String(b.retries));
  row('Evaluators',a.evaluators.join('; ') || 'Not recorded',b.evaluators.join('; ') || 'Not recorded');
  add(host,'p','Unscored answers are excluded from score averages. Pace uses answers with available timing data; confidence is your own rating. Higher pace is not automatically better.');
  for(const [name,session] of [['A',a],['B',b]]) {
    const button=add(host,'button',`Open report ${name}`);button.type='button';button.dataset.sessionHistory='true';button.onclick=()=>openSavedSession(session.id);
  }
}
export function initComparison() {
  if(!$('compare-sessions'))return;
  $('compare-sessions').onclick=renderComparison;
  for(const id of ['compare-left','compare-right'])$(id).onchange=()=>{
    $('comparison-output').replaceChildren();$('comparison-status').textContent='Selection changed. Click Compare sessions to update the comparison.';
  };
}
