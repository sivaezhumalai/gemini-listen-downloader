const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const actx = { Float32Array, Uint8Array, Math, Number, String, Array, Promise, Error };
actx.globalThis = actx;
vm.createContext(actx);
vm.runInContext(fs.readFileSync(path.join(__dirname, '../extension/audio.js'), 'utf8'), actx);
const A = actx.__geminiListenAudio;

test('fingerprint produces stable FNV-1a hash formatted as <lenhex>-<8 hex>', () => {
  const b1 = new Uint8Array([1, 2, 3, 4, 5]);
  const b2 = new Uint8Array([1, 2, 3, 4, 5]);
  const b3 = new Uint8Array([1, 2, 3, 4, 6]);

  // stable
  assert.strictEqual(A.fingerprint(b1), A.fingerprint(b2));

  // differs when one byte changes
  assert.notStrictEqual(A.fingerprint(b1), A.fingerprint(b3));

  // format <lenhex>-<8 hex>
  const fp1 = A.fingerprint(b1);
  assert.match(fp1, /^[0-9a-f]+-[0-9a-f]{8}$/);
  assert.strictEqual(fp1.split('-')[0], (5).toString(16));
  assert.strictEqual(fp1.split('-')[1].length, 8);

  // empty input
  const fpEmpty = A.fingerprint(new Uint8Array(0));
  assert.strictEqual(fpEmpty, '0-811c9dc5');

  // larger length hex formatting
  const b255 = new Uint8Array(255);
  const fp255 = A.fingerprint(b255);
  assert.strictEqual(fp255.split('-')[0], 'ff');
  assert.match(fp255, /^ff-[0-9a-f]{8}$/);
});

test('measureLevels computes peak and RMS correctly', () => {
  // empty input
  const empty = new Float32Array(0);
  assert.deepStrictEqual({ ...A.measureLevels(empty) }, { peak: 0, rms: 0 });

  // known constant signal
  const constSignal = new Float32Array([0.5, -0.5, 0.5, -0.5]);
  const resConst = A.measureLevels(constSignal);
  assert.strictEqual(resConst.peak, 0.5);
  assert.strictEqual(resConst.rms, 0.5);

  // signal with mixed amplitudes
  const mixed = new Float32Array([0, 0.6, -0.8]);
  const resMixed = A.measureLevels(mixed);
  assert.ok(Math.abs(resMixed.peak - 0.8) < 1e-6);
  const expectedRms = Math.sqrt((0 + 0.6 * 0.6 + 0.8 * 0.8) / 3);
  assert.ok(Math.abs(resMixed.rms - expectedRms) < 1e-6);
});

test('normalizeLoudness boosts quiet audio, respects peakLimit and maxGain, and does not mutate', () => {
  // quiet sine gets louder with rms ~= targetRms when not peak-limited
  const n = 2000;
  const quiet = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    quiet[i] = 0.02 * Math.sin((2 * Math.PI * 440 * i) / 8000);
  }
  const normQuiet = A.normalizeLoudness(quiet, { targetRms: 0.1, peakLimit: 0.95, maxGain: 8 });
  const quietLevels = A.measureLevels(normQuiet);
  assert.ok(Math.abs(quietLevels.rms - 0.1) < 0.005, `rms was ${quietLevels.rms}, expected ~0.1`);

  // peak never > peakLimit
  const spike = new Float32Array(200);
  spike[0] = 0.5; // low rms (~0.035), but peak is 0.5
  const normSpike = A.normalizeLoudness(spike, { targetRms: 0.5, peakLimit: 0.95, maxGain: 20 });
  const spikeLevels = A.measureLevels(normSpike);
  assert.ok(spikeLevels.peak <= 0.95 + 1e-6, `peak ${spikeLevels.peak} exceeded peakLimit 0.95`);
  for (let i = 0; i < normSpike.length; i++) {
    assert.ok(Math.abs(normSpike[i]) <= 0.95 + 1e-6);
  }

  // maxGain respected
  const tiny = new Float32Array(100).fill(0.001);
  const normTiny = A.normalizeLoudness(tiny, { targetRms: 0.1, peakLimit: 0.95, maxGain: 4 });
  const tinyLevels = A.measureLevels(normTiny);
  assert.ok(Math.abs(tinyLevels.peak - 0.004) < 1e-6);

  // already-loud input not reduced
  const loud = new Float32Array(100).fill(0.2);
  const normLoud = A.normalizeLoudness(loud, { targetRms: 0.1 });
  assert.strictEqual(normLoud[0], loud[0]);
  assert.deepStrictEqual(Array.from(normLoud), Array.from(loud));

  // silent input unchanged
  const silent = new Float32Array(100);
  const normSilent = A.normalizeLoudness(silent);
  assert.deepStrictEqual(Array.from(normSilent), Array.from(silent));

  // input not mutated
  const original = new Float32Array([0.02, -0.02, 0.01]);
  const copy = new Float32Array(original);
  A.normalizeLoudness(original, { targetRms: 0.1 });
  assert.deepStrictEqual(Array.from(original), Array.from(copy));
});

test('findSilences detects silence runs accurately and ignores short gaps', () => {
  const rate = 8000;
  const signal = new Float32Array(rate * 3);
  // 1 s tone + 1 s silence + 1 s tone
  for (let i = 0; i < rate; i++) {
    signal[i] = 0.5 * Math.sin((2 * Math.PI * 440 * i) / rate);
  }
  // samples rate .. 2*rate - 1 are 0
  for (let i = 2 * rate; i < 3 * rate; i++) {
    signal[i] = 0.5 * Math.sin((2 * Math.PI * 440 * (i - 2 * rate)) / rate);
  }

  // exactly one silence ~[1.0, 2.0] within 0.02 s
  const silences = A.findSilences(signal, rate);
  assert.strictEqual(silences.length, 1);
  assert.ok(Math.abs(silences[0].start - 1.0) <= 0.02, `start ${silences[0].start} not within 0.02s of 1.0`);
  assert.ok(Math.abs(silences[0].end - 2.0) <= 0.02, `end ${silences[0].end} not within 0.02s of 2.0`);

  // short gaps below minSilence ignored
  const shortGap = new Float32Array(rate * 2);
  for (let i = 0; i < shortGap.length; i++) {
    shortGap[i] = 0.5 * Math.sin((2 * Math.PI * 440 * i) / rate);
  }
  const gapStart = Math.round(0.5 * rate);
  const gapEnd = Math.round(0.8 * rate); // 0.3s silence < minSilence 0.6s
  for (let i = gapStart; i < gapEnd; i++) {
    shortGap[i] = 0;
  }
  const noSilences = A.findSilences(shortGap, rate, { minSilence: 0.6 });
  assert.strictEqual(noSilences.length, 0);

  // all-silent input gives one run covering everything
  const allSilent = new Float32Array(rate * 2);
  const allSilences = A.findSilences(allSilent, rate);
  assert.strictEqual(allSilences.length, 1);
  assert.strictEqual(allSilences[0].start, 0);
  assert.strictEqual(allSilences[0].end, 2.0);
});

test('shortenPauses drops middle of long silences with fades, preserves active audio, does not mutate', () => {
  const rate = 8000;
  const signal = new Float32Array(rate * 3);
  for (let i = 0; i < rate; i++) {
    signal[i] = 0.5 * Math.sin((2 * Math.PI * 440 * i) / rate);
  }
  for (let i = 2 * rate; i < 3 * rate; i++) {
    signal[i] = 0.5 * Math.sin((2 * Math.PI * 440 * (i - 2 * rate)) / rate);
  }

  const keepPause = 0.35;
  const res = A.shortenPauses(signal, rate, { keepPause });
  const actualDuration = res.samples.length / rate;
  const expectedDuration = 2 + keepPause;
  assert.ok(
    Math.abs(actualDuration - expectedDuration) <= 0.02,
    `expected duration ~${expectedDuration}, got ${actualDuration}`
  );

  const expectedRemoved = 1 - keepPause;
  assert.ok(
    Math.abs(res.removedSec - expectedRemoved) <= 0.02,
    `expected removedSec ~${expectedRemoved}, got ${res.removedSec}`
  );

  // no-silence input unchanged length
  const tone = new Float32Array(rate);
  for (let i = 0; i < rate; i++) {
    tone[i] = 0.5 * Math.sin((2 * Math.PI * 440 * i) / rate);
  }
  const toneRes = A.shortenPauses(tone, rate);
  assert.strictEqual(toneRes.samples.length, tone.length);
  assert.strictEqual(toneRes.removedSec, 0);

  // input not mutated
  const signalCopy = new Float32Array(signal);
  A.shortenPauses(signal, rate);
  assert.deepStrictEqual(Array.from(signal), Array.from(signalCopy));
});

test('applyCleanup runs shortenPauses, normalizeLoudness, or both as requested', () => {
  const rate = 8000;
  const signal = new Float32Array(rate * 3);
  for (let i = 0; i < rate; i++) {
    signal[i] = 0.02 * Math.sin((2 * Math.PI * 440 * i) / rate);
  }
  for (let i = 2 * rate; i < 3 * rate; i++) {
    signal[i] = 0.02 * Math.sin((2 * Math.PI * 440 * (i - 2 * rate)) / rate);
  }

  // both false: copy and removedSec = 0
  const c0 = A.applyCleanup(signal, rate, { boost: false, shorten: false });
  assert.strictEqual(c0.samples.length, signal.length);
  assert.strictEqual(c0.removedSec, 0);
  assert.deepStrictEqual(Array.from(c0.samples), Array.from(signal));

  // shorten only
  const cShorten = A.applyCleanup(signal, rate, { boost: false, shorten: true });
  assert.ok(cShorten.removedSec > 0.6);
  assert.ok(cShorten.samples.length < signal.length);
  const unboostedLevels = A.measureLevels(cShorten.samples);
  assert.ok(unboostedLevels.peak <= 0.02 + 1e-6);

  // boost only
  const cBoost = A.applyCleanup(signal, rate, { boost: true, shorten: false });
  assert.strictEqual(cBoost.removedSec, 0);
  assert.strictEqual(cBoost.samples.length, signal.length);
  const boostedLevels = A.measureLevels(cBoost.samples);
  assert.ok(boostedLevels.peak > 0.02);

  // both shorten and boost
  const cBoth = A.applyCleanup(signal, rate, { boost: true, shorten: true });
  assert.ok(cBoth.removedSec > 0.6);
  assert.ok(cBoth.samples.length < signal.length);
  const bothLevels = A.measureLevels(cBoth.samples);
  assert.ok(bothLevels.peak > 0.02);
});
