// Search saved text or an exact interview category. Recordings are never transcribed or sent anywhere here.
export function searchSavedAnswers(sessions, query) {
  const needle = String(query || '').normalize('NFKC').trim().toLocaleLowerCase();
  const category = new Map([['technical','technical'],['behavioral','behavioral'],['behavioural','behavioral'],['hr','hr'],['mixed','mixed']]).get(needle) || null;
  return sessions.filter(session => session && typeof session === 'object').map(session => {
    const matches = (Array.isArray(session.selected) ? session.selected : Array.isArray(session.answers) ? session.answers : []).filter(answer => answer && typeof answer === 'object').map(answer => {
      if (category) {
        const sessionType = session.settings?.interview_type;
        const answerType = answer.interview_type || (['technical','behavioral','hr'].includes(sessionType) ? sessionType : null);
        if (category === 'mixed' ? sessionType !== 'mixed' : answerType !== category) return null;
        return { question: answer.question || 'Untitled question', field: 'Interview type', excerpt: category === 'mixed' ? 'Mixed session' : answerType };
      }
      const fields = [
        ['Question', answer.question], ['Answer', answer.answer], ['Feedback', answer.feedback],
        ...(Array.isArray(answer.assessment?.gaps) ? answer.assessment.gaps : []).map(text => ['Gap', text]),
        ['Next step', answer.assessment?.next_step],
        ...(Array.isArray(answer.assessment?.strengths) ? answer.assessment.strengths : []).map(s => ['Strength', s?.explanation]),
      ];
      const hit = fields.find(([,value]) => typeof value === 'string' && value.normalize('NFKC').toLocaleLowerCase().includes(needle));
      if (needle && !hit) return null;
      // Show a short excerpt around the matching text; DOM consumers use textContent.
      const [field, value] = hit || ['Question', typeof answer.question === 'string' ? answer.question : ''];
      const position = value.normalize('NFKC').toLocaleLowerCase().indexOf(needle);
      const start = Math.max(0, position - 60);
      const excerpt = (start ? '…' : '') + value.slice(start, start + 240) + (value.length > start + 240 ? '…' : '');
      return { question: answer.question || 'Untitled question', field, excerpt };
    }).filter(Boolean);
    return { ...session, matches };
  }).filter(session => !needle || session.matches.length);
}
