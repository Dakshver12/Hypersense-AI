const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{JSDOM}=require('jsdom');
(async()=>{
 const dom=new JSDOM('<div id="account-menu" hidden><span id="account-name"></span><a id="account-settings-link"></a><button id="account-logout"></button><button id="account-import"></button></div><p id="account-status"></p>',{url:'http://localhost',runScripts:'outside-only',pretendToBeVisual:true}),w=dom.window;
 let count=2,poll;
 w.setInterval=fn=>{poll=fn;return 1;};w.clearInterval=()=>{};
 w.mockRequest=async url=>url==='/auth/me'?{name:'User',email:'user@example.com'}:{unread:count};
 const source=fs.readFileSync(path.join(__dirname,'../static/js/account.js'),'utf8').replace(/^import .*;\s*$/gm,'').replace('export function initAccount','function initAccount');
 try{
  w.eval('const accountId="a",state={},accountRequest=window.mockRequest;\n'+source+'\ninitAccount();');
  await new Promise(r=>setTimeout(r,10));
  assert.equal(w.document.getElementById('support-unread-count').textContent,'2');
  assert(w.document.getElementById('support-link').getAttribute('aria-label').includes('2 unread'));
  count=0;await poll();assert(w.document.getElementById('support-unread-count').hidden);
  count=1;await poll();assert(!w.document.getElementById('support-unread-count').hidden);
  console.log('PASS: support menu badge shows, clears, and refreshes unread reply counts.');
 }finally{w.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
