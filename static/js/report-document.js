// Self-contained, script-free report. All saved/user text is escaped.
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const scored = a => Number.isInteger(a.score) && a.score >= 0 && a.score <= 100;
const mode = a => a.interview_type || 'technical';
const label = type => ({technical:'Technical accuracy',behavioral:'Behavioral answer quality',hr:'HR answer quality'}[type] || 'Answer quality');
const paragraph = text => `<p>${escape(text)}</p>`;
const list = items => `<ul>${items.map(x => `<li>${escape(x)}</li>`).join('')}</ul>`;

export function buildReportDocument(session) {
  const answers = Array.isArray(session.answers) ? session.answers : [];
  const settings = session.settings || {};
  const date = new Date(session.date);
  const dateText = Number.isNaN(date.getTime()) ? 'Date unavailable' : date.toLocaleString();
  const valid = answers.filter(scored);
  const summaries = ['technical','behavioral','hr'].map(type => {
    const group = valid.filter(a => mode(a) === type);
    return group.length ? `<div class="metric"><span>${label(type)}</span><strong>${(group.reduce((sum,a)=>sum+a.score,0)/group.length).toFixed(1)}<small> / 100</small></strong><span>${group.length} scored answer(s)</span></div>` : '';
  }).join('');
  const articles = answers.map((a, index) => {
    const detail = scored(a) ? a.assessment : null;
    const strengths = Array.isArray(detail?.strengths) ? detail.strengths.filter(s => s && typeof s.evidence === 'string' && s.evidence.trim() && typeof a.answer === 'string' && a.answer.includes(s.evidence) && typeof s.explanation === 'string') : [];
    const gaps = Array.isArray(detail?.gaps) ? detail.gaps.filter(g => typeof g === 'string' && g.trim()) : [];
    const coaching = Array.isArray(a.coaching) ? a.coaching.filter(c => c && typeof c.evidence === 'string' && c.evidence.trim() && typeof a.answer === 'string' && a.answer.includes(c.evidence) && typeof c.observation === 'string' && typeof c.suggestion === 'string') : [];
    const measurements = [];
    const addMetric = (name, value, unit='') => { if (typeof value === 'number' && Number.isFinite(value)) measurements.push(`${name}: ${value}${unit}`); };
    addMetric('Speaking pace',a.audio?.words_per_minute,' words/minute');
    addMetric('Recognized-word gaps of at least 1 second',a.audio?.pause_count);
    addMetric('Longest recognized-word gap',a.audio?.longest_pause_seconds,' seconds');
    addMetric('Possible fillers in original transcript',a.audio?.fillers?.count);
    addMetric('Recorded volume variation',a.audio?.levels?.variation_db,' dB');
    addMetric('Mean absolute head turn',a.head?.yaw,' degrees');
    addMetric('Mean absolute head nod',a.head?.pitch,' degrees');
    addMetric('Mean absolute head tilt',a.head?.roll,' degrees');
    if (Number.isInteger(Number(a.confidence)) && Number(a.confidence)>=1 && Number(a.confidence)<=5) measurements.push(`Self-rated confidence: ${Number(a.confidence)}/5`);
    return `<article><div class="answer-heading"><span>QUESTION ${index+1}</span><b>${escape(label(mode(a)))} · ${scored(a) ? a.score+'/100' : 'Not scored'}</b></div>
<h2>${escape(a.question || 'Question unavailable')}</h2><h3>Reviewed answer</h3>${paragraph(a.answer || 'No reviewed transcript saved.')}
<h3>Evaluation</h3>${paragraph(scored(a) ? a.feedback || 'Summary feedback unavailable.' : 'Not scored. This answer is excluded from score averages.')}
${a.provider && scored(a) ? paragraph(`Evaluator: ${a.provider}${a.model ? ' · '+a.model : ''}`) : ''}
${detail ? `<h3>Strengths</h3>${strengths.length ? strengths.map(s=>paragraph(s.explanation)+`<blockquote>${escape(s.evidence)}</blockquote>`).join('') : paragraph('No supported strengths returned.')}<h3>Required gaps / corrections</h3>${gaps.length ? list(gaps) : paragraph(a.score===100 ? 'No required gaps identified.' : 'See summary feedback for deductions.')}<h3>${a.score===100 ? 'Optional next practice' : 'Next practice step'}</h3>${paragraph(detail.next_step || 'No specific practice action returned.')}` : ''}
${coaching.length ? '<h3>Communication coaching</h3>'+coaching.map(c=>`<blockquote>${escape(c.evidence)}</blockquote>`+paragraph(c.observation)+paragraph('Try next: '+c.suggestion)).join('') : ''}
<h3>Delivery observations</h3>${measurements.length ? list(measurements) : paragraph('No delivery measurements available.')}
${paragraph(a.recording ? 'Recording saved in the app; audio is not embedded in this report.' : 'No recording attached.')}</article>`;
  }).join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>HyperSense AI — Interview report</title><style>
*{box-sizing:border-box}body{margin:0;background:#eef2f6;color:#19283b;font:16px/1.65 system-ui,-apple-system,"Segoe UI",sans-serif}main{max-width:960px;margin:36px auto;padding:48px;background:white;border-radius:18px}.brand{font-size:13px;font-weight:800;letter-spacing:.16em;color:#087568}h1{font-size:36px;line-height:1.2;margin:12px 0}h2{font-size:21px;line-height:1.5;white-space:pre-wrap}h3{font-size:15px;margin:22px 0 6px}p,li,blockquote,h2{overflow-wrap:anywhere}p{margin:8px 0;white-space:pre-wrap}.muted,footer{color:#526477;font-size:14px}.metrics{display:flex;flex-wrap:wrap;gap:12px;margin:24px 0}.metric{flex:1;min-width:190px;padding:20px;border:1px solid #cad8df;border-radius:10px}.metric span{display:block;font-size:13px}.metric strong{display:block;font-size:30px}.metric small{font-size:15px;font-weight:400}article{border-top:2px solid #dce5eb;padding:28px 0}.answer-heading{display:flex;justify-content:space-between;gap:16px;font-size:12px;color:#087568;flex-wrap:wrap}blockquote{border-left:3px solid #199c8a;margin:12px 0;padding:10px 18px;background:#f1f8f6;white-space:pre-wrap}ul{padding-left:22px}footer{border-top:1px solid #cad8df;padding-top:20px}.print-hint{background:#e7f4f0;padding:12px 16px;border-radius:8px;font-size:14px}@media(max-width:600px){main{margin:0;padding:24px;border-radius:0}h1{font-size:28px}}@page{size:A4;margin:16mm}@media print{body{background:white;font-size:11pt}main{max-width:none;padding:0;margin:0;border-radius:0}.print-hint{display:none}h1{font-size:25pt}h2,h3,.answer-heading{break-after:avoid}p,li{orphans:3;widows:3}.metric{break-inside:avoid}article{padding:20px 0}blockquote{background:white}}
</style></head><body><main><header><div class="brand">HYPERSENSE AI</div><h1>Interview practice report</h1>${paragraph(dateText)}${paragraph([settings.technology, settings.interview_type, settings.difficulty, settings.language].filter(Boolean).join(' · '))}${settings.target_role ? paragraph('Target role: '+settings.target_role) : ''}<p class="muted">${answers.length} of ${escape(session.total ?? answers.length)} questions submitted · ${valid.length} scored · ${answers.length-valid.length} unscored</p></header>
<p class="print-hint">To save as PDF, open your browser’s Print menu (Ctrl+P or Cmd+P) and choose Save as PDF. This report contains your answers; review it before sharing.</p><section class="metrics" aria-label="Scores by interview type">${summaries || '<p>No scored answers available.</p>'}</section><p class="muted">Unscored answers are excluded. Interview types use separate rubrics. Scores describe answer content, not hiring suitability.</p>${articles || paragraph('No answers saved for this session.')}<footer>Delivery measurements are separate from answer scores. Word timings are transcription estimates; gaps are not measured silence. Recognition may omit filler sounds. Head and facial movement do not establish emotion or confidence. Confidence is self-rated. This is a snapshot; later scoring or edits in the app will not update this file. Recordings are downloaded separately.</footer></main></body></html>`;
}

export function downloadReportDocument(session) {
  const url = URL.createObjectURL(new Blob([buildReportDocument(session)], {type:'text/html;charset=utf-8'}));
  const link = document.createElement('a');
  link.href = url;
  link.download = 'hypersense-interview-report.html';
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
