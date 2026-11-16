// S1-A playback: a queue of PCM16 frames from the server for the current response only. `clear` drops everything
// queued at once (barge-in), so interrupted speech never continues and no frame is played twice.
class PlayerProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.queue = [];
    this.offset = 0;
    this.playing = false;
    this.port.onmessage = (e) => {
      const m = e.data;
      if (m.type === 'push') {
        const pcm = new Int16Array(m.pcm);
        const f = new Float32Array(pcm.length);
        for (let i = 0; i < pcm.length; i += 1) f[i] = pcm[i] / 0x8000;
        this.queue.push(f);
      } else if (m.type === 'clear') {
        this.queue = [];
        this.offset = 0;
      }
    };
  }
  process(_inputs, outputs) {
    const out = outputs[0][0];
    let i = 0;
    while (i < out.length && this.queue.length) {
      const head = this.queue[0];
      const n = Math.min(out.length - i, head.length - this.offset);
      out.set(head.subarray(this.offset, this.offset + n), i);
      i += n;
      this.offset += n;
      if (this.offset >= head.length) { this.queue.shift(); this.offset = 0; }
    }
    if (i < out.length) out.fill(0, i);
    const playing = i > 0;
    if (playing !== this.playing) { this.playing = playing; this.port.postMessage({ playing }); }
    return true;
  }
}
registerProcessor('call360-player', PlayerProcessor);
