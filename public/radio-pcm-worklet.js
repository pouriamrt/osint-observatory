// Emit mono PCM only. Video frames are never read or sent by the radio pipeline.
class RadioPcm extends AudioWorkletProcessor {
  constructor() { super(); this.buffer = new Float32Array(4096); this.used = 0; }
  process(inputs) {
    const channels = inputs[0];
    if (!channels?.length) return true;
    for (let i = 0; i < channels[0].length; i++) {
      let value = 0; for (const channel of channels) value += channel[i] || 0;
      this.buffer[this.used++] = value / channels.length;
      if (this.used === this.buffer.length) { this.port.postMessage(this.buffer, [this.buffer.buffer]); this.buffer = new Float32Array(4096); this.used = 0; }
    }
    return true;
  }
}
registerProcessor('radio-pcm', RadioPcm);
