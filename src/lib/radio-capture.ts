export type AudioMetrics = { duration: number; rms: number; rmsDbfs: number; peakDbfs: number; clippedPercent: number };
export type RadioTranscript = { text: string; segments: { text: string; start: number; end: number; speaker: string }[]; metrics: AudioMetrics; skipped: boolean; reason?: string; source: string; startedAt: string; model: string };
export type TranscriptEntry = RadioTranscript & { id: string; audioUrl: string };
export type RadioSummary = { summary: string; mentions: { kind: string; text: string; quote: string; entryId: string }[]; uncertainties: string[]; model: string; entryIds: string[]; generatedAt: string; basis: string };

export function encodeRadioWav(samples: Float32Array, rate: number) {
  const ratio = rate / 16000, count = Math.floor(samples.length / ratio), bytes = new ArrayBuffer(44 + count * 2), view = new DataView(bytes);
  const text = (offset: number, value: string) => { for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i)); };
  text(0, 'RIFF'); view.setUint32(4, 36 + count * 2, true); text(8, 'WAVE'); text(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, 16000, true); view.setUint32(28, 32000, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true); text(36, 'data'); view.setUint32(40, count * 2, true);
  for (let i = 0; i < count; i++) { const position = i * ratio, left = Math.floor(position), fraction = position - left; const sample = Math.max(-1, Math.min(1, samples[left] * (1 - fraction) + (samples[Math.min(left + 1, samples.length - 1)] || 0) * fraction)); view.setInt16(44 + i * 2, Math.round(sample * (sample < 0 ? 32768 : 32767)), true); }
  return new Blob([bytes], { type: 'audio/wav' });
}
export async function audioBase64(blob: Blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer()); let binary = '';
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(binary);
}
export function keywordMatches(text: string, input: string) {
  return [...new Set(input.split(',').map(value => value.trim()).filter(Boolean).slice(0, 12))].filter(word => text.toLocaleLowerCase().includes(word.toLocaleLowerCase()));
}

export async function captureRadioTab(stream: MediaStream, seconds: number, onChunk: (blob: Blob, startedAt: string, level: number) => void, onLevel: (level: number) => void) {
  const context = new AudioContext(), input = context.createMediaStreamSource(new MediaStream(stream.getAudioTracks()));
  const filter = context.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.value = 3500;
  let node: AudioWorkletNode | undefined, closed = false;
  try {
    await context.audioWorklet.addModule('/radio-pcm-worklet.js');
    node = new AudioWorkletNode(context, 'radio-pcm');
    let samples = new Float32Array(Math.ceil(context.sampleRate * seconds)), used = 0, chunkStart = new Date().toISOString(), sum = 0;
    node.port.onmessage = ({ data }: MessageEvent<Float32Array>) => {
      if (closed || !(data instanceof Float32Array)) return;
      let offset = 0;
      while (offset < data.length) {
        if (!used) chunkStart = new Date().toISOString();
        const amount = Math.min(data.length - offset, samples.length - used), part = data.subarray(offset, offset + amount);
        samples.set(part, used); for (const value of part) sum += value * value; used += amount; offset += amount;
        onLevel(Math.sqrt(part.reduce((total, value) => total + value * value, 0) / part.length));
        if (used === samples.length) { onChunk(encodeRadioWav(samples, context.sampleRate), chunkStart, Math.sqrt(sum / used)); used = 0; sum = 0; }
      }
    };
    input.connect(filter); filter.connect(node); node.connect(context.destination); await context.resume();
  } catch (error) { input.disconnect(); filter.disconnect(); node?.disconnect(); await context.close(); throw error; }
  return () => { closed = true; input.disconnect(); filter.disconnect(); if (node) { node.port.onmessage = null; node.disconnect(); } void context.close(); stream.getTracks().forEach(track => track.stop()); };
}
