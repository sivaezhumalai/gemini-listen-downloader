const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const actx = { Float32Array, Math, Number, String, Promise, Error };
actx.globalThis = actx;
vm.createContext(actx);
vm.runInContext(fs.readFileSync(path.join(__dirname, '../extension/audio.js'), 'utf8'), actx);
const A = actx.__geminiListenAudio;

test('computePeaks computes max absolute peaks per bucket', () => {
  const samples = new Float32Array([0.25, -0.75, 0.5, 0.125, -0.875, 0.5]);
  const peaks = A.computePeaks(samples, 2);
  assert.strictEqual(peaks.length, 2);
  assert.deepStrictEqual(Array.from(peaks), [0.75, 0.875]);

  // clamps > 1 to 1
  const over = new Float32Array([1.5, -2.0, 0.5]);
  const overPeaks = A.computePeaks(over, 1);
  assert.deepStrictEqual(Array.from(overPeaks), [1.0]);

  // empty input returns zeros
  const empty = new Float32Array(0);
  const emptyPeaks = A.computePeaks(empty, 4);
  assert.strictEqual(emptyPeaks.length, 4);
  assert.deepStrictEqual(Array.from(emptyPeaks), [0, 0, 0, 0]);

  // buckets > samples
  const shortSamples = new Float32Array([0.25, 0.75]);
  const buckets4 = A.computePeaks(shortSamples, 4);
  assert.strictEqual(buckets4.length, 4);
  assert.deepStrictEqual(Array.from(buckets4), [0.25, 0.25, 0.75, 0.75]);
});

test('clampSelection handles swap, bounds, minLen push and pull, and short duration', () => {
  // swap if start > end
  assert.deepStrictEqual({ ...A.clampSelection(5, 2, 10, 0.2) }, { start: 2, end: 5 });

  // clamp to bounds [0, duration]
  assert.deepStrictEqual({ ...A.clampSelection(-2, 15, 10, 0.2) }, { start: 0, end: 10 });

  // minLen push forward
  assert.deepStrictEqual({ ...A.clampSelection(2, 2.1, 10, 0.5) }, { start: 2, end: 2.5 });

  // minLen at end of clip pulls start back
  assert.deepStrictEqual({ ...A.clampSelection(9.8, 10, 10, 0.5) }, { start: 9.5, end: 10 });

  // duration < minLen
  assert.deepStrictEqual({ ...A.clampSelection(0.05, 0.1, 0.1, 0.2) }, { start: 0, end: 0.1 });
});

test('sliceSamples extracts correct range and clamps bounds', () => {
  const samples = new Float32Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  const rate = 10;
  // [floor(0.2*10)=2, ceil(0.5*10)=5)
  const sliced = A.sliceSamples(samples, rate, 0.2, 0.5);
  assert.strictEqual(sliced.length, 3);
  assert.deepStrictEqual(Array.from(sliced), [2, 3, 4]);

  // clamps to bounds
  const clamped = A.sliceSamples(samples, rate, -1, 2);
  assert.strictEqual(clamped.length, 10);
  assert.deepStrictEqual(Array.from(clamped), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);

  // returns new Float32Array copy
  sliced[0] = 999;
  assert.strictEqual(samples[2], 2);
});

test('applyFade applies linear fade-in and fade-out without mutating input', () => {
  const rate = 48000;
  const len = rate; // 1 second
  const original = new Float32Array(len).fill(1.0);
  const copy = new Float32Array(original);
  const faded = A.applyFade(original, rate, 0.01);

  // input not mutated
  assert.deepStrictEqual(Array.from(original), Array.from(copy));

  // first sample 0
  assert.strictEqual(faded[0], 0);

  // middle untouched
  const mid = Math.floor(len / 2);
  assert.strictEqual(faded[mid], 1.0);

  // last sample ~0
  assert.ok(Math.abs(faded[faded.length - 1]) < 0.05);

  // fade length capped at half the length
  const short = new Float32Array([1, 1, 1, 1]);
  const fadedShort = A.applyFade(short, 1000, 1.0);
  assert.strictEqual(fadedShort[0], 0);
  assert.ok(Math.abs(fadedShort[fadedShort.length - 1]) < 1);
});

test('formatTime formats seconds to m:ss.s', () => {
  assert.strictEqual(A.formatTime(0), '0:00.0');
  assert.strictEqual(A.formatTime(72.34), '1:12.3');
  assert.strictEqual(A.formatTime(600), '10:00.0');
  assert.strictEqual(A.formatTime(-1), '0:00.0');
  assert.strictEqual(A.formatTime(NaN), '0:00.0');
  assert.strictEqual(A.formatTime(Infinity), '0:00.0');
});
