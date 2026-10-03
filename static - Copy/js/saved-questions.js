import { accountKey } from "./account-context.js";
import { state } from './state.js';
import { $ } from './dom.js';
import { showSetupPage } from './navigation.js';
import { refresh } from './ui.js';
import { message, modeName } from './setup.js';

export const SAVED_QUESTIONS_KEY = 'hypersense-saved-questions-v1';
const idle = () => !state.busy && !state.recording && !state.interviewSession?.active;
const clean = (v, fallback, max) => typeof v === 'string' && v.trim() ? v.trim().slice(0,max) : fallback;
export function questionBookmark(session, answer) {
  const settings=session.settings || {};
  return {
    question: clean(answer.question,'',2000),
    technology: clean(settings.technology,'General',80),
    interview_type: ['technical','behavioral','hr'].includes(answer.interview_type) ? answer.interview_type : ['technical','behavioral','hr'].includes(settings.interview_type) ? settings.interview_type : 'technical',
    difficulty: ['easy','medium','hard'].includes(settings.difficulty) ? settings.difficulty : 'easy',
    language: ['English','Hindi','Hinglish'].includes(settings.language) ? settings.language : 'English',
  };
}
const key = item => JSON.stringify([item.question.normalize('NFKC').toLowerCase().replace(/\s+/g,' '), item.technology.toLowerCase(), item.interview_type, item.difficulty, item.language]);
export function readSavedQuestions() {
  const raw=JSON.parse(localStorage.getItem(accountKey(SAVED_QUESTIONS_KEY)) || '[]');
  if(!Array.isArray(raw)) throw Error('Saved question data could not be read.');
  return raw.filter(item=>item && typeof item.question==='string' && item.question.trim()).map(item=>questionBookmark({settings:item},item));
}
export function saveQuestion(item) {
  const items=readSavedQuestions();
  if(items.some(old=>key(old)===key(item))) return false;
  if(items.length>=100) throw Error('Your list has 100 questions. Remove one before adding another.');
  localStorage.setItem(accountKey(SAVED_QUESTIONS_KEY),JSON.stringify([item,...items]));
  return true;
}
function add(parent,tag,text) {
  const el=document.createElement(tag);el.textContent=text;parent.appendChild(el);return el;
}
export function addSaveQuestionButton(parent,session,answer) {
  const item=questionBookmark(session,answer);
  if(!item.question)return;
  const button=add(parent,'button','Save question');button.type='button';
  const status=add(parent,'span','');status.setAttribute('role','status');
  button.onclick=()=>{
    if(!idle())return;
    try {
      status.textContent=saveQuestion(item)?' Question saved. Find it on your dashboard.':' This question is already saved.';
      button.textContent='Question saved';
    } catch(error) { status.textContent=' Could not save question: '+error.message; }
  };
}
export function prepareSavedQuestion(item) {
  if(!idle())return;
  showSetupPage();
  $('technology').value=item.technology;
  $('interview-type').value=item.interview_type;
  $('difficulty').value=item.difficulty;
  $('language').value=item.language;
  $('practice-focus').value='';
  $('manual-question').value=item.question;
  let node=$('manual-question');
  while(node){if(node.tagName==='DETAILS')node.open=true;node=node.parentElement;}
  refresh();
  $('manual-question').scrollIntoView({behavior:'smooth',block:'center'});
  $('manual-question').focus();
  message('Saved question ready. Check camera consent, then click the manual practice button. Answer evaluation still uses API quota.');
}
export function renderSavedQuestions() {
  const host=$('saved-questions-list');
  if(!host)return;
  host.replaceChildren();
  try {
    const items=readSavedQuestions();
    if(!items.length){add(host,'p','No saved questions yet. Open a report and choose Save question.');return;}
    for(const item of items){
      const row=add(host,'details','');
      add(row,'summary',item.question);
      add(row,'p',`${modeName(item.interview_type)} · ${item.technology} · ${item.difficulty} · ${item.language}`);
      const practice=add(row,'button','Practise this question');practice.type='button';practice.onclick=()=>prepareSavedQuestion(item);
      const remove=add(row,'button','Remove from saved questions');remove.type='button';
      remove.onclick=()=>{
        if(!idle())return;
        try {
          localStorage.setItem(accountKey(SAVED_QUESTIONS_KEY),JSON.stringify(readSavedQuestions().filter(old=>key(old)!==key(item))));
          renderSavedQuestions();
        }catch(error){add(row,'p','Could not remove question: '+error.message);}
      };
    }
  }catch(error){add(host,'p','Saved questions unavailable: '+error.message);}
}
