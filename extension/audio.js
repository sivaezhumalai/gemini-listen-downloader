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
    fingerprint,
    measureLevels,
    normalizeLoudness,
    findSilences,
    shortenPauses,
    applyCleanup,
  };

  /**
   * fingerprint(bytes: Uint8Array) -> string
   * FNV-1a 32-bit hash over ALL bytes (offset basis 0x811c9dc5, prime 0x01000193, use Math.imul and >>>0),
   * returned as `${bytes.length.toString(16)}-${hash.toString(16).padStart(8,'0')}`.
   */
  function fingerprint(bytes) {
    let hash = 0x811c9dc5 >>> 0;
    const len = bytes ? bytes.length : 0;
    for (let i = 0; i < len; i++) {
      hash ^= bytes[i];
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return `${len.toString(16)}-${hash.toString(16).padStart(8, '0')}`;
  }

  /**
   * measureLevels(samples: Float32Array) -> {peak, rms}
   * peak = max |x|; rms = sqrt(mean(x^2)); empty input -> {peak:0, rms:0}.
   */
  function measureLevels(samples) {
    const n = samples ? samples.length : 0;
    if (n === 0) return { peak: 0, rms: 0 };
    let peak = 0;
    let sumSq = 0;
    for (let i = 0; i < n; i++) {
      const val = Math.abs(samples[i]);
      if (val > peak) peak = val;
      sumSq += val * val;
    }
    return { peak, rms: Math.sqrt(sumSq / n) };
  }

  /**
   * normalizeLoudness(samples, opts = {}) -> NEW Float32Array (input untouched)
   * Options: targetRms = 0.1, peakLimit = 0.95, maxGain = 8.
   * gain = min(targetRms / rms, peakLimit / peak, maxGain).
   * If rms === 0 or peak === 0 return an unchanged copy.
   * Never reduce volume: if the computed gain < 1, use gain 1 (return a copy).
   * Multiply every sample by gain. Result must never exceed peakLimit in absolute value.
   */
  function normalizeLoudness(samples, opts = {}) {
    const { targetRms = 0.1, peakLimit = 0.95, maxGain = 8 } = opts;
    const n = samples ? samples.length : 0;
    const out = new Float32Array(samples);
    if (n === 0) return out;

    const { peak, rms } = measureLevels(samples);
    if (rms === 0 || peak === 0) return out;

    const gain = Math.min(targetRms / rms, peakLimit / peak, maxGain);
    if (gain < 1) return out;

    for (let i = 0; i < n; i++) {
      let s = samples[i] * gain;
      if (s > peakLimit) s = peakLimit;
      else if (s < -peakLimit) s = -peakLimit;
      out[i] = s;
    }
    return out;
  }

  /**
   * findSilences(samples, sampleRate, opts = {}) -> Array<{start, end}> in SECONDS, sorted.
   * Options: threshold = 0.02, minSilence = 0.6, windowSec = 0.01.
   * Split the signal into consecutive windows of round(windowSec*sampleRate) samples (last partial window included);
   * a window is silent when its RMS < threshold.
   * Merge consecutive silent windows into runs; return runs whose length >= minSilence.
   * start = firstWindowIndex*windowLen/sampleRate, end = min(n, (lastWindowIndex+1)*windowLen)/sampleRate.
   */
  function findSilences(samples, sampleRate, opts = {}) {
    const { threshold = 0.02, minSilence = 0.6, windowSec = 0.01 } = opts;
    const n = samples ? samples.length : 0;
    if (n === 0 || sampleRate <= 0) return [];

    const windowLen = Math.max(1, Math.round(windowSec * sampleRate));
    const numWindows = Math.ceil(n / windowLen);

    const silentWindows = new Uint8Array(numWindows);
    for (let w = 0; w < numWindows; w++) {
      const start = w * windowLen;
      const end = Math.min(n, (w + 1) * windowLen);
      const len = end - start;
      let sumSq = 0;
      for (let i = start; i < end; i++) {
        const val = samples[i];
        sumSq += val * val;
      }
      const rms = Math.sqrt(sumSq / len);
      if (rms < threshold) {
        silentWindows[w] = 1;
      }
    }

    const runs = [];
    let runStart = -1;
    for (let w = 0; w <= numWindows; w++) {
      if (w < numWindows && silentWindows[w] === 1) {
        if (runStart === -1) runStart = w;
      } else {
        if (runStart !== -1) {
          const firstWindowIndex = runStart;
          const lastWindowIndex = w - 1;
          const start = (firstWindowIndex * windowLen) / sampleRate;
          const end = Math.min(n, (lastWindowIndex + 1) * windowLen) / sampleRate;
          if (end - start >= minSilence - 1e-9) {
            runs.push({ start, end });
          }
          runStart = -1;
        }
      }
    }
    return runs;
  }

  /**
   * shortenPauses(samples, sampleRate, opts = {}) -> {samples: Float32Array, removedSec: number}
   * Options: threshold = 0.02, minSilence = 0.6, keepPause = 0.35, fadeSec = 0.005.
   * Use findSilences(threshold, minSilence).
   * For every silence longer than keepPause, keep keepPause/2 seconds at its beginning and keepPause/2 at its end and drop the middle.
   * Join pieces with a short linear fade-out/fade-in of fadeSec on each side of every cut (fade lengths capped to half of each piece).
   * removedSec = total seconds dropped (computed from sample counts / sampleRate).
   * No silences -> return a copy and removedSec 0. Input must not be mutated.
   */
  function shortenPauses(samples, sampleRate, opts = {}) {
    const {
      threshold = 0.02,
      minSilence = 0.6,
      keepPause = 0.35,
      fadeSec = 0.005,
      windowSec = 0.01,
    } = opts;

    const n = samples ? samples.length : 0;
    if (n === 0 || sampleRate <= 0) {
      return { samples: new Float32Array(samples || 0), removedSec: 0 };
    }

    const silences = findSilences(samples, sampleRate, { threshold, minSilence, windowSec });
    if (!silences || silences.length === 0) {
      return { samples: new Float32Array(samples), removedSec: 0 };
    }

    const cuts = [];
    for (let i = 0; i < silences.length; i++) {
      const s = silences[i];
      if (s.end - s.start > keepPause) {
        const dropStartSec = s.start + keepPause / 2;
        const dropEndSec = s.end - keepPause / 2;
        const startSample = Math.max(0, Math.min(n, Math.round(dropStartSec * sampleRate)));
        const endSample = Math.max(startSample, Math.min(n, Math.round(dropEndSec * sampleRate)));
        if (endSample > startSample) {
          cuts.push({ startSample, endSample });
        }
      }
    }

    if (cuts.length === 0) {
      return { samples: new Float32Array(samples), removedSec: 0 };
    }

    // Build kept pieces
    const pieces = [];
    for (let i = 0; i <= cuts.length; i++) {
      const pStart = (i === 0) ? 0 : cuts[i - 1].endSample;
      const pEnd = (i === cuts.length) ? n : cuts[i].startSample;
      pieces.push(samples.slice(pStart, pEnd));
    }

    // Apply linear fade-out / fade-in on each side of every cut
    for (let i = 0; i < pieces.length; i++) {
      const p = pieces[i];
      const pLen = p.length;
      if (pLen === 0) continue;

      const maxFade = Math.floor(pLen / 2);
      const targetFade = Math.round(fadeSec * sampleRate);
      const fadeLen = Math.min(maxFade, targetFade);
      if (fadeLen <= 0) continue;

      // Cut at start -> fade in
      if (i > 0) {
        for (let j = 0; j < fadeLen; j++) {
          p[j] *= j / fadeLen;
        }
      }

      // Cut at end -> fade out
      if (i < cuts.length) {
        for (let j = 0; j < fadeLen; j++) {
          p[pLen - fadeLen + j] *= (fadeLen - j) / fadeLen;
        }
      }
    }

    let totalLen = 0;
    for (let i = 0; i < pieces.length; i++) {
      totalLen += pieces[i].length;
    }

    const out = new Float32Array(totalLen);
    let offset = 0;
    for (let i = 0; i < pieces.length; i++) {
      out.set(pieces[i], offset);
      offset += pieces[i].length;
    }

    const removedSec = (n - totalLen) / sampleRate;
    return { samples: out, removedSec };
  }

  /**
   * applyCleanup(samples, sampleRate, {boost = false, shorten = false} = {}) -> {samples, removedSec}
   * runs shortenPauses first (if shorten), then normalizeLoudness (if boost);
   * with both false returns {samples: copy, removedSec: 0}.
   */
  function applyCleanup(samples, sampleRate, opts = {}) {
    const { boost = false, shorten = false, ...rest } = opts;
    let curSamples;
    let removedSec = 0;

    if (shorten) {
      const res = shortenPauses(samples, sampleRate, rest);
      curSamples = res.samples;
      removedSec = res.removedSec;
    } else {
      curSamples = new Float32Array(samples);
      removedSec = 0;
    }

    if (boost) {
      curSamples = normalizeLoudness(curSamples, rest);
    }

    return { samples: curSamples, removedSec };
  }
})();
