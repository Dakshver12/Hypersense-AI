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
        dynamic={'score-pending'}
        for ident in re.findall(r"\$\('([^']+)'\)",JS): self.assertIn(ident,set(parser.ids)|dynamic)
    def test_javascript_syntax(self): self.node(JS,True)
    def test_backend_routes(self):
        tree=ast.parse((ROOT/'main.py').read_text(encoding='utf-8'))
        routes=[d.args[0].value for n in ast.walk(tree) if isinstance(n,(ast.FunctionDef,ast.AsyncFunctionDef)) for d in n.decorator_list if isinstance(d,ast.Call) and d.args and isinstance(d.args[0],ast.Constant)]
        for route in ['/interview','/results','/transcribe','/evaluate-answer','/generate-question']: self.assertIn(route,routes)
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
    def test_results_navigation(self):
        code=JS[JS.index('function setPageView('):JS.index("window.addEventListener('popstate'")]
        self.node('''const assert=require('node:assert/strict');const els={};const $=id=>els[id]??={hidden:false,focus(){},scrollIntoView(){},querySelectorAll(){return []}};const document={title:''};const window={scrollTo(){}};const location={pathname:'/interview',search:''};const history={pushState(a,b,p){const u=new URL(p,'http://test');location.pathname=u.pathname;location.search=u.search},replaceState(a,b,p){this.pushState(a,b,p)}};const message=()=>{};let interviewSession=null,opened=null;async function openSavedSession(id){opened=id;}
'''+code+'''
(async()=>{showResultsPage('saved');assert.equal(location.pathname,'/results');assert.equal($('interview-page').hidden,true);showInterviewPage();assert.equal(location.pathname,'/interview');history.pushState({},'','/results?session=saved');await restorePageRoute();assert.equal(opened,'saved');interviewSession={active:true};await restorePageRoute();assert.equal(location.pathname,'/interview');})().catch(e=>{console.error(e);process.exitCode=1;});
''')

if __name__=='__main__': unittest.main(verbosity=2)
