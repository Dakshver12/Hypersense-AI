// Capture a short, mono PCM sample. Never sends data outside this browser.
class MicrophoneTestPCM extends AudioWorkletProcessor {
  constructor() {
    super();this.active=true;this.remaining=Math.ceil(sampleRate*6);
    this.port.onmessage=event=>{if(event.data==='finish'){this.active=false;this.port.postMessage({done:true});}};
  }
  process(inputs) {
    const channels=inputs[0];
    if(this.active && channels?.length && channels[0]?.length && this.remaining>0) {
      const count=Math.min(channels[0].length,this.remaining),mono=new Float32Array(count);
      for(const channel of channels)for(let i=0;i<count;i++)mono[i]+=channel[i]/channels.length;
      this.remaining-=count;this.port.postMessage({samples:mono},[mono.buffer]);
    }
    return true;
  }
}
registerProcessor('hypersense-mic-test',MicrophoneTestPCM);
