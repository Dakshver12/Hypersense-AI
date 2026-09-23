import { $ } from './dom.js';
import { state } from './state.js';

let selected = '', stream = null, context = null, analyser = null;
let recorder = null, timer = null, frame = null, playbackUrl = null;
let generation = 0, requesting = false, peak = 0;
let pcmCancel = null, sampleRunning = false;
const onCheckPage = () => !$('camera-check-page')?.hidden;
const permitted = () => onCheckPage() && !state.busy && !state.recording;
const status = text => { if ($('mic-check-status')) $('mic-check-status').textContent = text; };
export function microphoneConstraints() {
  return {audio: selected ? {deviceId:{exact:selected}} : true};
}
export function microphoneLevel(samples) {
  if (!samples.length) return 0;
  let sum = 0;
  for (const sample of samples) sum += sample * sample;
  return Math.sqrt(sum / samples.length);
}
function controls() {
  const running = sampleRunning || recorder?.state === 'recording';
  $('mic-check-enable').disabled = requesting || Boolean(stream);
  $('mic-check-record').disabled = !stream || running || (!window.MediaRecorder && !window.AudioWorkletNode);
  $('mic-check-stop').disabled = !requesting && !stream;
  $('mic-check-device').disabled = requesting || running;
}
function clearPlayback() {
  const player=$('mic-check-playback');
  player.oncanplay=null;player.onerror=null;
  player.pause();player.removeAttribute('src');player.hidden=false;player.load();
  $('mic-check-play').disabled=true;
  $('mic-check-playback-help').textContent='Record a five-second sample to enable playback.';
  if(playbackUrl) URL.revokeObjectURL(playbackUrl);
  playbackUrl=null;
}
function releaseInput() {
  clearTimeout(timer);timer=null;
  cancelAnimationFrame(frame);frame=null;
  if(stream)stream.getTracks().forEach(track=>track.stop());
  stream=null;
  if(context)context.close().catch(()=>{});
  context=null;analyser=null;
  $('mic-check-level').value=0;
  $('mic-check-level-text').textContent='Microphone off';
}
export function stopMicrophoneCheck(clear = true) {
  generation++;requesting=false;sampleRunning=false;
  if(pcmCancel){pcmCancel();pcmCancel=null;}
  const previous=recorder;recorder=null;
  if(previous && previous.state!=='inactive') {previous.onstop=null;previous.onerror=null;previous.stop();}
  releaseInput();
  if(clear)clearPlayback();
  controls();status('Microphone test stopped.');
}
export async function listMicrophones() {
  if(!navigator.mediaDevices?.enumerateDevices)return;
  const devices=(await navigator.mediaDevices.enumerateDevices()).filter(d=>d.kind==='audioinput' && d.deviceId);
  const select=$('mic-check-device');
  select.replaceChildren(new Option('System default microphone',''));
  for(const [index,device] of devices.entries())select.add(new Option(device.label || `Microphone ${index+1}`,device.deviceId));
  if(selected && !devices.some(d=>d.deviceId===selected)) {
    // Keep a disconnected choice explicit instead of silently changing the interview input.
    select.add(new Option('Selected microphone unavailable — choose another',selected));
  }
  select.value=selected;
}
export async function enableMicrophoneCheck() {
  if(!permitted() || requesting || stream)return;
  const ticket=++generation;requesting=true;clearPlayback();controls();
  status('Allow microphone access in your browser to check your input.');
  try {
    if(!navigator.mediaDevices?.getUserMedia)throw Error('Microphone access is unavailable. Open HyperSense on localhost or HTTPS.');
    const input=await navigator.mediaDevices.getUserMedia(microphoneConstraints());
    if(ticket!==generation || !onCheckPage()) {input.getTracks().forEach(track=>track.stop());return;}
    stream=input;requesting=false;controls();
    status('Microphone enabled. Click Record 5-second sample, then speak.');
    const track=stream.getAudioTracks()[0];
    if(!track)throw Error('No audio track was provided by the microphone.');
    track.onended=()=>{if(ticket===generation){stopMicrophoneCheck(false);status('Microphone disconnected. Select an available input and allow access again.');}};
    peak=0;
    const AudioContextClass=window.AudioContext || window.webkitAudioContext;
    if(AudioContextClass) {
      try {
        context=new AudioContextClass();context.resume().catch(()=>{});
        if(ticket!==generation)return;
        analyser=context.createAnalyser();analyser.fftSize=1024;
        context.createMediaStreamSource(stream).connect(analyser);
        const samples=new Float32Array(analyser.fftSize);
        const tick=()=>{
          if(ticket!==generation || !stream || !analyser)return;
          analyser.getFloatTimeDomainData(samples);
          const level=microphoneLevel(samples);peak=Math.max(peak,level);
          $('mic-check-level').value=Math.min(100,level*500);
          $('mic-check-level-text').textContent=level>.003?'Input detected':'Little or no input — speak a few words';
          frame=requestAnimationFrame(tick);
        };tick();
      }catch{if(ticket!==generation)return;if(context)context.close().catch(()=>{});context=null;analyser=null;}
    }
    if(ticket!==generation)return;
    status(analyser?'Microphone enabled. Speak to check the meter, then record a five-second sample.':'Microphone enabled. The volume meter is unavailable; use a test recording to check your audio.');
    if(!window.MediaRecorder && !window.AudioWorkletNode)status('Microphone enabled, but test recording is unsupported in this browser.');
    controls();
    try{await listMicrophones();}catch{ /* Recording can still use the granted input. */ }
  } catch(error) {
    if(ticket!==generation)return;
    stopMicrophoneCheck(false);
    const messages={NotAllowedError:'Microphone permission denied. Allow microphone access in the browser site settings, then retry.',NotFoundError:'No microphone found. Connect an input device and retry.',NotReadableError:'The microphone could not be opened. Check whether another application is using it.',OverconstrainedError:'The selected microphone is unavailable. Choose another input and retry.'};
    status(messages[error.name] || error.message || 'Microphone check failed. Please retry.');
  }
}
export function encodeMicrophoneWav(chunks, sampleRate) {
  const count=chunks.reduce((sum,chunk)=>sum+chunk.length,0);
  if(!count || !Number.isFinite(sampleRate) || sampleRate<=0)throw Error('No microphone samples arrived. Check your input and try again.');
  const buffer=new ArrayBuffer(44+count*2),view=new DataView(buffer);
  const text=(offset,value)=>{for(let i=0;i<value.length;i++)view.setUint8(offset+i,value.charCodeAt(i));};
  text(0,'RIFF');view.setUint32(4,36+count*2,true);text(8,'WAVE');text(12,'fmt ');
  view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,1,true);
  view.setUint32(24,sampleRate,true);view.setUint32(28,sampleRate*2,true);
  view.setUint16(32,2,true);view.setUint16(34,16,true);text(36,'data');view.setUint32(40,count*2,true);
  let offset=44;
  for(const chunk of chunks)for(const value of chunk){const n=Math.max(-1,Math.min(1,value));view.setInt16(offset,n<0?n*32768:n*32767,true);offset+=2;}
  return new Blob([buffer],{type:'audio/wav'});
}
function showSample(blob,ticket,quiet) {
  if(ticket!==generation)return;
  if(!blob.size){status('No audio was recorded. Check your microphone and try again.');return;}
  playbackUrl=URL.createObjectURL(blob);
  const player=$('mic-check-playback');
  $('mic-check-play').disabled=true;
  $('mic-check-playback-help').textContent='Loading your recorded sample…';
  status('Recording finished. Loading playback…');
  player.oncanplay=()=>{
    if(ticket!==generation || !playbackUrl)return;
    $('mic-check-play').disabled=false;
    $('mic-check-playback-help').textContent='Sample ready. Click Play sample or use the audio controls below.';
    status(quiet?'Sample ready, but little or no sound was detected. Play it back and check your input or mute switch.':'Sample ready. Play it back to check clarity and volume. The test microphone is now off.');
  };
  player.onerror=()=>{
    if(ticket!==generation || !playbackUrl)return;
    $('mic-check-play').disabled=true;
    const code=player.error?.code || 'unknown';
    status(`The browser could not read this sample (media error ${code}, ${blob.type}, ${blob.size} bytes). Allow the microphone and record again; if it repeats, share this message.`);
    $('mic-check-playback-help').textContent='Sample could not be loaded.';
  };
  player.src=playbackUrl;player.hidden=false;player.load();
}
async function recordPcmSample(ticket) {
  const ctx=context;
  sampleRunning=true;controls();status('Preparing WAV test recording…');
  let source,node,silent;
  const cleanup=()=>{if(node){node.port.onmessage=null;node.disconnect();}source?.disconnect();silent?.disconnect();};
  pcmCancel=cleanup;
  try {
    // Resume is requested directly from the recording click; never wait indefinitely.
    ctx.resume().catch(()=>{});
    await ctx.audioWorklet.addModule('/static/js/microphone-pcm-worklet.js?v=1');
    if(ticket!==generation)return;
    if(ctx.state!=='running')throw Error('Browser audio is paused. Click Stop test, then Allow microphone and record again.');
    node=new AudioWorkletNode(ctx,'hypersense-mic-test');
    source=ctx.createMediaStreamSource(stream);silent=ctx.createGain();silent.gain.value=0;
    const chunks=[];let samplePeak=0;
    node.port.onmessage=event=>{
      if(ticket!==generation)return;
      if(event.data.samples){const samples=new Float32Array(event.data.samples);chunks.push(samples);samplePeak=Math.max(samplePeak,microphoneLevel(samples));}
      if(event.data.done){
        cleanup();pcmCancel=null;sampleRunning=false;releaseInput();controls();
        try{showSample(encodeMicrophoneWav(chunks,ctx.sampleRate),ticket,samplePeak<=.003);}catch(error){status(error.message);}
      }
    };
    source.connect(node);node.connect(silent);silent.connect(ctx.destination);
    status('Recording for five seconds — speak now.');
    timer=setTimeout(()=>{
      if(ticket!==generation)return;
      node.port.postMessage('finish');
      timer=setTimeout(()=>{if(ticket===generation && sampleRunning){stopMicrophoneCheck();status('Microphone test timed out. Allow the microphone and try again.');}},2000);
    },5000);
  }catch(error){if(ticket===generation){stopMicrophoneCheck();status(error.message || 'Could not record a WAV sample.');}}
}
export function recordMicrophoneSample() {
  if(!permitted() || !stream || sampleRunning || recorder?.state==='recording')return;
  const ticket=generation;
  clearPlayback();peak=0;
  if(context?.audioWorklet && window.AudioWorkletNode)return recordPcmSample(ticket);
  try {
    if(!window.MediaRecorder)throw Error('Test recording is unsupported in this browser.');
    const mime=['audio/webm;codecs=opus','audio/webm','audio/ogg;codecs=opus','audio/mp4'].find(type=>MediaRecorder.isTypeSupported(type));
    const current=mime?new MediaRecorder(stream,{mimeType:mime}):new MediaRecorder(stream);
    recorder=current;const chunks=[];
    current.ondataavailable=event=>{if(ticket===generation && event.data.size)chunks.push(event.data);};
    current.onerror=()=>{if(ticket===generation){stopMicrophoneCheck(false);status('Test recording failed. Allow the microphone and try again.');}};
    current.onstop=()=>{
      if(ticket!==generation)return;
      const hadMeter=Boolean(analyser),detected=peak>.003;
      recorder=null;releaseInput();controls();
      const blob=new Blob(chunks,{type:chunks.find(chunk=>chunk.type)?.type || current.mimeType || mime || 'audio/webm'});
      showSample(blob,ticket,hadMeter && !detected);
    };
    current.onstart=()=>{
      if(ticket!==generation)return;
      status('Recording for five seconds — speak now.');
      timer=setTimeout(()=>{if(ticket===generation && current.state==='recording')current.stop();},5000);
    };
    current.start(250);controls();
  }catch(error){stopMicrophoneCheck(false);status(error.message || 'Could not start the test recording.');}
}
export function initMicrophoneCheck() {
  if(!$('mic-check-enable'))return;
  $('mic-check-enable').onclick=enableMicrophoneCheck;
  $('mic-check-record').onclick=recordMicrophoneSample;
  $('mic-check-play').onclick=async()=>{
    if(!playbackUrl)return;
    try {await $('mic-check-playback').play();}
    catch(error) {status(`Playback failed (${error.name || 'unknown error'}). Try the audio controls or record another sample.`);}
  };
  $('mic-check-stop').onclick=()=>stopMicrophoneCheck();
  $('mic-check-device').onchange=()=>{
    if(!permitted()){$('mic-check-device').value=selected;return;}
    const choice=$('mic-check-device').value;
    stopMicrophoneCheck();selected=choice;
    status('Input selected for this page visit and interview recording. Click Allow microphone to test it.');
  };
  navigator.mediaDevices?.addEventListener?.('devicechange',()=>{
    if(onCheckPage())listMicrophones().catch(()=>status('Could not refresh microphones. Reconnect your device and retry.'));
  });
  window.addEventListener('pagehide',()=>stopMicrophoneCheck());
  document.addEventListener('visibilitychange',()=>{if(document.hidden && (stream || requesting))stopMicrophoneCheck();});
  controls();
}
