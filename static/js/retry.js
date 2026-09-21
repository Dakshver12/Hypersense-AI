import { state } from './state.js';
import { $, renderQuestion } from './dom.js';
import { clearAudio } from './recording.js';
import { openSinglePractice } from './navigation.js';
import { saveFinishedSession, openSavedSession } from './storage.js';
import { run } from './api.js';

// Keep the original session in storage; only a small comparison snapshot travels
// with the new answer, so retries do not duplicate recordings or résumé text.
export async function retryQuestion(session, index) {
  if (state.recording || state.interviewSession?.active) return;
  const answer = session.answers[index];
  if (!answer?.question) throw Error('This answer has no question to retry.');
  if (!(await saveFinishedSession(session)))
    throw Error('Save the original session before starting a retry.');
  state.retryContext = {
    sessionId: session.id, date: session.date, answerIndex: index,
    question: answer.question, answer: answer.answer || '',
    score: answer.score ?? null, feedback: answer.feedback || '',
    provider: answer.provider || null, model: answer.model || null,
  };
  state.current = { ...session.settings, interview_type: answer.interview_type || 'technical', question: answer.question };
  state.sessionEvaluation = null;
  renderQuestion(answer.question);
  $('question').lang = state.current.language === 'Hindi' ? 'hi' : 'en';
  $('context').textContent = 'Retry · ' + (state.current.technology || '') + ' · Same question';
  $('spoken').value = state.current.language === 'Hindi' ? 'hi' : state.current.language === 'English' ? 'en' : 'auto';
  clearAudio();
  $('transcript').value = '';
  $('result').hidden = true;
  openSinglePractice();
}

function text(parent, tag, value) {
  const node = document.createElement(tag);
  node.textContent = value;
  parent.appendChild(node);
  return node;
}

export function renderRetry(parent, session, index) {
  const answer = session.answers[index];
  const baseline = answer.retryOf;
  if (baseline && baseline.question === answer.question) {
    const box = text(parent, 'section', '');
    box.className = 'answer-assessment';
    text(box, 'h5', 'Compare with your previous attempt');
    const scored = Number.isFinite(baseline.score) && Number.isFinite(answer.score);
    text(box, 'p', scored
      ? `Previous: ${baseline.score}/100 → This attempt: ${answer.score}/100. Change: ${answer.score - baseline.score > 0 ? '+' : ''}${answer.score - baseline.score} points.`
      : 'Score comparison unavailable until both attempts are scored.');
    text(box, 'p', 'Scores are AI estimates and may vary between evaluations. Compare the explanations as well as the numbers.');
    if (baseline.provider !== answer.provider || baseline.model !== answer.model)
      text(box, 'p', 'These attempts used different or unspecified evaluators; score changes may reflect that difference.');
    const detail = text(box, 'details', '');
    text(detail, 'summary', 'Previous transcript and feedback');
    text(detail, 'p', baseline.answer || 'No transcript saved.');
    text(detail, 'p', baseline.feedback || 'No feedback saved.');
    const original = text(box, 'button', 'Open previous attempt and recording');
    original.type = 'button';
    original.onclick = () => openSavedSession(baseline.sessionId);
    text(box, 'small', 'The original recording remains in its saved session in this browser, unless you delete it.');
  }
  const button = text(parent, 'button', 'Retry this question');
  button.type = 'button';
  button.className = 'retry-question';
  button.onclick = () => run(() => retryQuestion(session, index));
}
