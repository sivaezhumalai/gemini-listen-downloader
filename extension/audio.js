// Audio processing helpers: waveform peaks, trimming, fades, time formatting, and decoding.
(function () {
  /**
   * computePeaks(samples: Float32Array, buckets: number) -> Float32Array of length `buckets`
   * each value = max absolute sample in that bucket (0..1, clamp >1 to 1).
   * Buckets split samples evenly (bucket i covers floor(i*n/buckets) .. floor((i+1)*n/buckets),
   * at least one sample; if samples is empty return zeros).
   */
  function computePeaks(samples, buckets) {
    if (buckets <= 0) return new Float32Array(0);
    const out = new Float32Array(buckets);
    const n = samples.length;
    if (n === 0) return out;

    for (let i = 0; i < buckets; i++) {
      let start = Math.floor((i * n) / buckets);
      let end = Math.floor(((i + 1) * n) / buckets);
      if (end <= start) end = start + 1;
      if (start >= n) start = n - 1;
      if (end > n) end = n;

      let max = 0;
      for (let j = start; j < end; j++) {
        const val = Math.abs(samples[j]);
        if (val > max) max = val;
      }
      out[i] = Math.min(1, max);
    }
    return out;
  }

  /**
   * clampSelection(start, end, duration, minLen = 0.2) -> {start, end}
   * swap if start>end, clamp both into [0, duration], and ensure end-start >= minLen
   * by pushing end forward (or start back if end hits duration).
   * If duration < minLen return {start: 0, end: duration}.
   */
  function clampSelection(start, end, duration, minLen = 0.2) {
    if (duration < minLen) {
      return { start: 0, end: duration };
    }
    if (start > end) {
      const tmp = start;
      start = end;
      end = tmp;
    }
    start = Math.max(0, Math.min(duration, start));
    end = Math.max(0, Math.min(duration, end));

    if (end - start < minLen) {
      end = start + minLen;
      if (end > duration) {
        end = duration;
        start = Math.max(0, end - minLen);
      }
    }
    return { start, end };
  }

  /**
   * sliceSamples(samples, sampleRate, start, end) -> new Float32Array copy
   * of indices [floor(start*sampleRate), ceil(end*sampleRate)) clamped to the array bounds.
   */
  function sliceSamples(samples, sampleRate, start, end) {
    const n = samples.length;
    let s = Math.floor(start * sampleRate);
    let e = Math.ceil(end * sampleRate);
    s = Math.max(0, Math.min(n, s));
    e = Math.max(s, Math.min(n, e));
    return samples.slice(s, e);
  }

  /**
   * applyFade(samples, sampleRate, fadeSec = 0.01) -> NEW Float32Array (input untouched)
   * with a linear fade-in over the first fadeSec and fade-out over the last fadeSec
   * (fade length capped at half the length).
   */
  function applyFade(samples, sampleRate, fadeSec = 0.01) {
    const out = new Float32Array(samples);
    const n = out.length;
    if (n === 0) return out;
    const fadeLen = Math.min(Math.floor(n / 2), Math.round(fadeSec * sampleRate));
    if (fadeLen <= 0) return out;

    for (let i = 0; i < fadeLen; i++) {
      out[i] *= i / fadeLen;
    }
    for (let i = 0; i < fadeLen; i++) {
      out[n - fadeLen + i] *= (fadeLen - i) / fadeLen;
    }
    return out;
  }

  /**
   * formatTime(sec) -> "m:ss.s" e.g. 0 -> "0:00.0", 72.34 -> "1:12.3", 600 -> "10:00.0";
   * non-finite or negative -> "0:00.0".
   */
  function formatTime(sec) {
    if (!Number.isFinite(sec) || sec <= 0) return '0:00.0';
    const tenthsTotal = Math.round(sec * 10);
    const m = Math.floor(tenthsTotal / 600);
    const rem = tenthsTotal % 600;
    const s = Math.floor(rem / 10);
    const tenths = rem % 10;
    return `${m}:${String(s).padStart(2, '0')}.${tenths}`;
  }

  /**
   * decodeBlob(blob) (browser only) -> Promise<{samples: Float32Array (mono; average channels if >1), sampleRate, duration}>
   * using new OfflineAudioContext(1, 1, 48000).decodeAudioData(await blob.arrayBuffer()).
   */
  async function decodeBlob(blob) {
    const arrayBuffer = await blob.arrayBuffer();
    const ctx = new OfflineAudioContext(1, 1, 48000);
    const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
    const numChannels = audioBuffer.numberOfChannels;
    let samples;
    if (numChannels === 1) {
      samples = audioBuffer.getChannelData(0);
    } else {
      const len = audioBuffer.length;
      samples = new Float32Array(len);
      for (let c = 0; c < numChannels; c++) {
        const ch = audioBuffer.getChannelData(c);
        for (let i = 0; i < len; i++) {
          samples[i] += ch[i] / numChannels;
        }
      }
    }
    return {
      samples,
      sampleRate: audioBuffer.sampleRate,
      duration: audioBuffer.duration,
    };
  }

  globalThis.__geminiListenAudio = {
    computePeaks,
    clampSelection,
    sliceSamples,
    applyFade,
    formatTime,
    decodeBlob,
  };
})();
