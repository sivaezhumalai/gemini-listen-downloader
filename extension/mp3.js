// OGG/Opus -> MP3 conversion, done entirely in the browser.
// Decoding uses the browser's own decoder (Web Audio); encoding uses LAME (vendor/lame.min.js).
(function () {
  const SAMPLES_PER_CHUNK = 1152 * 40; // ~1 s at 48 kHz; yield to the page between chunks

  function floatToInt16(float32) {
    const out = new Int16Array(float32.length);
    for (let i = 0; i < float32.length; i++) {
      const s = Math.max(-1, Math.min(1, float32[i]));
      out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    return out;
  }

  // Mixes every channel down to one (Gemini's speech is already mono).
  function toMono(channels) {
    if (channels.length === 1) return channels[0];
    const len = channels[0].length;
    const out = new Float32Array(len);
    for (const ch of channels) for (let i = 0; i < len; i++) out[i] += ch[i] / channels.length;
    return out;
  }

  // Encodes mono 16-bit samples to MP3 byte chunks. Pure apart from the lamejs global.
  async function encodeMp3(int16, sampleRate, kbps, onProgress, yieldFn) {
    const lame = globalThis.lamejs;
    if (!lame || !lame.Mp3Encoder) throw new Error('MP3 encoder (lamejs) not loaded');
    const encoder = new lame.Mp3Encoder(1, sampleRate, kbps);
    const parts = [];
    for (let i = 0; i < int16.length; i += SAMPLES_PER_CHUNK) {
      const buf = encoder.encodeBuffer(int16.subarray(i, i + SAMPLES_PER_CHUNK));
      if (buf.length) parts.push(buf);
      if (onProgress) onProgress(Math.min(1, (i + SAMPLES_PER_CHUNK) / int16.length));
      if (yieldFn) await yieldFn();
    }
    const end = encoder.flush();
    if (end.length) parts.push(end);
    return parts;
  }

  // Encodes mono float32 samples to MP3 Blob.
  async function encodeFloatToMp3(float32Mono, sampleRate, onProgress) {
    const pcm = floatToInt16(float32Mono);
    const parts = await encodeMp3(pcm, sampleRate, 96, onProgress, () => new Promise((r) => setTimeout(r, 0)));
    return new Blob(parts, { type: 'audio/mpeg' });
  }

  // Browser only: Blob (ogg) -> Blob (mp3)
  async function convertBlobToMp3(blob, onProgress) {
    const A = globalThis.__geminiListenAudio;
    if (!A || !A.decodeBlob) throw new Error('Audio decoder (__geminiListenAudio) not loaded');
    const decoded = await A.decodeBlob(blob);
    return encodeFloatToMp3(decoded.samples, decoded.sampleRate, onProgress);
  }

  globalThis.__geminiListenMp3 = { floatToInt16, toMono, encodeMp3, convertBlobToMp3, encodeFloatToMp3 };
})();
