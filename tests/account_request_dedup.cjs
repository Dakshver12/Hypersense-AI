const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
(async()=>{
const source=fs.readFileSync(path.join(__dirname,'../static/js/account-store.js'),'utf8').replace("import { accountHeaders } from './account-context.js';","const accountHeaders=()=>({'X-HyperSense-Account':'u'});");
const {accountRequest}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
let calls=0,release;
global.fetch=()=>{calls++;return new Promise(resolve=>{release=()=>resolve({ok:true,json:async()=>({items:[1]})});});};
const a=accountRequest('/example'),b=accountRequest('/example');
assert.equal(calls,1);release();const [x,y]=await Promise.all([a,b]);x.items.push(2);assert.deepEqual(y.items,[1]);
const c=accountRequest('/example');assert.equal(calls,2);release();await c;
global.fetch=async()=>{calls++;return {ok:true,json:async()=>({ok:true})};};
await Promise.all([accountRequest('/example',{method:'POST'}),accountRequest('/example',{method:'POST'})]);assert.equal(calls,4);
global.fetch=async()=>{calls++;return {ok:false,status:401,json:async()=>({detail:'expired'})};};
await assert.rejects(accountRequest('/example'),{message:'expired'});
await assert.rejects(accountRequest('/example'),{message:'expired'});assert.equal(calls,6);
console.log('PASS: overlapping GETs share one fetch; responses are isolated; later reads, writes and errors remain fresh.');
})().catch(error=>{console.error(error);process.exitCode=1;});
