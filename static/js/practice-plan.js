import { state } from './state.js';
import { $ } from './dom.js';
import { showSetupPage } from './navigation.js';
import { message } from './setup.js';
import { refresh } from './ui.js';

export function practiceGoals(group) {
  const goals=[];
  for(const answer of group.recent || []) {
    if (!(typeof answer.score==='number' && answer.score>=0 && answer.score<100)) continue;
    for(const gap of answer.assessment?.gaps || []) {
      if(typeof gap !== 'string' || !gap.trim()) continue;
      const text=gap.trim().slice(0,590);
      if(!goals.some(g=>g.toLowerCase()===text.toLowerCase()))goals.push(text);
      if(goals.length===3)return goals;
    }
  }
  return goals;
}

export function prepareFocusedPractice(group) {
  if(state.busy || state.recording || state.interviewSession?.active) return;
  showSetupPage();
  $('technology').value=group.topic;
  $('interview-type').value=group.type;
  $('difficulty').value=['easy','medium','hard'].includes(group.difficulty)?group.difficulty:'easy';
  $('language').value={english:'English',hindi:'Hindi',hinglish:'Hinglish'}[group.language] || 'English';
  $('session-count').value='5';
  $('session-source').value='gemini';
  $('session-source').dispatchEvent(new Event('change'));
  const goals=practiceGoals(group);
  $('practice-focus').value=goals.join('\n');
  refresh();
  $('practice-focus').scrollIntoView({behavior:'smooth',block:'center'});
  $('practice-focus').focus();
  message(goals.length
    ? 'Five-question practice configured. Review the goals from recent feedback, then start through the camera check.'
    : 'Topic practice configured. No detailed required gaps were saved for these recent answers. Add your own goals or leave this blank.');
}
