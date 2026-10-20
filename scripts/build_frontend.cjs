// Produce deploy-specific, immutable CDN assets without changing source templates.
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const esbuild=require('esbuild');
const root=path.resolve(__dirname,'..');
const target=path.join(root,'public/assets');
const templates=path.join(root,'templates');
const generated=path.join(root,'generated/templates');
function hash(bytes){return crypto.createHash('sha256').update(bytes).digest('hex').slice(0,16);}
function source(url){
 const clean=url.split('?')[0];
 if(!clean.startsWith('/static/'))throw Error('Unsupported frontend asset '+url);
 const file=path.resolve(root,'.'+clean);
 if(!file.startsWith(path.join(root,'static')+path.sep)||!fs.statSync(file).isFile())throw Error('Invalid frontend asset');
 return file;
}
function publish(stem,extension,bytes){
 const name=stem+'.'+hash(bytes)+'.'+extension;
 fs.writeFileSync(path.join(target,name),bytes);
 return '/assets/'+name;
}
function build(){
 fs.rmSync(target,{recursive:true,force:true});fs.mkdirSync(target,{recursive:true});
 fs.rmSync(generated,{recursive:true,force:true});fs.mkdirSync(generated,{recursive:true});
 const scripts=new Map(),manifest={};
 for(const entry of fs.readdirSync(templates,{withFileTypes:true})){
  if(!entry.isFile()||!entry.name.endsWith('.html'))continue;
  let html=fs.readFileSync(path.join(templates,entry.name),'utf8');
  const original=html;
  const css=[...html.matchAll(/<link\b[^>]*rel=["']stylesheet["'][^>]*href=["']([^"']+)["'][^>]*>/g)].filter(m=>m[1].startsWith('/static/'));
  if(css.length){
   // Keep exactly the original cascade order; there are no relative URLs/imports in these styles.
   const text=css.map(m=>{const content=fs.readFileSync(source(m[1]),'utf8');if(/url\(\s*["']?(?!\/|https?:|data:|#)[\w.]/i.test(content)||/@import\b/.test(content))throw Error('Resolve relative CSS assets before bundling '+m[1]);return content;}).join('\n');
   const output=esbuild.transformSync(text,{loader:'css',minify:true,target:'es2020'}).code;
   const url=publish(path.parse(entry.name).name,'css',output);
   html=html.replace(css[0][0],'<link rel="stylesheet" href="'+url+'">');
   for(const match of css.slice(1))html=html.replace(match[0],'');
  }
  html=html.replace(/<script\b[^>]*type=["']module["'][^>]*src=["']([^"']+)["'][^>]*>\s*<\/script>/g,(tag,url)=>{
   if(!url.startsWith('/static/'))return tag;
   const file=source(url);
   if(!scripts.has(file)){
    const result=esbuild.buildSync({entryPoints:[file],bundle:true,minify:true,write:false,format:'esm',platform:'browser',target:'es2020',legalComments:'inline'});
    scripts.set(file,publish(path.parse(file).name,'js',result.outputFiles[0].contents));
   }
   return '<script type="module" src="'+scripts.get(file)+'"></script>';
  });
  if(html!==original){
   const script=html.match(/<script type="module" src="(\/assets\/[^"']+)"/);
   // Start the bundled JS fetch while the browser is still parsing the head/CSS.
   if(script)html=html.replace('</head>','<link rel="modulepreload" href="'+script[1]+'">\n</head>');
   html=html.replace('</head>','<style>html{color-scheme:dark;background:#10151e}body{background:#10151e;color:#f1f3f5}</style>\n</head>');
   fs.writeFileSync(path.join(generated,entry.name),html);
   manifest[entry.name]={styles:[...html.matchAll(/href="(\/assets\/[^"']+\.css)"/g)].map(m=>m[1]),scripts:[...html.matchAll(/src="(\/assets\/[^"']+\.js)"/g)].map(m=>m[1])};
  }
 }
 fs.writeFileSync(path.join(generated,'manifest.json'),JSON.stringify(manifest,null,2));
 console.log('Bundled frontend assets for '+Object.keys(manifest).length+' templates; '+scripts.size+' JS entrypoints.');
 return manifest;
}
if(require.main===module)build();
module.exports={build};
