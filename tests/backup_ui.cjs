const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{JSDOM}=require('jsdom'),esbuild=require('esbuild');
(async()=>{
 const root=path.resolve(__dirname,'..'),dom=new JSDOM(fs.readFileSync(path.join(root,'templates/admin-workspace.html'),'utf8'),{url:'http://localhost/admin',runScripts:'outside-only'}),w=dom.window,$=id=>w.document.getElementById(id);
 const code=esbuild.buildSync({entryPoints:[path.join(root,'static/admin/workspace.js')],bundle:true,write:false,format:'iife'}).outputFiles[0].text;
 let backup={last_success_at:null,available:false,last_attempt_ok:null};
 w.fetch=async url=>({ok:true,json:async()=>url.includes('/usage')?{rows:[]}:{users:{total:0,verified:0,new_week:0,suspended:0,signed_in:0},sessions:{saved:0},recent_users:[],backup}});
 const wait=async()=>{await new Promise(r=>setTimeout(r,25));};
 try{
  w.eval(code);await wait();assert.equal($('backup-state').textContent,'No backup yet');
  backup={last_success_at:Date.now()/1000,available:true,last_attempt_ok:true};$('admin-refresh').click();await wait();assert.equal($('backup-state').textContent,'Verified backup');
  backup.last_attempt_ok=false;$('admin-refresh').click();await wait();assert.equal($('backup-state').textContent,'Latest attempt failed');
  backup.last_attempt_ok=true;backup.last_success_at-=90000;$('admin-refresh').click();await wait();assert.equal($('backup-state').textContent,'Backup over 24 hours old');
  backup.available=false;$('admin-refresh').click();await wait();assert.equal($('backup-state').textContent,'Backup unavailable');
  console.log('PASS: admin backup states distinguish missing, verified, failed, stale and unavailable snapshots.');
 }finally{w.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
