import { buildReportDocument } from './report-document.js';

const MAX_BYTES = 100 * 1024 * 1024;
const encoder = () => new TextEncoder();
const crcTable = Array.from({length:256}, (_, i) => {
  let crc = i;
  for (let bit=0;bit<8;bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  return crc >>> 0;
});
function crc32(data) {
  let crc = 0xffffffff;
  for (const byte of data) crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 255];
  return (crc ^ 0xffffffff) >>> 0;
}

// ZIP STORE keeps already-compressed audio intact and needs no extra dependency.
export function createStoredZip(entries) {
  if (entries.length > 102) throw Error('This download supports up to 100 answers.');
  const parts=[], directory=[];
  let offset=0, directorySize=0;
  const names=new Set();
  for (const {name,data} of entries) {
    if (!/^[a-zA-Z0-9_-]+\.[a-zA-Z0-9]+$/.test(name) || names.has(name)) throw Error('Invalid or duplicate archive filename.');
    names.add(name);
    const filename=encoder().encode(name), size=data.byteLength, crc=crc32(data);
    if (offset+size+filename.length+30>MAX_BYTES) throw Error('Session bundle exceeds 100 MB. Download recordings individually.');
    const local=new Uint8Array(30), lv=new DataView(local.buffer);
    lv.setUint32(0,0x04034b50,true);lv.setUint16(4,20,true);lv.setUint16(6,0x0800,true);
    lv.setUint16(12,33,true);lv.setUint32(14,crc,true);lv.setUint32(18,size,true);lv.setUint32(22,size,true);lv.setUint16(26,filename.length,true);
    parts.push(local,filename,data);
    const central=new Uint8Array(46), cv=new DataView(central.buffer);
    cv.setUint32(0,0x02014b50,true);cv.setUint16(4,20,true);cv.setUint16(6,20,true);cv.setUint16(8,0x0800,true);
    cv.setUint16(14,33,true);cv.setUint32(16,crc,true);cv.setUint32(20,size,true);cv.setUint32(24,size,true);cv.setUint16(28,filename.length,true);cv.setUint32(42,offset,true);
    directory.push(central,filename);directorySize+=46+filename.length;
    offset+=30+filename.length+size;
  }
  const end=new Uint8Array(22), ev=new DataView(end.buffer);
  ev.setUint32(0,0x06054b50,true);ev.setUint16(8,entries.length,true);ev.setUint16(10,entries.length,true);ev.setUint32(12,directorySize,true);ev.setUint32(16,offset,true);
  return new Blob([...parts,...directory,end],{type:'application/zip'});
}
async function bytes(blob) {
  if (typeof blob.arrayBuffer==='function') return new Uint8Array(await blob.arrayBuffer());
  return new Promise((resolve,reject)=>{
    const reader=new FileReader();reader.onload=()=>resolve(new Uint8Array(reader.result));
    reader.onerror=()=>reject(Error('A recording could not be read. No bundle was downloaded.'));
    reader.readAsArrayBuffer(blob);
  });
}
function extension(recording) {
  const ext=String(recording.name || '').match(/\.(wav|mp3|m4a|webm|ogg|flac|mp4)$/i)?.[1];
  if(ext) return ext.toLowerCase();
  return ({'audio/wav':'wav','audio/x-wav':'wav','audio/mpeg':'mp3','audio/mp4':'m4a','audio/webm':'webm','video/webm':'webm','audio/ogg':'ogg','audio/flac':'flac'}[recording.blob.type.split(';')[0]] || 'bin');
}
export async function buildSessionBundle(session) {
  if (!session || session.active || !Array.isArray(session.answers)) throw Error('Open a completed session first.');
  if (session.answers.length>100) throw Error('This download supports up to 100 answers.');
  const report=encoder().encode(buildReportDocument(session));
  let total=report.byteLength;
  for(const answer of session.answers) {
    if(!answer.recording) continue;
    if(!(answer.recording.blob instanceof Blob) || !answer.recording.blob.size) throw Error('A saved recording is unavailable. Reopen the session and retry.');
    total+=answer.recording.blob.size;
  }
  if(total>MAX_BYTES-65536) throw Error('Session bundle exceeds 100 MB. Download recordings individually.');
  const entries=[{name:'interview-report.html',data:report}];
  const lines=['HyperSense AI session bundle','','Open interview-report.html in your browser. Use Print to save it as PDF.',
    'Audio files are named by question number. They are not embedded in the report.',
    'This export contains your answers and recordings. Review before sharing.',
    'This bundle is for reading/playback. Use Dashboard > Backup & restore to restore app data.',''];
  for(const [i,answer] of session.answers.entries()) {
    const number=String(i+1).padStart(2,'0');
    if(answer.recording) {
      const name=`answer-${number}.${extension(answer.recording)}`;
      entries.push({name,data:await bytes(answer.recording.blob)});
      lines.push(`Question ${i+1}: ${name}`);
    } else lines.push(`Question ${i+1}: ${answer.skipped ? 'Skipped; no recording.' : 'No recording attached.'}`);
  }
  entries.push({name:'README.txt',data:encoder().encode(lines.join('\n'))});
  return createStoredZip(entries);
}
let preparedURL = null;
export function clearPreparedBundle() {
  if (preparedURL) URL.revokeObjectURL(preparedURL);
  preparedURL = null;
  const link = document.getElementById('session-bundle-link');
  if (link) { link.hidden = true; link.removeAttribute('href'); }
}
export async function prepareSessionBundle(session) {
  clearPreparedBundle();
  const blob = await buildSessionBundle(session);
  preparedURL = URL.createObjectURL(blob);
  const link = document.getElementById('session-bundle-link');
  link.href = preparedURL;
  link.download = 'hypersense-session.zip';
  link.hidden = false;
  return blob.size;
}
window.addEventListener('pagehide', clearPreparedBundle);
