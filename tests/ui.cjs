// Full-page integration test: npm ci, then npm test.
// All camera, audio and provider responses are simulated. No API keys needed.
const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const {JSDOM,VirtualConsole}=require('jsdom');
const {indexedDB,IDBKeyRange}=require('fake-indexeddb');
const esbuild=require('esbuild');
const root=path.resolve(__dirname,'..');
let shell=fs.readFileSync(path.join(root,'templates/index.html'),'utf8');
for(const name of ['setup','interview','dashboard','camera-check','results'])shell=shell.replace('<!-- include:'+name+' -->',fs.readFileSync(path.join(root,'templates/screens',name+'.html'),'utf8'));
const modules=fs.readdirSync(path.join(root,'static/js')).filter(n=>n.endsWith('.js')&&n!=='app.js'&&!n.endsWith('-worklet.js'));
const entry=`import './app.js';\n`+modules.map((n,i)=>`import * as m${i} from './${n}';`).join('\n')+modules.map((n,i)=>`Object.assign(window,m${i});`).join('\n')+`\nfor(const key of Object.keys(window.state))Object.defineProperty(window,key,{configurable:true,get:()=>window.state[key],set:value=>{window.state[key]=value}});`;
const bundle=esbuild.buildSync({stdin:{contents:entry,resolveDir:path.join(root,'static/js')},bundle:true,write:false,format:'iife'}).outputFiles[0].text;
shell=shell.replace(/<script type="module"[\s\S]*?<\/script>/,'');
const errors=[];
const virtualConsole=new VirtualConsole();
virtualConsole.on('jsdomError',e=>errors.push(e.message));
let denyEvaluation=false;
function createBrowser(){ return new JSDOM(shell,{
    url:'http://localhost:8000/interview',runScripts:'dangerously',pretendToBeVisual:true,virtualConsole,
    beforeParse(w){
        w.indexedDB=indexedDB;w.IDBKeyRange=IDBKeyRange;w.structuredClone=structuredClone;
        w.scrollTo=()=>{};w.HTMLElement.prototype.scrollIntoView=()=>{};
        w.HTMLMediaElement.prototype.pause=()=>{};w.HTMLMediaElement.prototype.load=()=>{};w.HTMLMediaElement.prototype.play=async()=>{};
        w.HTMLCanvasElement.prototype.getContext=()=>({clearRect(){},strokeRect(){},drawImage(){}});
        w.URL.createObjectURL=()=> 'blob:test';w.URL.revokeObjectURL=()=>{};w.confirm=()=>true;
        w.fetch=async(url)=>({ok:!denyEvaluation,status:denyEvaluation?429:200,text:async()=>JSON.stringify(denyEvaluation?{detail:'Quota reached'}:{score:0,feedback:'Missing the required explanation.',provider:'Test',model:'mock',coaching:[]})});
    }
}); }
const dom=createBrowser();
dom.window.eval(bundle);
const w=dom.window,$=id=>w.document.getElementById(id),evaluate=code=>w.eval(code);
const waitFor=async fn=>{for(let i=0;i<100;i++){if(fn())return;await new Promise(r=>setTimeout(r,10));}throw Error('UI condition timed out');};
(async()=>{
    await waitFor(()=>$('saved-session-list').textContent.includes('No completed'));
    assert.equal($('nav-practice').getAttribute('aria-current'),'page');
    $('session-questions').value='Keep my questions';$('session-source').value='gemini';$('session-source').dispatchEvent(new w.Event('change'));
    assert.equal($('manual-question-fields').hidden,true);
    $('session-source').value='manual';$('session-source').dispatchEvent(new w.Event('change'));
    assert.equal($('manual-question-fields').hidden,false);assert.equal($('session-questions').value,'Keep my questions');
    await $('camera-on').onclick();assert.equal(evaluate('state.cameraStream'),null);
    evaluate(`cameraStream={getVideoTracks:()=>[{readyState:'live',enabled:true}],getTracks:()=>[{stop(){}}]};`);
    evaluate('updatePose([[1,0,0],[0,1,0],[0,0,1]],2)');assert.equal(evaluate('state.neutralRotation'),null);
    for(let i=0;i<5;i++)evaluate('updatePose([[1,0,0],[0,1,0],[0,0,1]],1)');
    assert.equal(evaluate('cameraReady()'),true);evaluate('stopCamera()');
    evaluate('renderQuestion("Example: `items`\\n\\n```python\\nif items:\\n    print(items)\\n```\\n\\n<script>bad()</script>")');
    assert.equal($('question').querySelector('pre code').textContent,'if items:\n    print(items)');assert.equal($('question').querySelector('script'),null);
    $('nav-dashboard').click();await waitFor(()=>$('dashboard-status').textContent.includes('first saved'));
    assert.equal($('dashboard-page').hidden,false);
    await evaluate(`sessionStore('readwrite',s=>s.put({id:'seed',date:'2026-01-01T12:00:00Z',settings:{technology:'Python',difficulty:'easy',interview_type:'mixed'},total:2,answers:[{score:0,interview_type:'technical',answer:'A',question:'Q',feedback:'Test',audio:{words_per_minute:120},confidence:'2'},{score:null,interview_type:'hr',question:'HR',answer:'B'}]}))`);
    await evaluate('renderDashboard()');assert($('dashboard-types').textContent.includes('0.0/100'));
    $('dashboard-filter').value='hr';$('dashboard-filter').onchange();await waitFor(()=>$('dashboard-status').textContent.startsWith('Updated'));
    assert($('dashboard-stats').textContent.includes('Pending scores1'));
    await evaluate('openSavedSession("seed")');assert.equal($('results-page').hidden,false);
    assert($('session-report').textContent.includes('Not scored'));
    assert.equal($('export-report').disabled,false);
    {
      const note='Practise a clearer example. <script>unsafe()</script> हिंदी';
      $('session-notes-input').value=note;$('session-notes-input').dispatchEvent(new w.Event('input'));
      const leaving=new w.Event('beforeunload',{cancelable:true});w.dispatchEvent(leaving);assert(leaving.defaultPrevented);
      await w.openSavedSession('seed');assert.equal($('session-notes-input').value,note);
      await $('save-session-notes').onclick();
      assert($('session-notes-status').textContent.includes('Notes saved'));
      assert.equal((await w.sessionStore('readonly',store=>store.get('seed'))).notes,note);
      assert.equal(w.exportSessionReport(w.state.interviewSession).notes,note);
      const exported=new JSDOM(w.buildReportDocument(w.state.interviewSession)).window.document;
      assert(exported.body.textContent.includes(note));assert.equal(exported.querySelector('script'),null);
      const backup=w.parseBackup(await w.buildBackup());assert.equal(backup.sessions.find(s=>s.id==='seed').notes,note);
      const oldOpen=w.indexedDB.open;
      $('session-notes-input').value='Retry this note';$('session-notes-input').dispatchEvent(new w.Event('input'));
      w.indexedDB.open=()=>{throw Error('storage unavailable');};
      await $('save-session-notes').onclick();assert($('session-notes-status').textContent.includes('could not be saved'));
      assert.equal($('session-notes-input').value,'Retry this note');
      w.indexedDB.open=oldOpen;
      await $('save-session-notes').onclick();
      $('session-notes-input').value='';$('session-notes-input').dispatchEvent(new w.Event('input'));await $('save-session-notes').onclick();
      assert.equal((await w.sessionStore('readonly',store=>store.get('seed'))).notes,'');
      assert($('session-notes-status').textContent.includes('cleared'));
      console.log('PASS: session notes persist, survive navigation, export safely, round-trip backups and retain edits after storage failure.');
    }

    assert.equal($('download-readable-report').disabled,false);
    {
      const snapshot={date:'2026-09-24T12:00:00Z',total:3,settings:{technology:'Python',resume_text:'PRIVATE RESUME',job_description:'PRIVATE JD'},answers:[
        {interview_type:'technical',question:'<img src=x onerror=alert(1)>',answer:'Use <script>never()</script> & explain.',score:0,feedback:'Missing required detail',assessment:{strengths:[],gaps:['Explain the change'],next_step:'Practise the example'},audio:{words_per_minute:0},recording:{blob:'PRIVATE AUDIO'}},
        {interview_type:'hr',question:'Why this role?',answer:'I enjoy building tools.',score:100,feedback:'Complete',confidence:'4'},
        {interview_type:'technical',question:'Pending',answer:'हिंदी उत्तर',score:null}
      ]};
      const html=w.buildReportDocument(snapshot);
      const doc=new JSDOM(html).window.document;
      assert.equal(doc.querySelectorAll('article').length,3);
      assert.equal(doc.querySelector('script, img, audio, iframe, link'),null);
      assert(doc.body.textContent.includes('<script>never()</script>'));
      assert(doc.body.textContent.includes('हिंदी उत्तर'));
      assert(doc.body.textContent.includes('2 scored · 1 unscored'));
      assert(doc.querySelector('.metrics').textContent.includes('0.0'));
      assert(doc.querySelector('.metrics').textContent.includes('100.0'));
      assert(doc.body.textContent.includes('Speaking pace: 0 words/minute'));
      assert(!html.includes('PRIVATE RESUME'));assert(!html.includes('PRIVATE JD'));assert(!html.includes('PRIVATE AUDIO'));
      assert(w.buildReportDocument({answers:[{score:undefined},{score:NaN},{score:101}]}).includes('0 scored · 3 unscored'));
      assert(w.buildReportDocument({answers:[]}).includes('No answers saved'));
      let downloads=0, savedBlob=null;
      const oldClick=w.HTMLAnchorElement.prototype.click, oldURL=w.URL.createObjectURL;
      w.HTMLAnchorElement.prototype.click=function(){downloads++;assert.equal(this.download,'hypersense-interview-report.html');};
      w.URL.createObjectURL=blob=>{savedBlob=blob;return 'blob:report';};
      $('download-readable-report').onclick();assert.equal(downloads,1);assert(savedBlob.type.startsWith('text/html'));
      w.state.busy=true;$('download-readable-report').onclick();assert.equal(downloads,1);w.state.busy=false;
      w.HTMLAnchorElement.prototype.click=oldClick;w.URL.createObjectURL=oldURL;
      console.log('PASS: readable report preserves zero/pending scores, separates rubrics, escapes user text, excludes private context/audio and downloads with busy guard.');
    }

    $('nav-dashboard').click();await waitFor(()=>$('dashboard-status').textContent.startsWith('Updated'));
    $('dashboard-start').click();assert.equal($('dashboard-page').hidden,true);
    assert.equal($('session-setup').style.display,'block');
    // A one-question manual session with a simulated calibrated camera.
    evaluate(`cameraStream={getVideoTracks:()=>[{readyState:'live',enabled:true}],getTracks:()=>[{stop(){window.cameraStopped=true;}}]};neutralRotation=[[1,0,0],[0,1,0],[0,0,1]];`);
    $('session-count').appendChild(new w.Option('1','1'));$('session-count').value='1';$('session-source').value='manual';$('session-questions').value='Explain a Python list.';$('auto-flow').value='manual';
    evaluate('showInterviewPage()');await evaluate('startCheckedSession()');evaluate('refresh()');
    assert.equal($('session-controls').hidden,false);assert.equal($('nav-dashboard').disabled,true);
    $('transcript').value='A list stores items.';$('confidence-rating').value='4';evaluate('refresh()');
    denyEvaluation=true;await evaluate('run(submitAnswer)');assert.equal($('transcript').value,'A list stores items.');assert.equal($('transcript').disabled,false);
    assert.equal(evaluate('interviewSession.answers.length'),0);
    // Browser Back must keep the active interview visible.
    w.history.pushState({},'','/results?session=seed');await evaluate('restorePageRoute()');assert.equal($('interview-workspace').style.display,'block');
    // Continue without quota; completion releases camera and preserves rating.
    await $('session-next').onclick();await waitFor(()=>$('session-storage-status').textContent==='Session and recordings saved in this browser.');
    assert.equal(w.cameraStopped,true);assert.equal($('results-page').hidden,false);assert.equal(evaluate('interviewSession.answers[0].confidence'),'4');
    assert.equal(evaluate('interviewSession.answers[0].score'),null);
    denyEvaluation=false;await evaluate('scorePendingAnswers()');assert.equal(evaluate('interviewSession.answers[0].score'),0);
    const id=evaluate('interviewSession.id');await evaluate(`openSavedSession(${JSON.stringify(id)})`);assert($('session-report').textContent.includes('0/100'));
    await evaluate(`deleteSavedSession(${JSON.stringify(id)})`);assert.equal(await evaluate(`sessionStore('readonly',s=>s.get(${JSON.stringify(id)}))`),undefined);
    // Early completion and a blocked navigation while the session is active.
    evaluate(`cameraStream={getVideoTracks:()=>[{readyState:'live',enabled:true}],getTracks:()=>[{stop(){window.cameraStopped=true;}}]};neutralRotation=[[1,0,0],[0,1,0],[0,0,1]];`);
    $('session-count').appendChild(new w.Option('2','2'));$('session-count').value='2';$('session-questions').value='First question\n---\nSecond question';
    evaluate('showInterviewPage()');await evaluate('startCheckedSession()');evaluate('refresh()');$('transcript').value='Early answer';
    evaluate('showDashboard()');assert.equal($('dashboard-page').hidden,true);
    $('session-end').click();await waitFor(()=>$('session-storage-status').textContent==='Session and recordings saved in this browser.');
    assert.equal(evaluate('interviewSession.answers.length'),1);assert.equal(evaluate('interviewSession.total'),2);assert.equal(evaluate('cameraStream'),null);
    $('nav-practice').click();$('manual-question').value='Single question';
    $('camera-consent').checked=false;$('use-manual').click();assert.equal(w.state.current,null);
    assert($('single-practice-status').textContent.includes('consent'));
    $('single-camera-consent').checked=true;$('single-camera-consent').dispatchEvent(new w.Event('change'));assert.equal($('camera-consent').checked,true);
    const originalCameraOn=$('camera-on').onclick;$('camera-on').onclick=()=>{};
    $('use-manual').click();assert.equal($('camera-check-page').hidden,false);assert.equal(w.state.current.question,'Single question');assert.equal(w.state.ticker,null);
    w.state.cameraStream={getVideoTracks:()=>[{readyState:'live',enabled:true}],getTracks:()=>[{stop(){}}]};w.state.neutralRotation=[[1,0,0],[0,1,0],[0,0,1]];
    await $('camera-check-continue').onclick();assert.equal($('interview-workspace').style.display,'block');assert.equal(w.state.current.question,'Single question');assert.equal(w.state.interviewSession?.active,false);
    $('transcript').value='Preserve my answer';w.state.deadline=Date.now()+25000;
    w.showCameraCheck(false);assert.equal(w.state.ticker,null);const remaining=w.state.singleRemaining;
    $('camera-check-back').click();assert.equal($('interview-workspace').style.display,'block');assert.equal($('transcript').value,'Preserve my answer');assert.equal(w.state.current.question,'Single question');assert(w.state.deadline-Date.now()<=remaining);
    $('camera-on').onclick=originalCameraOn;w.state.singlePractice=false;w.stopCamera();clearInterval(w.state.ticker);w.state.ticker=null;

    const assessmentHost=w.document.createElement('div');
    const assessed={score:50,answer:'Lists are mutable.',assessment:{strengths:[{evidence:'Lists are mutable.',explanation:'Correct.'},{evidence:'invented quote',explanation:'Must not render'}],gaps:['Explain tuple mutability.'],next_step:'Compare both in one sentence.'}};
    w.renderAnswerAssessment(assessmentHost,assessed);
    assert(assessmentHost.textContent.includes('Explain tuple mutability.'));
    assert(!assessmentHost.textContent.includes('Must not render'));
    assert(assessmentHost.textContent.includes('Compare both in one sentence.'));
    const legacyHost=w.document.createElement('div');w.renderAnswerAssessment(legacyHost,{score:0});assert(legacyHost.textContent.includes('summary feedback only'));
    const pendingHost=w.document.createElement('div');w.renderAnswerAssessment(pendingHost,{score:null});assert.equal(pendingHost.textContent,'');
    const fullHost=w.document.createElement('div');w.renderAnswerAssessment(fullHost,{score:100,answer:'Correct',assessment:{strengths:[],gaps:[],next_step:'Try another question.'}});assert(fullHost.textContent.includes('Optional next practice'));
    const exported=w.exportSessionReport({settings:{},answers:[assessed]});assert.deepEqual(exported.answers[0].assessment,assessed.assessment);
    // Audio-derived answers require confirmation, including unscored archival.
    w.state.interviewSession=null;w.state.current={question:'Review test',auto_flow:true};
    w.state.speechPending=false;w.state.busy=false;w.state.answerSubmitted=false;
    w.setAudio(new w.Blob(['audio'],{type:'audio/webm'}),'review.webm');
    $('transcript').value='A list is mutable.';$('transcript').dispatchEvent(new w.Event('input'));
    assert.equal($('evaluate').disabled,true);
    await assert.rejects(()=>w.submitAnswer(),/confirm/);
    $('transcript-confirm').checked=true;$('transcript-confirm').dispatchEvent(new w.Event('change'));
    assert.equal(w.transcriptApproved(),true);assert.equal($('evaluate').disabled,false);
    $('transcript').value='A tuple is immutable.';$('transcript').dispatchEvent(new w.Event('input'));
    assert.equal(w.transcriptApproved(),false);
    w.state.interviewSession={active:true,loaded:true,answers:[]};
    await assert.rejects(()=>w.archiveSessionAnswer(),/confirm/);assert.equal(w.state.interviewSession.answers.length,0);
    w.state.interviewSession=null;
    const originalFetch=w.fetch;let evaluationRequests=0;
    w.fetch=async url=>{if(url==='/evaluate-answer')evaluationRequests++;return {ok:true,status:200,text:async()=>JSON.stringify({text:'Recognized answer',delivery:null})};};
    w.cancelAutomation();w.state.automationPaused=false;
    await w.autoProcessRecording();
    assert.equal($('transcript').value,'Recognized answer');assert.equal(evaluationRequests,0);
    assert.equal(w.state.automationTimer,null);assert.equal($('transcript-confirm').checked,false);
    assert($('automation-status').textContent.includes('Review, confirm'));
    w.fetch=originalFetch;w.clearAudio();
    assert.equal(w.transcriptApproved(),true); // Typed answers require no audio confirmation.
    console.log('PASS: review gate, edit invalidation, unscored submission gate and automatic transcription without submission.');
    // Refresh into a new window sharing only IndexedDB, including stored audio.
    await evaluate(`draftStore('readwrite',s=>s.clear())`);
    w.state.interviewSession={id:'recovery-test',date:new Date().toISOString(),active:true,loaded:true,total:2,source:'manual',questions:['First','Second'],settings:{technology:'Python',difficulty:'easy',language:'English',interview_type:'technical',auto_flow:false,resume_text:'private resume'},answers:[{question:'First',answer:'Saved answer',score:100,recording:{blob:new Blob(['audio bytes'],{type:'audio/webm'}),name:'answer-01.webm',bytes:11,url:'blob:expired'}}]};
    w.state.current={...w.state.interviewSession.settings,question:'Second'};
    await w.checkpointSession();
    const draft=await w.draftStore('readonly',s=>s.get('active'));
    assert.equal(draft.settings.resume_text,undefined);assert.equal(draft.pendingQuestion.resume_text,undefined);
    assert.equal(draft.answers[0].recording.url,undefined);
    const reloaded=createBrowser(),rw=reloaded.window;
    rw.eval(bundle);
    await waitFor(()=>!rw.document.getElementById('session-recovery').hidden);
    await assert.rejects(()=>rw.resumeSessionDraft(),/consent/);
    rw.document.getElementById('recovery-consent').checked=true;
    rw.document.getElementById('camera-on').onclick=()=>{};
    await rw.resumeSessionDraft();
    assert.equal(rw.state.interviewSession.answers[0].answer,'Saved answer');
    assert.equal(await rw.state.interviewSession.answers[0].recording.blob.text(),'audio bytes');
    assert.equal(rw.state.neutralRotation,null);
    rw.state.cameraStream={getVideoTracks:()=>[{readyState:'live',enabled:true}],getTracks:()=>[{stop(){}}]};
    rw.state.neutralRotation=[[1,0,0],[0,1,0],[0,0,1]];
    await rw.loadSessionQuestion();
    assert.equal(rw.state.current.question,'Second');assert.equal(rw.state.interviewSession.answers.length,1);
    const workingDB=rw.indexedDB;rw.indexedDB={open(){throw Error('Storage unavailable')}};
    await assert.rejects(()=>rw.checkpointSession(),/Could not save progress/);
    assert.equal(rw.state.interviewSession.answers[0].answer,'Saved answer');rw.indexedDB=workingDB;
    await rw.clearSessionDraft('different-session');assert(await rw.draftStore('readonly',s=>s.get('active')));
    await rw.clearSessionDraft('recovery-test');assert.equal(await rw.draftStore('readonly',s=>s.get('active')),undefined);
    reloaded.window.close();
    console.log('PASS: refresh recovery, audio persistence, consent gate, question continuation, résumé exclusion and storage failures.');
    // Retry preserves the original recording and compares a separately saved answer.
    const retryBrowser=createBrowser(),tw=retryBrowser.window;
    tw.eval(bundle);
    await waitFor(()=>tw.document.getElementById('saved-session-list').textContent.length>0);
    tw.document.getElementById('camera-on').onclick=()=>{};
    const original={id:'retry-original',date:new Date().toISOString(),total:1,active:false,settings:{technology:'Python',difficulty:'easy',language:'English',interview_type:'technical',auto_flow:false},answers:[{question:'Explain lists.',answer:'Original answer',score:40,feedback:'Explain mutability.',recording:{blob:new Blob(['original audio']),name:'original.webm',bytes:14}}]};
    tw.state.interviewSession=original;
    await tw.retryQuestion(original,0);
    assert.equal(tw.state.current.question,'Explain lists.');
    assert.equal(tw.document.getElementById('camera-check-page').hidden,false);
    assert.equal(tw.document.getElementById('transcript').value,'');
    assert.equal(tw.state.retryContext.score,40);
    tw.state.cameraStream={getVideoTracks:()=>[{readyState:'live',enabled:true}],getTracks:()=>[{stop(){}}]};
    tw.state.neutralRotation=[[1,0,0],[0,1,0],[0,0,1]];
    tw.state.deadline=Date.now()+60000;
    tw.document.getElementById('transcript').value='Lists are mutable.';
    tw.fetch=async()=>({ok:true,status:200,text:async()=>JSON.stringify({score:90,feedback:'Correct explanation.'})});
    await tw.submitAnswer();
    await waitFor(()=>tw.state.sessionSavePending===null);
    assert.notEqual(tw.state.interviewSession.id,original.id);
    assert(tw.document.getElementById('session-report').textContent.includes('Change: +50 points'));
    const kept=await tw.sessionStore('readonly',s=>s.get('retry-original'));
    assert.equal(kept.answers[0].answer,'Original answer');
    assert.equal(await kept.answers[0].recording.blob.text(),'original audio');
    const retried=await tw.sessionStore('readonly',s=>s.get(tw.state.interviewSession.id));
    assert.equal(retried.answers[0].retryOf.sessionId,'retry-original');
    await tw.openSavedSession(retried.id);
    assert(tw.document.getElementById('session-report').textContent.includes('Change: +50 points'));
    tw.showSetupPage();assert.equal(tw.state.retryContext,null);
    const retryDB=tw.indexedDB;tw.indexedDB={open(){throw Error('Unavailable')}};
    await assert.rejects(()=>tw.retryQuestion(original,0),/Save the original/);
    assert.equal(tw.state.current,null);tw.indexedDB=retryDB;
    retryBrowser.window.close();
    console.log('PASS: retry camera gate, separate saved attempt, score comparison after reload, original audio preservation and storage failure gate.');
    const trendSessions=[0,20,40,60,80,100].map((score,i)=>({id:'trend-'+i,date:`2026-02-0${i+1}T12:00:00Z`,settings:{technology:i%2?'Python':' python ',difficulty:'easy',language:'English'},answers:[{question:'Q'+i,score,interview_type:'technical'}]}));
    const trends=w.topicProgress([...trendSessions].reverse());
    assert.equal(trends.length,1);assert.equal(trends[0].average,50);assert.equal(trends[0].change,60);
    assert.equal(w.topicProgress(trendSessions.slice(0,5))[0].change,null);
    const retryTrend={...trendSessions[0],id:'trend-retry',answers:[{score:100,retryOf:{sessionId:'old'}}]};
    assert.equal(w.topicProgress([...trendSessions,retryTrend])[0].count,6);
    assert.equal(w.topicProgress([...trendSessions,retryTrend],'all',true)[0].count,7);
    assert.equal(w.topicProgress(trendSessions,'hr').length,0);
    const pendingTrend={...trendSessions[0],answers:[{score:null},{score:'100'},{score:NaN}]};
    assert.equal(w.topicProgress([pendingTrend])[0].pending,3);assert.equal(w.topicProgress([pendingTrend])[0].average,null);
    assert.equal(w.topicProgress([...trendSessions,{...trendSessions[0],settings:{technology:'Python',difficulty:'hard',language:'English'}}]).length,2);
    assert.equal(w.topicProgress([{...trendSessions[0],date:'unknown'}])[0].latest,null);
    w.state.interviewSession=null;w.state.current=null;w.state.busy=false;
    await w.sessionStore('readwrite',store=>store.clear());
    for(const session of trendSessions)await w.sessionStore('readwrite',store=>store.put(session));
    $('dashboard-filter').value='technical';$('dashboard-topic').value='';
    await w.renderDashboard();
    assert($('dashboard-topics').textContent.includes('+60.0 points'));
    assert($('dashboard-topics').querySelector('details button'));
    $('dashboard-filter').value='hr';await w.renderDashboard();
    assert(!$('dashboard-topics').textContent.includes('+60.0 points'));
    console.log('PASS: topic trend ordering, zero and pending scores, minimum sample size, retry exclusion, setting groups and dashboard filters.');
    const focusedGroup={topic:'Python',type:'technical',difficulty:'medium',language:'english',recent:[{score:100,assessment:{gaps:['Ignore full-credit gap']}},{score:null,assessment:{gaps:['Ignore pending']}},{score:50,assessment:{gaps:['Explain mutability.','Explain mutability.','Give the required example.']}}]};
    assert.equal(w.practiceGoals(focusedGroup).length,2);
    w.prepareFocusedPractice(focusedGroup);
    assert.equal($('session-count').value,'5');assert.equal($('difficulty').value,'medium');
    assert.equal($('practice-focus').value,'Explain mutability.\nGive the required example.');
    assert.equal(w.interviewSettings().practice_focus,$('practice-focus').value);
    assert.equal($('session-setup').style.display,'block');
    assert.equal(w.state.current,null); // Setup does not start camera or generation.
    let focusPayload;
    const focusFetch=w.fetch;
    w.fetch=async(url,options)=>{focusPayload=JSON.parse(options.body);return {ok:true,status:200,text:async()=>JSON.stringify({question:'A new focused question'})};};
    $('camera-consent').checked=true;$('single-camera-consent').checked=true;
    $('camera-on').onclick=()=>{};
    await $('generate').onclick();
    assert.equal(focusPayload.practice_focus,'Explain mutability.\nGive the required example.');
    assert.equal(focusPayload.difficulty,'medium');
    w.fetch=focusFetch;w.showSetupPage();
    w.prepareFocusedPractice({...focusedGroup,recent:[]});assert.equal($('practice-focus').value,'');
    console.log('PASS: focused goals exclude full-credit/pending answers, deduplicate, configure setup and reach question generation.');
    const searchSeed={id:'search-test',date:'2026-04-01T12:00:00Z',total:2,settings:{technology:'Python',difficulty:'easy'},answers:[{question:'Explain a list.',answer:'A LIST is mutable.',feedback:'Correct.',score:100,interview_type:'technical'},{question:'Describe teamwork.',answer:'We shared the work.',feedback:'Add a result.',score:60,interview_type:'hr',assessment:{gaps:['Describe the outcome.']}}]};
    assert.equal(w.searchSavedAnswers([searchSeed],'  MUTABLE  ')[0].matches.length,1);
    assert.equal(w.searchSavedAnswers([searchSeed],'outcome')[0].matches[0].field,'Gap');
    assert.equal(w.searchSavedAnswers([searchSeed],'notpresent').length,0);
    assert.equal(w.searchSavedAnswers([searchSeed],'').length,1);
    await w.sessionStore('readwrite',store=>store.put(searchSeed));
    w.state.interviewSession=null;w.state.busy=false;
    $('dashboard-filter').value='all';$('dashboard-topic').value='';$('history-search').value='';
    await w.renderDashboard();
    $('history-search').value='outcome';
    $('history-search').dispatchEvent(new w.Event('input',{bubbles:true}));
    await waitFor(()=>$('history-search-status').textContent==='1 matching sessions · 1 matching answers.');
    assert.equal($('history-search-status').textContent,'1 matching sessions · 1 matching answers.');
    assert($('dashboard-sessions').textContent.includes('Describe the outcome.'));
    const stats=$('dashboard-stats').textContent;
    $('history-search').value='<script>notfound</script>';await w.renderDashboard();
    assert($('history-search-status').textContent.startsWith('0 matching'));
    assert.equal($('dashboard-stats').textContent,stats);
    assert.equal($('dashboard-sessions').querySelector('script'),null);
    $('history-search').value='outcome';$('dashboard-filter').value='technical';await w.renderDashboard();
    assert($('history-search-status').textContent.startsWith('0 matching'));
    $('dashboard-filter').value='hr';await w.renderDashboard();
    $('dashboard-sessions').querySelector('button').click();
    await waitFor(()=>w.state.interviewSession?.id==='search-test');
    assert.equal($('results-page').hidden,false);
    $('history-search-clear').click();await waitFor(()=>$('history-search-status').textContent.includes('sessions shown'));
    assert.equal($('history-search').value,'');
    console.log('PASS: saved text search, case/whitespace, gaps, empty results, type filters, unchanged metrics and opening matching reports.');
    assert.equal(w.searchSavedAnswers([{answers:[null,{question:'Legacy',assessment:{gaps:'old',strengths:{}}}]}],'legacy').length,1);
    $('dashboard-filter').value='all';await $('dashboard-filter').onchange();$('history-search').value='mutable';
    await $('history-search-submit').onclick();
    assert($('history-search-status').textContent.startsWith('1 matching'));
    $('history-search').value='no such saved text';
    $('history-search').dispatchEvent(new w.KeyboardEvent('keydown',{key:'Enter',bubbles:true}));
    await waitFor(()=>$('history-search-status').textContent.startsWith('0 matching'));
    const searchDB=w.indexedDB;w.indexedDB={open(){throw Error('Storage unavailable')}};
    await w.renderDashboard();
    assert($('history-search-status').textContent.includes('Search could not complete'));
    w.indexedDB=searchDB;
    console.log('PASS: explicit Search, Enter, legacy assessment data and visible storage errors.');
    await w.renderDashboard();
    const stableStats=$('dashboard-stats').firstElementChild;
    const stableTrends=$('dashboard-topics').firstElementChild;
    const loadBefore=w.state.dashboardLoad;
    const savedDB=w.indexedDB;let reads=0;
    w.indexedDB={open(){reads++;throw Error('Typing must use loaded history')}};
    $('history-search').focus();
    $('history-search').value='mut';$('history-search').dispatchEvent(new w.Event('input'));
    $('history-search').value='mutable';$('history-search').dispatchEvent(new w.Event('input'));
    await waitFor(()=>$('history-search-status').textContent.startsWith('1 matching'));
    assert.equal(reads,0);assert.equal(w.state.dashboardLoad,loadBefore);
    assert.equal($('dashboard-stats').firstElementChild,stableStats);
    assert.equal($('dashboard-topics').firstElementChild,stableTrends);
    assert.equal(w.document.activeElement,$('history-search'));
    w.indexedDB=savedDB;
    console.log('PASS: typing preserves dashboard nodes and focus, with no database reload.');
    const categorySessions=[
      {id:'behavior',settings:{interview_type:'behavioral'},answers:[{question:'Explain a technical challenge',interview_type:'behavioral'}]},
      {id:'tech',settings:{interview_type:'technical'},answers:[{question:'List mutability'}]},
      {id:'mix',settings:{interview_type:'mixed'},answers:[{question:'Python',interview_type:'technical'},{question:'Teamwork',interview_type:'behavioral'},{question:'Motivation',interview_type:'hr'}]},
    ];
    const technicalMatches=w.searchSavedAnswers(categorySessions,' Technical ');
    assert.equal(technicalMatches.length,2);assert.equal(technicalMatches[0].id,'tech');
    assert.equal(technicalMatches[1].matches.length,1);
    assert.equal(w.searchSavedAnswers(categorySessions,'behavioral').length,2);
    assert.equal(w.searchSavedAnswers(categorySessions,'behavioural').length,2);
    assert.equal(w.searchSavedAnswers(categorySessions,'HR')[0].matches.length,1);
    assert.equal(w.searchSavedAnswers(categorySessions,'mixed')[0].matches.length,3);
    assert.equal(w.searchSavedAnswers(categorySessions,'technical challenge')[0].id,'behavior');
    console.log('PASS: category search uses answer type, handles mixed sessions, and preserves ordinary text search.');
    w.state.interviewSession=null;w.state.busy=false;w.state.recording=false;
    const bookmark=w.questionBookmark({settings:{technology:'Python',difficulty:'medium',language:'Hindi',resume_text:'private'}},{question:'Explain lists.',interview_type:'technical'});
    assert.equal(w.saveQuestion(bookmark),true);assert.equal(w.saveQuestion(bookmark),false);
    assert.equal(w.readSavedQuestions().length,1);
    assert(!w.localStorage.getItem(w.SAVED_QUESTIONS_KEY).includes('private'));
    w.renderSavedQuestions();assert($('saved-questions-list').textContent.includes('Explain lists.'));
    $('saved-questions-list').querySelector('button').click();
    assert.equal($('manual-question').value,'Explain lists.');assert.equal($('language').value,'Hindi');
    assert.equal($('manual-question').closest('details').open,true);
    assert.equal(w.state.current,null);
    $('saved-questions-list').querySelectorAll('button')[1].click();assert.equal(w.readSavedQuestions().length,0);
    w.localStorage.setItem(w.SAVED_QUESTIONS_KEY,'invalid JSON');w.renderSavedQuestions();
    assert($('saved-questions-list').textContent.includes('unavailable'));
    w.localStorage.removeItem(w.SAVED_QUESTIONS_KEY);
    console.log('PASS: saved question deduplication, privacy, setup handoff, removal and invalid storage handling.');
    // Backup round-trip uses real structured-clone-compatible Blobs with simulated file reads.
    w.Blob=Blob;
    w.FileReader=class {
      readAsDataURL(blob){blob.arrayBuffer().then(bytes=>{this.result='data:'+blob.type+';base64,'+Buffer.from(bytes).toString('base64');this.onload();}).catch(()=>this.onerror());}
      readAsText(blob){blob.text().then(text=>{this.result=text;this.onload();}).catch(()=>this.onerror());}
    };
    await w.sessionStore('readwrite',store=>store.clear());
    const backupSession={id:'backup-test',date:'2026-09-22T12:00:00Z',total:1,settings:{technology:'Python',interview_type:'technical',resume_text:'SECRET RESUME'},answers:[{question:'Explain a list.',answer:'It is mutable.',score:80,feedback:'Explain with an example.',recording:{blob:new Blob(['audio bytes'],{type:'audio/webm'}),name:'answer.webm',bytes:11}}]};
    await w.sessionStore('readwrite',store=>store.put(backupSession));
    w.saveQuestion(w.questionBookmark(backupSession,backupSession.answers[0]));
    const backupText=await w.buildBackup();
    assert(!backupText.includes('SECRET RESUME'));
    const parsed=w.parseBackup(backupText);
    assert.equal(await parsed.sessions[0].answers[0].recording.blob.text(),'audio bytes');
    await w.sessionStore('readwrite',store=>store.clear());w.localStorage.removeItem(w.SAVED_QUESTIONS_KEY);
    const restored=await w.restoreBackup(parsed);assert.equal(restored.added,1);assert.equal(restored.questionsAdded,1);
    const loaded=await w.sessionStore('readonly',store=>store.get('backup-test'));
    assert.equal(await loaded.answers[0].recording.blob.text(),'audio bytes');assert.equal(loaded.answers[0].score,80);
    parsed.sessions[0].answers[0].score=1;
    const twice=await w.restoreBackup(parsed);assert.equal(twice.added,0);assert.equal(twice.skipped,1);assert.equal(twice.questionsSkipped,1);
    assert.equal((await w.sessionStore('readonly',store=>store.get('backup-test'))).answers[0].score,80);
    for(const mutate of [d=>d.version=99,d=>d.sessions[0].answers[0].score=101,d=>d.sessions[0].answers[0].recording.base64='!bad',d=>d.sessions.push(d.sessions[0]),d=>d.savedQuestions=[null]]){
      const bad=JSON.parse(backupText);mutate(bad);assert.throws(()=>w.parseBackup(JSON.stringify(bad)));
    }
    assert.throws(()=>w.parseBackup('invalid JSON'));
    assert.throws(()=>w.parseBackup('{"__proto__":{}}'));
    w.state.busy=true;await $('backup-export').onclick();assert($('backup-status').textContent.includes('Finish'));w.state.busy=false;
    await $('backup-import').onclick();assert($('backup-status').textContent.includes('Choose a backup'));
    // Bookmark storage failure reports partial completion without rolling back saved sessions.
    w.localStorage.setItem(w.SAVED_QUESTIONS_KEY,'invalid');
    const partial=await w.restoreBackup(w.parseBackup(backupText));assert(partial.questionError);assert.equal(partial.skipped,1);
    w.localStorage.removeItem(w.SAVED_QUESTIONS_KEY);
    console.log('PASS: backup audio round-trip, resume exclusion, restore deduplication, invalid input, busy guard and partial question-storage failure.');
    // Named setups preserve consent and private form contents and never start a session.
    w.state.interviewSession=null;w.state.busy=false;w.state.recording=false;
    $('interview-type').value='mixed';$('technology').value='Python';$('difficulty').value='medium';$('language').value='Hindi';
    $('duration').value='90';$('session-count').value='5';$('candidate-level').value='entry';$('auto-flow').value='manual';$('target-role').value='ML Intern';
    $('resume-text').value='PRIVATE RESUME';$('job-description').value='PRIVATE JOB';$('camera-consent').checked=false;
    $('preset-name').value='My interview';$('preset-save').click();
    assert.equal(w.readPresets().length,1);assert(!$('preset-status').textContent.includes('Invalid'));
    assert(!w.localStorage.getItem(w.PRESETS_KEY).includes('PRIVATE'));
    const preset=w.readPresets()[0];assert.equal(w.savePreset({...preset,name:'MY INTERVIEW'}),false);
    $('technology').value='Java';$('language').value='English';$('preset-load').click();
    assert.equal($('technology').value,'Python');assert.equal($('language').value,'Hindi');assert.equal($('duration').value,'90');
    assert.equal($('resume-text').value,'PRIVATE RESUME');assert.equal($('job-description').value,'PRIVATE JOB');assert.equal($('camera-consent').checked,false);
    assert.equal(w.state.interviewSession,null);
    $('technology').value='SQL';$('preset-update').click();assert.equal(w.readPresets()[0].settings.technology,'SQL');
    w.state.interviewSession={active:true};$('technology').value='Do not change';$('preset-load').click();assert.equal($('technology').value,'Do not change');w.state.interviewSession=null;
    const withSetups=await w.buildBackup();assert.equal(w.parseBackup(withSetups).savedSetups.length,1);
    const legacyBackup=JSON.parse(withSetups);delete legacyBackup.savedSetups;assert.equal(w.parseBackup(JSON.stringify(legacyBackup)).savedSetups.length,0);
    w.localStorage.removeItem(w.PRESETS_KEY);const restoredSetups=await w.restoreBackup(w.parseBackup(withSetups));assert.equal(restoredSetups.setupsAdded,1);
    assert.equal((await w.restoreBackup(w.parseBackup(withSetups))).setupsSkipped,1);
    w.renderPresets('My interview');$('preset-delete').click();assert.equal(w.readPresets().length,0);
    assert((await w.sessionStore('readonly',store=>store.get('backup-test'))));
    assert.throws(()=>w.validatePreset({...preset,settings:{...preset.settings,duration:'bad'}}));
    w.localStorage.setItem(w.PRESETS_KEY,'bad JSON');$('preset-save').click();assert($('preset-status').textContent);w.localStorage.removeItem(w.PRESETS_KEY);
    console.log('PASS: saved setups load/update/delete, private-data exclusion, consent preservation, active-session guard, backups and legacy backup support.');
    {
    // Session comparison separates rubrics and keeps zero scores, missing data and retries explicit.
    const compareSettings={technology:'Python',interview_type:'mixed',difficulty:'easy',language:'English'};
    const first={id:'compare-a',date:'2026-09-20T12:00:00Z',settings:compareSettings,total:3,answers:[
      {question:'Q1',answer:'A',interview_type:'technical',score:0,audio:{words_per_minute:120},confidence:'2',provider:'Test',model:'v1'},
      {question:'Q2',answer:'B',interview_type:'hr',score:80,provider:'Test',model:'v1'},
      {question:'Q3',answer:'',interview_type:'technical',score:null}]};
    const second={id:'compare-b',date:'2026-09-22T12:00:00Z',settings:{...compareSettings},total:2,answers:[
      {question:'Q1',answer:'C',interview_type:'technical',score:60,audio:{words_per_minute:140},confidence:'4',retryOf:{sessionId:'compare-a'},provider:'Test',model:'v2'},
      {question:'Q2',answer:'D',interview_type:'hr',score:null}]};
    const stats=w.comparisonStats(first);assert.equal(stats.groups.technical.average,0);assert.equal(stats.groups.hr.average,80);
    assert.equal(stats.answered,2);assert.equal(stats.unscored,1);assert.equal(stats.pace,120);assert.equal(stats.confidence,2);
    assert.equal(w.comparisonDifferences(stats,w.comparisonStats(second)).length,0);
    w.setComparisonSessions([second,first]);$('compare-left').value='compare-a';$('compare-right').value='compare-b';$('compare-sessions').click();
    assert($('comparison-output').textContent.includes('+60.0 points'));
    assert($('comparison-output').textContent.includes('Evaluator information differs'));
    assert($('comparison-output').textContent.includes('include retries'));
    assert($('comparison-output').textContent.includes('No scored answers'));
    const foreign={...second,settings:{...compareSettings,difficulty:'hard'}};
    w.setComparisonSessions([first,foreign]);assert.equal($('compare-left').value,'compare-a');$('compare-sessions').click();
    assert($('comparison-status').textContent.includes('difficulty'));assert(!$('comparison-output').textContent.includes('+60.0 points'));
    $('compare-right').value='compare-a';$('compare-sessions').click();assert($('comparison-status').textContent.includes('two different'));assert.equal($('comparison-output').children.length,0);
    w.setComparisonSessions([first]);assert.equal($('compare-right').value,'compare-a');assert($('comparison-status').textContent.includes('at least two'));
    w.setComparisonSessions([]);assert.equal($('compare-left').value,'');assert.equal($('compare-right').value,'');
    await w.sessionStore('readwrite',store=>store.put(first));await w.sessionStore('readwrite',store=>store.put(second));
    await w.renderDashboard();$('compare-left').value='compare-a';$('compare-right').value='compare-b';$('compare-sessions').click();
    $('comparison-output').querySelector('button').click();await waitFor(()=>w.state.interviewSession?.id==='compare-a');
    assert.equal($('results-page').hidden,false);w.state.interviewSession=null;
    console.log('PASS: session comparison zero/pending scores, separate rubrics, settings warnings, retry/evaluator caveats, selection handling and report links.');
    }
    // Tab switching preserves live controls/results instead of rebuilding the dashboard.
    {
      const sections=['overview','sessions','questions','backup'];
      const shown=()=>sections.filter(name=>!$('dashboard-panel-'+name).hidden);
      assert.deepEqual(shown(),['overview']);
      $('history-search').value='preserve my search';
      const comparisonNode=$('comparison-output');
      const originalOpen=w.indexedDB.open;let tabDbReads=0;
      w.indexedDB.open=function(...args){tabDbReads++;return originalOpen.apply(this,args);};
      for(const name of sections){
        $('dashboard-tab-'+name).click();assert.deepEqual(shown(),[name]);
        assert.equal($('dashboard-tab-'+name).getAttribute('aria-selected'),'true');
        assert.equal(sections.filter(s=>$('dashboard-tab-'+s).tabIndex===0).length,1);
        assert.equal($('dashboard-shared-filters').hidden,!['overview','sessions'].includes(name));
      }
      assert.equal(tabDbReads,0);w.indexedDB.open=originalOpen;
      assert.equal($('history-search').value,'preserve my search');assert.equal($('comparison-output'),comparisonNode);
      $('dashboard-tab-backup').dispatchEvent(new w.KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}));
      assert.deepEqual(shown(),['overview']);assert.equal(w.document.activeElement.id,'dashboard-tab-overview');
      $('dashboard-tab-overview').dispatchEvent(new w.KeyboardEvent('keydown',{key:'ArrowLeft',bubbles:true}));assert.deepEqual(shown(),['backup']);
      $('dashboard-tab-backup').dispatchEvent(new w.KeyboardEvent('keydown',{key:'Home',bubbles:true}));assert.deepEqual(shown(),['overview']);
      $('dashboard-tab-overview').dispatchEvent(new w.KeyboardEvent('keydown',{key:'End',bubbles:true}));assert.deepEqual(shown(),['backup']);
      w.selectDashboardTab('invalid');assert.deepEqual(shown(),['backup']);
      assert($('dashboard-panel-sessions').contains($('history-search')));assert($('dashboard-panel-sessions').contains($('compare-sessions')));
      assert($('dashboard-panel-questions').contains($('saved-questions-list')));assert($('dashboard-panel-backup').contains($('backup-export')));
      $('history-search').value='';await w.renderDashboard();assert.deepEqual(shown(),['backup']);
      w.selectDashboardTab('overview');
      console.log('PASS: dashboard tab isolation, keyboard navigation, retained search/results, scoped filters and zero storage reads on tab switches.');
    }
    // Microphone test uses simulated permission, stream, recorder and volume samples.
    {
      w.state.busy=false;w.state.recording=false;w.state.interviewSession=null;
      $('camera-check-page').hidden=false;
      let stops=0,lastConstraints,permissionMode='ok',resolvePending,latestRecorder;
      const track={stop(){stops++;},onended:null};
      const input={getTracks:()=>[track],getAudioTracks:()=>[track]};
      Object.defineProperty(w.navigator,'mediaDevices',{configurable:true,value:{
        enumerateDevices:async()=>[{kind:'audioinput',deviceId:'usb-mic',label:'USB microphone'}],
        getUserMedia:async constraints=>{lastConstraints=constraints;if(permissionMode==='denied')throw Object.assign(Error('denied'),{name:'NotAllowedError'});if(permissionMode==='pending')return new Promise(resolve=>resolvePending=resolve);return input;},
        addEventListener(){}
      }});
      let amplitude=.05;
      w.AudioContext=class {async resume(){}async close(){}createAnalyser(){return {fftSize:1024,getFloatTimeDomainData(samples){samples.fill(amplitude);}};}createMediaStreamSource(){return {connect(){}};}};
      w.MediaRecorder=class {
        static isTypeSupported(){return true;}
        constructor(stream,options){this.state='inactive';this.mimeType=options?.mimeType || 'audio/webm';latestRecorder=this;}
        start(){this.state='recording';this.onstart?.();}
        stop(){this.state='inactive';this.ondataavailable?.({data:new w.Blob(['sample'],{type:this.mimeType})});this.onstop?.();}
      };
      await w.listMicrophones();$('mic-check-device').value='usb-mic';$('mic-check-device').onchange();
      assert.equal(w.microphoneConstraints().audio.deviceId.exact,'usb-mic');
      await w.enableMicrophoneCheck();assert.equal(lastConstraints.audio.deviceId.exact,'usb-mic');
      assert.equal($('mic-check-record').disabled,false);assert($('mic-check-level').value>0);
      const oldTimeout=w.setTimeout;let sampleTimeout;
      w.setTimeout=(fn,delay,...args)=>{if(delay===5000){sampleTimeout=fn;return 123456;}return oldTimeout(fn,delay,...args);};
      w.recordMicrophoneSample();assert.equal(latestRecorder.state,'recording');assert($('mic-check-status').textContent.includes('five seconds'));
      await new Promise(resolve=>setTimeout(resolve,40));sampleTimeout();w.setTimeout=oldTimeout;
      assert.equal($('mic-check-play').disabled,true);$('mic-check-playback').dispatchEvent(new w.Event('canplay'));
      assert.equal($('mic-check-playback').hidden,false);assert.equal($('mic-check-record').disabled,true);assert(stops>0);
      assert.equal($('mic-check-play').disabled,false);await $('mic-check-play').onclick();
      w.setPageView(false);assert.equal($('mic-check-play').disabled,true);assert.equal($('mic-check-playback').hasAttribute('src'),false);
      $('camera-check-page').hidden=false;permissionMode='denied';await w.enableMicrophoneCheck();assert($('mic-check-status').textContent.includes('permission denied'));
      assert.equal($('mic-check-enable').disabled,false);
      permissionMode='pending';const pending=w.enableMicrophoneCheck();const previousStops=stops;
      w.setPageView(false);resolvePending(input);await pending;assert(stops>previousStops);assert.equal($('mic-check-record').disabled,true);
      $('camera-check-page').hidden=false;permissionMode='ok';amplitude=0;await w.enableMicrophoneCheck();
      w.recordMicrophoneSample();latestRecorder.stop();$('mic-check-playback').dispatchEvent(new w.Event('canplay'));assert($('mic-check-status').textContent.includes('little or no sound'));
      w.stopMicrophoneCheck();assert.equal($('mic-check-play').disabled,true);
      assert.equal(w.microphoneLevel(new Float32Array([0,0])),0);assert.equal(w.microphoneLevel(new Float32Array([1,-1])),1);
      w.AudioContext.prototype.resume=()=>new Promise(()=>{});
      await w.enableMicrophoneCheck();assert.equal($('mic-check-record').disabled,false);track.onended();assert($('mic-check-status').textContent.includes('disconnected'));
      w.setPageView(false);
      // Worklets execute in the audio thread, not in the page module bundle.
      let Processor;const messages=[];
      require('node:vm').runInNewContext(fs.readFileSync(path.join(root,'static/js/microphone-pcm-worklet.js'),'utf8'),{
        AudioWorkletProcessor:class {constructor(){this.port={postMessage:message=>messages.push(message)};}},
        sampleRate:48000,registerProcessor:(name,klass)=>{Processor=klass;},Float32Array
      });
      const processor=new Processor();processor.process([[new Float32Array([1,0]),new Float32Array([-1,1])]]);
      assert.deepEqual(Array.from(messages[0].samples),[0,.5]);processor.port.onmessage({data:'finish'});assert.equal(messages[1].done,true);
      // WAV output has real PCM framing and a duration derived from actual sample count.
      const wav=await w.encodeMicrophoneWav([new Float32Array([-1,0,1]),new Float32Array([.5])],48000).arrayBuffer();
      const pcm=new DataView(wav);assert.equal(Buffer.from(wav).toString('ascii',0,4),'RIFF');
      assert.equal(Buffer.from(wav).toString('ascii',8,12),'WAVE');assert.equal(pcm.getUint32(24,true),48000);
      assert.equal(pcm.getUint32(40,true),8);assert.equal(pcm.getInt16(44,true),-32768);assert.equal(pcm.getInt16(48,true),32767);
      assert.throws(()=>w.encodeMicrophoneWav([],48000));
      // Exercise the WAV path with synthetic audio processor messages.
      $('camera-check-page').hidden=false;
      w.AudioContext.prototype.resume=async function(){this.state='running';};
      w.AudioContext.prototype.sampleRate=48000;
      w.AudioContext.prototype.audioWorklet={addModule:async()=>{}};
      w.AudioContext.prototype.createGain=()=>({gain:{value:1},connect(){},disconnect(){}});
      w.AudioContext.prototype.createMediaStreamSource=()=>({connect(){},disconnect(){}});
      let pcmNode;
      w.AudioWorkletNode=class {
        constructor(){pcmNode=this;this.port={onmessage:null,postMessage:()=>this.port.onmessage?.({data:{done:true}})};}
        connect(){}disconnect(){}
      };
      await w.enableMicrophoneCheck();w.setTimeout=(fn,delay,...args)=>{if(delay===5000){sampleTimeout=fn;return 123456;}return oldTimeout(fn,delay,...args);};
      await w.recordMicrophoneSample();
      pcmNode.port.onmessage({data:{samples:new Float32Array([.1,.2,.1])}});sampleTimeout();w.setTimeout=oldTimeout;
      assert.equal($('mic-check-play').disabled,true);$('mic-check-playback').dispatchEvent(new w.Event('canplay'));assert.equal($('mic-check-play').disabled,false);
      Object.defineProperty($('mic-check-playback'),'error',{configurable:true,value:{code:4}});
      $('mic-check-playback').dispatchEvent(new w.Event('error'));assert.equal($('mic-check-play').disabled,true);assert($('mic-check-status').textContent.includes('audio/wav'));
      w.setPageView(false);
      console.log('PASS: microphone selection, input meter, timed sample/playback, no-signal feedback, permission denial, disconnect and late-permission cleanup.');
    }
    {
      let track,activeRecorder,withData=true,requestedAudio,networkCalls=0;
      const originalFetch=w.fetch;w.fetch=async()=>{networkCalls++;throw Error('Unexpected automatic network call');};
      w.navigator.mediaDevices.getUserMedia=async constraints=>{
        requestedAudio=constraints;track=new w.EventTarget();track.stop=()=>{};
        return {getAudioTracks:()=>[track],getTracks:()=>[track]};
      };
      w.MediaRecorder=class {
        static isTypeSupported(){return true;}
        constructor(stream,options){activeRecorder=this;this.mimeType=options.mimeType;this.state='inactive';}
        start(timeslice){assert.equal(timeslice,250);this.state='recording';this.onstart?.();}
        stop(){this.state='inactive';if(withData)this.ondataavailable?.({data:new w.Blob(['partial recording'],{type:this.mimeType})});this.onstop?.();}
      };
      const prepare=()=>{
        w.state.singlePractice=false;w.state.interviewSession=null;w.state.busy=false;w.state.recording=false;
        w.state.current={question:'Explain Python lists.',technology:'Python',interview_type:'technical',auto_flow:true};
        w.state.speechPending=false;w.state.answerSubmitted=false;w.state.answerExpired=false;w.state.deadline=Date.now()+60000;
        w.state.automationPaused=false;
      };
      prepare();await $('record').onclick();assert.equal(w.state.recording,true);
      assert.equal(requestedAudio.audio.deviceId.exact,'usb-mic');
      track.dispatchEvent(new w.Event('ended'));
      assert.equal(w.state.recording,false);assert.equal(w.state.stream,null);assert.equal(w.state.media,null);
      assert.equal(await w.state.blob.text(),'partial recording');assert.equal(w.state.automationPaused,true);
      assert($('microphone-status').textContent.includes('may be incomplete'));assert.equal(networkCalls,0);
      const retained=w.state.blob;track.dispatchEvent(new w.Event('ended'));assert.equal(w.state.blob,retained);
      prepare();await $('record').onclick();track.dispatchEvent(new w.Event('mute'));
      assert.equal(w.state.recording,true);assert($('microphone-status').textContent.includes('temporarily unavailable'));
      track.dispatchEvent(new w.Event('unmute'));assert($('microphone-status').textContent.includes('resumed'));
      w.stopRecording();assert.equal(w.state.recording,false);assert.equal(networkCalls,0);
      prepare();await $('record').onclick();activeRecorder.onerror();assert($('microphone-status').textContent.includes('recording error'));assert(w.state.blob.size>0);
      withData=false;prepare();await $('record').onclick();track.dispatchEvent(new w.Event('ended'));
      assert.equal(w.state.blob,null);assert($('microphone-status').textContent.includes('No audio was captured'));
      assert.equal(networkCalls,0);
      w.fetch=originalFetch;w.state.current=null;w.state.automationPaused=true;
      console.log('PASS: interview microphone disconnect preserves partial audio, pauses automation, reports empty capture, handles mute/resume and cleans up streams.');
    }
    {
      const b=createBrowser();b.window.eval(bundle);const v=b.window,d=id=>v.document.getElementById(id);
      try {
        await new Promise(r=>setTimeout(r,20));
        let evaluations=0;
        v.fetch=async url=>{if(url.includes('evaluate')) evaluations++;throw Error('Provider unavailable');};
        v.state.cameraStream={getVideoTracks:()=>[{readyState:'live',enabled:true}],getTracks:()=>[{stop(){}}]};
        v.state.neutralRotation=[[1,0,0],[0,1,0],[0,0,1]];
        const settings={technology:'Python',interview_type:'technical',difficulty:'easy',language:'English',auto_flow:false};
        v.state.interviewSession={id:'skip-test',date:new Date().toISOString(),active:true,loaded:true,total:2,source:'manual',settings,questions:['First **question**','Second `question`'],answers:[]};
        v.state.current={...settings,question:'First **question**'};v.state.recording=false;v.state.busy=false;
        d('transcript').value='Unsubmitted text';v.state.blob=new v.Blob(['draft'],{type:'audio/webm'});
        v.confirm=()=>false;await d('session-skip').onclick();assert.equal(v.state.interviewSession.answers.length,0);assert.equal(d('transcript').value,'Unsubmitted text');
        v.confirm=()=>true;v.state.recording=true;await d('session-skip').onclick();assert.equal(v.state.interviewSession.answers.length,0);v.state.recording=false;
        await d('session-skip').onclick();assert.equal(v.state.interviewSession.answers.length,1);assert.equal(v.state.current.question,'Second `question`');
        assert.equal(v.state.interviewSession.answers[0].skipped,true);assert.equal(v.state.interviewSession.answers[0].recording,null);assert.equal(v.state.blob,null);
        assert.equal((await v.draftStore('readonly',s=>s.get('active'))).answers[0].skipped,true);
        await d('session-skip').onclick();assert.equal(v.state.interviewSession.active,false);assert.equal(v.state.cameraStream,null);assert.equal(evaluations,0);
        await waitFor(()=>v.state.sessionSavePending===null);
        assert.equal(d('session-report').querySelectorAll('.answer-card').length,2);assert.equal(d('score-pending'),null);
        assert.equal(v.dashboardSummary([v.state.interviewSession]).pending,0);assert.equal(v.dashboardSummary([v.state.interviewSession]).scored,0);
        const cards=[...d('session-report').querySelectorAll('details')];assert(cards.every(x=>!x.open));
        v.dispatchEvent(new v.Event('beforeprint'));assert(cards.every(x=>x.open));v.dispatchEvent(new v.Event('afterprint'));assert(cards.every(x=>!x.open));
        assert(d('session-report').querySelector('.report-question strong'));assert.equal(d('session-report').querySelector('.answer-content script'),null);
        const doc=new JSDOM(v.buildReportDocument(v.state.interviewSession)).window.document;assert(doc.body.textContent.includes('2 skipped'));
        // Next-question failure retains exactly one skipped record for retry.
        v.state.interviewSession={id:'skip-fail',date:new Date().toISOString(),active:true,loaded:true,total:2,source:'gemini',settings,answers:[]};
        v.state.current={...settings,question:'Skip during outage'};
        v.state.cameraStream={getVideoTracks:()=>[{readyState:'live',enabled:true}],getTracks:()=>[{stop(){}}]};v.state.neutralRotation=[[1,0,0],[0,1,0],[0,0,1]];
        await d('session-skip').onclick();assert.equal(v.state.interviewSession.answers.length,1);assert.equal(v.state.interviewSession.loaded,false);
        await d('session-skip').onclick();assert.equal(v.state.interviewSession.answers.length,1);
        v.fetch=async()=>({ok:true,status:200,text:async()=>JSON.stringify({question:'Recovered question'})});
        await d('session-next').onclick();assert.equal(v.state.current.question,'Recovered question');assert.equal(v.state.interviewSession.answers.length,1);
        v.cancelQuestionSpeech(false);clearInterval(v.state.ticker);v.stopCamera();
        await v.draftStore('readwrite',s=>s.delete('active'));
        console.log('PASS: skip confirmation, recording guard, draft discard, checkpoint, final completion, provider failure retry, no evaluation, separate counts and expandable printable cards.');
      } finally { b.window.close(); }
    }
    assert.deepEqual(errors,[]);
    console.log('PASS: empty dashboard, filters, zero/pending scores, reports, quota recovery, session navigation, completion, camera cleanup, confidence persistence, retry scoring, deletion and single practice.');
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>w.close());
