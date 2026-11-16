// S1-A microphone capture: the AudioContext runs at 16 kHz, so input blocks are already 16 kHz mono. Blocks are
// gathered into 20 ms frames (320 samples), converted to little-endian PCM16 and posted with a level for the meter.
class CaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.frame = new Int16Array(320);
    this.filled = 0;
    this.sumSquares = 0;
  }
  process(inputs) {
    const input = inputs[0] && inputs[0][0];
    if (!input) return true;
    for (let i = 0; i < input.length; i += 1) {
      const s = Math.max(-1, Math.min(1, input[i]));
      this.frame[this.filled] = s < 0 ? s * 0x8000 : s * 0x7fff;
      this.sumSquares += s * s;
      this.filled += 1;
      if (this.filled === this.frame.length) {
        const rms = Math.sqrt(this.sumSquares / this.frame.length);
        this.port.postMessage({ pcm: this.frame.buffer, rms }, [this.frame.buffer]);
        this.frame = new Int16Array(320);
        this.filled = 0;
        this.sumSquares = 0;
      }
    }
    return true;
  }
}
registerProcessor('call360-capture', CaptureProcessor);
