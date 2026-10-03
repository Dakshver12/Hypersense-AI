const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {JSDOM}=require('jsdom'),esbuild=require('esbuild');
const root=path.resolve(__dirname,'..');
const html=fs.readFileSync(path.join(root,'templates/admin-usage.html'),'utf8');
const code=esbuild.buildSync({entryPoints:[path.join(root,'static/admin/usage.js')],bundle:true,write:false,format:'iife'}).outputFiles[0].text;
const until=Math.floor(Date.now()/1000),since=Math.floor(until/86400)*86400;
const data={since,until,rows:[
 {kind:'request',operation:'evaluation',provider:'app',outcome:'success',count:1,total_ms:3000,fallback:0},
 {kind:'attempt',operation:'evaluation',provider:'Gemini',outcome:'rate_limited',count:1,total_ms:1000,fallback:0},
 {kind:'attempt',operation:'evaluation',provider:'Groq',outcome:'success',count:1,total_ms:2000,fallback:1},
 {kind:'cooldown',operation:'evaluation',provider:'Gemini',outcome:'rate_limited',count:2,total_ms:0,fallback:0}],daily:[{day:since,requests:1,attempts:2,rate_limits:1}]};
(async()=>{
 const dom=new JSDOM(html,{url:'http://localhost/admin/usage',runScripts:'outside-only'}),w=dom.window;
 let status=200,calls=0,payload=data;
 w.fetch=async(url,options)=>{calls++;assert.equal(options.cache,'no-store');assert(options.headers['X-HyperSense-Account']);return {ok:status===200,status,json:async()=>payload};};
 const wait=async()=>{for(let i=0;i<50;i++){await new Promise(r=>setTimeout(r,10));if(!w.document.getElementById('usage-refresh').disabled)return;}throw Error('Timed out');};
 try{
  w.eval(code);await wait();const $=id=>w.document.getElementById(id);
  assert.equal($('metric-requests').textContent,'1');assert.equal($('metric-attempts').textContent,'2');assert.equal($('metric-limits').textContent,'1');
  assert.equal($('metric-app-latency').textContent,'3000 ms');
  assert.equal($('metric-fallback-rate').textContent,'50.0% of provider attempts');
  assert($('usage-providers').textContent.includes('1.00 s'));assert.equal($('usage-daily').children.length,1);
  status=403;$('usage-filters').dispatchEvent(new w.Event('submit',{cancelable:true}));await wait();
  assert($('usage-content').hidden);assert($('usage-status').textContent.includes('Administrator'));
  status=200;payload={since,until,rows:[],daily:[]};$('usage-refresh').click();await wait();
  assert(!$('usage-content').hidden);assert($('usage-status').textContent.includes('No activity'));
  assert.equal($('metric-attempts').textContent,'0');assert.equal(calls,3);
  console.log('PASS: admin usage counts, timings, fallback percentage, permission failure and empty-state recovery.');
 }finally{w.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
