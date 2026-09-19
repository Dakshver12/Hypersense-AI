"""Run with: python check_hypersense.py (Python 3.10+ and Node.js required). No API calls."""
import ast
import re
import shutil
import subprocess
import tempfile
import unittest
from html.parser import HTMLParser
from pathlib import Path

ROOT = Path(__file__).resolve().parent
HTML = (ROOT / 'index.html').read_text(encoding='utf-8')
JS = re.search(r'<script>(.*?)</script>', HTML, re.S).group(1)

class Markup(HTMLParser):
    def __init__(self):
        super().__init__(); self.ids = []; self.stack = []
    def handle_starttag(self, tag, attrs):
        d = dict(attrs)
        if 'id' in d: self.ids.append(d['id'])
        if tag not in {'input','meta','br','hr','img','link','source'}: self.stack.append(tag)
    def handle_endtag(self, tag):
        if not self.stack or self.stack.pop() != tag: raise AssertionError('Unbalanced HTML: '+tag)

class Checks(unittest.TestCase):
    def node(self, text, syntax=False):
        self.assertIsNotNone(shutil.which('node'), 'Install Node.js to run JavaScript checks')
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory)/'check.js'; path.write_text(text,encoding='utf-8')
            result=subprocess.run(['node']+(['--check'] if syntax else [])+[str(path)],capture_output=True,text=True)
            self.assertEqual(result.returncode,0,result.stdout+result.stderr)
    def test_html_and_control_bindings(self):
        parser=Markup();parser.feed(HTML)
        self.assertFalse(parser.stack)
        self.assertEqual(len(parser.ids),len(set(parser.ids)))
        dynamic={'score-pending','live-camera-dock'}
        for ident in re.findall(r"\$\('([^']+)'\)",JS): self.assertIn(ident,set(parser.ids)|dynamic)
    def test_javascript_syntax(self): self.node(JS,True)
    def test_backend_routes(self):
        tree=ast.parse((ROOT/'main.py').read_text(encoding='utf-8'))
        routes=[d.args[0].value for n in ast.walk(tree) if isinstance(n,(ast.FunctionDef,ast.AsyncFunctionDef)) for d in n.decorator_list if isinstance(d,ast.Call) and d.args and isinstance(d.args[0],ast.Constant)]
        for route in ['/interview','/camera-check','/results','/transcribe','/evaluate-answer','/generate-question']: self.assertIn(route,routes)
    def test_automatic_flow(self):
        code=JS[JS.index('let automationPaused='):JS.index('function cancelQuestionSpeech(')]
        self.node('''const assert=require('node:assert/strict');
let tasks=new Map(),counter=0;
const setTimeout=f=>{tasks.set(++counter,f);return counter;};const clearTimeout=id=>tasks.delete(id);const clearInterval=()=>{};
async function drain(){for(let i=0;tasks.size&&i<100;i++){let [id,fn]=tasks.entries().next().value;tasks.delete(id);await fn();await Promise.resolve();}}
const els={};const $=id=>els[id]??={textContent:'',onclick:null};
let current={auto_flow:true},busy=false,speechPending=false,answerSubmitted=false,answerExpired=false,recording=false,blob={size:50},ticker=null,transcriptions=0,submissions=0,starts=0,fail=false;
$('record').onclick=()=>{starts++;};
async function transcribeAnswer(){transcriptions++;if(fail)throw Error('Quota');}
async function submitAnswer(){submissions++;}
async function run(fn){if(busy)return;busy=true;try{await fn();}catch(e){pauseAutomation(e.message);}finally{busy=false;}}
'''+code+'''
(async()=>{
queueAutoRecording();await drain();assert.equal(starts,1);
await autoProcessRecording();await drain();assert.equal(transcriptions,1);assert.equal(submissions,1);
answerExpired=false;automationPaused=false;await autoProcessRecording();pauseAutomation();await drain();assert.equal(submissions,1);
automationPaused=false;answerExpired=false;fail=true;await autoProcessRecording();await drain();assert.equal(submissions,1);assert.equal(automationPaused,true);assert.equal(blob.size,50);
fail=false;automationPaused=false;current={auto_flow:false};await autoProcessRecording();assert.equal(transcriptions,3);
current={auto_flow:true};queueAutoRecording();current={auto_flow:true};await drain();assert.equal(starts,1);
})().catch(e=>{console.error(e);process.exitCode=1;});
''')
    def test_camera_permission_and_calibration(self):
        start=JS.index("$('camera-on').onclick = async () => {")
        end=JS.index("$('camera-off').onclick",start)
        pose=JS[JS.index('function updatePose('):JS.index("$('calibrate').onclick=")]
        self.node('''const assert=require('node:assert/strict');const els={};const $=id=>els[id]??={textContent:'',disabled:false,play:async()=>{}};
let cameraStream=null,cameraStarting=false,cameraSession=0,neutralRotation=null,latestRotation=null,calibrating=false,calibrationSamples=[],calls=0,consent=false;
const window={confirm:()=>consent};const cameraMessage=()=>{};const refresh=()=>{};const detectCameraFrame=()=>{};const relativeAngles=()=>({total:0,yaw:0,pitch:0,roll:0});
const navigator={mediaDevices:{getUserMedia:async()=>{calls++;return {getVideoTracks:()=>[],getTracks:()=>[]};}}};const stopCamera=()=>{};
'''+JS[start:end]+pose+'''
(async()=>{await $('camera-on').onclick();assert.equal(calls,0);$('camera-consent').checked=true;await $('camera-on').onclick();assert.equal(calls,1);
const r=[[1,0,0],[0,1,0],[0,0,1]];updatePose(r,2);assert.equal(neutralRotation,null);
for(let i=0;i<4;i++)updatePose(r,1);assert.equal(neutralRotation,null);updatePose(r,1);assert.deepEqual(neutralRotation,r);assert.equal(calibrating,false);
updatePose(null,0);assert.deepEqual(neutralRotation,r);
})().catch(e=>{console.error(e);process.exitCode=1;});
''')
    def test_question_formatting(self):
        code=JS[JS.index('function renderQuestion('):JS.index('let microphoneReadyTimer=')]
        self.node('''const assert=require('node:assert/strict');
class Element{constructor(tag){this.tag=tag;this.children=[];this.textContent='';}appendChild(x){this.children.push(x);}replaceChildren(){this.children=[];}}
const root=new Element('div');const $=()=>root;const document={createElement:t=>new Element(t),createTextNode:t=>({tag:'#text',textContent:t})};
'''+code+'''
renderQuestion('Compare `get()` with **indexing**.\\n\\n```python\\nif ready:\\n    run()\\n```\\n\\n<img src=x onerror=alert(1)>');
assert.equal(root.children[0].tag,'p');assert.equal(root.children[1].tag,'pre');
assert.equal(root.children[1].children[0].textContent,'if ready:\\n    run()');
assert(root.children[0].children.some(x=>x.tag==='code'&&x.textContent==='get()'));
assert.equal(root.children[2].children[0].tag,'#text');
renderQuestion('Next question');assert.equal(root.children.length,1);
''')
    def test_results_navigation(self):
        code=JS[JS.index('function showCameraCheck('):JS.index("window.addEventListener('popstate'")]
        self.node('''const assert=require('node:assert/strict');const els={};const $=id=>els[id]??={hidden:false,focus(){},scrollIntoView(){},querySelectorAll(){return []}};const document={title:''};const window={scrollTo(){}};const location={pathname:'/interview',search:''};const history={pushState(a,b,p){const u=new URL(p,'http://test');location.pathname=u.pathname;location.search=u.search},replaceState(a,b,p){this.pushState(a,b,p)}};const message=()=>{};const refresh=()=>{};const pauseAutomation=()=>{};let interviewSession=null,opened=null;async function openSavedSession(id){opened=id;}
let cameraStream=null,busy=false,recording=false;
$('camera-on').onclick=()=>{};
const cameraSection={insertBefore(child){child.parent='check';}};
$('camera-title').closest=()=>cameraSection;
$('live-camera-dock').appendChild=child=>{child.parent='interview';};
'''+code+'''
(async()=>{showResultsPage('saved');assert.equal(location.pathname,'/results');assert.equal($('interview-page').hidden,true);showInterviewPage();assert.equal($('camera-preview').parent,'interview');assert.equal(location.pathname,'/interview');history.pushState({},'','/results?session=saved');await restorePageRoute();assert.equal(opened,'saved');interviewSession={active:true};await restorePageRoute();assert.equal(location.pathname,'/interview');interviewSession=null;history.pushState({},'','/camera-check');await restorePageRoute();assert.equal($('camera-preview').parent,'check');assert.equal($('camera-check-page').hidden,false);assert.equal($('interview-page').hidden,true);})().catch(e=>{console.error(e);process.exitCode=1;});
''')

if __name__=='__main__': unittest.main(verbosity=2)
