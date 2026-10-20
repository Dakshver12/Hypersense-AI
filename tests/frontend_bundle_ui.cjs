// Smoke-test the actual minified deployment files, rather than rebuilding a test bundle.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {JSDOM,VirtualConsole}=require('jsdom');const {indexedDB,IDBKeyRange}=require('fake-indexeddb');
const root=path.resolve(__dirname,'..'),folder=path.join(root,'generated/templates');
if(!fs.existsSync(path.join(folder,'manifest.json'))){console.log('SKIP: build assets before the deployment-bundle smoke test.');process.exit(0);}
const manifest=JSON.parse(fs.readFileSync(path.join(folder,'manifest.json'),'utf8'));
const script=name=>fs.readFileSync(path.join(root,'public',manifest[name].scripts[0]),'utf8');
(async()=>{
 let html=fs.readFileSync(path.join(folder,'index.html'),'utf8');
 for(const name of ['dashboard','setup','interview','camera-check','results'])html=html.replace('<!-- include:'+name+' -->',fs.readFileSync(path.join(root,'templates/screens/'+name+'.html'),'utf8'));
 html=html.replace('<!-- account-meta -->','<meta name="hypersense-account" content="test-user">');
 const errors=[],vc=new VirtualConsole();vc.on('jsdomError',e=>errors.push(e.message));
 const dom=new JSDOM(html,{url:'https://example.test/interview',runScripts:'outside-only',pretendToBeVisual:true,virtualConsole:vc});const w=dom.window;
 w.structuredClone=structuredClone;w.indexedDB=indexedDB;w.IDBKeyRange=IDBKeyRange;w.scrollTo=()=>{};w.HTMLElement.prototype.scrollIntoView=()=>{};
 w.HTMLMediaElement.prototype.pause=()=>{};w.HTMLMediaElement.prototype.load=()=>{};w.HTMLCanvasElement.prototype.getContext=()=>({clearRect(){},strokeRect(){},drawImage(){}});
 w.fetch=async url=>({ok:true,status:200,json:async()=>url==='/api/account/sessions'?[]:url==='/auth/me'?{name:'Daksh',email:'test@example.com'}:{},text:async()=> '{}'});
 w.eval(script('index.html'));await new Promise(r=>setTimeout(r,80));
 assert(w.document.getElementById('live-camera-dock'));assert.equal(w.document.getElementById('nav-practice').getAttribute('aria-current'),'page');assert.deepEqual(errors,[]);dom.window.close();
 const auth=new JSDOM(fs.readFileSync(path.join(folder,'auth.html'),'utf8'),{url:'https://example.test/signup',runScripts:'outside-only'});auth.window.scrollTo=()=>{};auth.window.eval(script('auth.html'));
 const d=id=>auth.window.document.getElementById(id);assert.equal(d('auth-submit').textContent,'Create account');assert.equal(d('name-field').hidden,false);d('auth-switch').querySelector('a').click();assert.equal(auth.window.location.pathname,'/login');assert.equal(d('auth-submit').textContent,'Sign in');auth.window.close();
 console.log('PASS: actual minified workspace and auth bundles boot with working navigation.');
})().catch(e=>{console.error(e);process.exitCode=1;});
