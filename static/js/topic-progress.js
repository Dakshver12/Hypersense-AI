import { prepareFocusedPractice } from './practice-plan.js';
import { openSavedSession } from './storage.js';
import { modeName } from './setup.js';

const validScore = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100;
const clean = (value, fallback) => String(value || fallback).trim().toLowerCase();

export function topicProgress(sessions, filter = 'all', includeRetries = false) {
  const groups = new Map();
  for (const session of sessions) {
    const settings = session.settings || {};
    for (const [index, answer] of (session.answers || []).entries()) {
      const type = answer.interview_type || 'technical';
      if ((filter !== 'all' && filter !== type) || (!includeRetries && answer.retryOf)) continue;
      const parts = [clean(settings.technology, 'General'), type, clean(settings.difficulty, 'unspecified'), clean(settings.language, 'unspecified')];
      const key = JSON.stringify(parts);
      if (!groups.has(key)) groups.set(key, { topic: parts[0], type, difficulty: parts[2], language: parts[3], rows: [] });
      groups.get(key).rows.push({ ...answer, sessionId: session.id, date: session.date, index });
    }
  }
  return [...groups.values()].map(group => {
    const scored = group.rows.filter(a => validScore(a.score));
    // Missing timestamps can contribute to the overall mean but not a time trend.
    const dated = scored.filter(a => Number.isFinite(Date.parse(a.date))).sort((a,b) => Date.parse(a.date)-Date.parse(b.date) || String(a.sessionId).localeCompare(String(b.sessionId)) || a.index-b.index);
    const mean = rows => rows.length ? rows.reduce((sum,a) => sum+a.score,0)/rows.length : null;
    const latest = dated.slice(-3), previous = dated.slice(-6,-3);
    return { ...group, count: scored.length, pending: group.rows.length-scored.length,
      average: mean(scored), latest: mean(latest), change: dated.length >= 6 ? mean(latest)-mean(previous) : null,
      recent: dated.slice(-6).reverse(),
    };
  }).sort((a,b) => a.topic.localeCompare(b.topic) || a.type.localeCompare(b.type) || a.difficulty.localeCompare(b.difficulty) || a.language.localeCompare(b.language));
}

export function renderTopicProgress(parent, sessions, filter, includeRetries) {
  parent.replaceChildren();
  const add = (p,tag,value) => { const el=document.createElement(tag); el.textContent=value; p.appendChild(el); return el; };
  const groups=topicProgress(sessions,filter,includeRetries);
  if (!groups.length) { add(parent,'p','No matching attempts yet. Complete and save a new question to start tracking this topic.'); return; }
  const table=add(parent,'table',''); table.className='dashboard-table';
  const header=add(add(table,'thead',''),'tr','');
  for(const title of ['Topic / settings','Scored / pending','Average','Latest 3','Change','Review']) add(header,'th',title).scope='col';
  const body=add(table,'tbody','');
  for(const group of groups) {
    const row=add(body,'tr','');
    add(row,'td',`${group.topic} · ${modeName(group.type)} · ${group.difficulty} · ${group.language}`);
    add(row,'td',`${group.count} / ${group.pending}`);
    const score=value=>value===null?'—':value.toFixed(1)+'/100';
    add(row,'td',score(group.average));
    add(row,'td',score(group.latest));
    add(row,'td',group.change===null?'Need 6 dated, scored answers':`${group.change>0?'+':''}${group.change.toFixed(1)} points`);
    const cell=add(row,'td','');
    if (!group.recent.length) { add(cell,'span','No dated, scored answers yet.'); continue; }
    const plan=add(cell,'button','Plan focused practice');plan.type='button';
    plan.onclick=()=>prepareFocusedPractice(group);
    const detail=add(cell,'details','');add(detail,'summary','Review recent answers');
    for(const answer of group.recent) {
      add(detail,'p',`${new Date(answer.date).toLocaleDateString()} · ${answer.score}/100 · ${answer.question || 'Question'}`);
      const button=add(detail,'button','Open report');button.type='button';button.dataset.sessionHistory='true';
      button.onclick=()=>openSavedSession(answer.sessionId);
    }
  }
}
