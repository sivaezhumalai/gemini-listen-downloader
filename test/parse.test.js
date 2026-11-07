// Run: node --test test/
// Optional real-data check: HAR=/path/to/gemini.google.com.har node --test test/
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ctx = { URL, URLSearchParams, atob, String, Uint8Array };
ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, '../extension/parse.js'), 'utf8'), ctx);
const P = ctx.__geminiListenParse;

const fakeOgg = Buffer.concat([Buffer.from('OggS'), Buffer.alloc(400, 7)]);
const b64 = fakeOgg.toString('base64');

function fakeResponse(audioB64) {
  const line = JSON.stringify([['wrb.fr', 'XqA3Ic', JSON.stringify([audioB64]), null, null, null, 'generic']]);
  const tail = JSON.stringify([['di', 21945], ['af.httprm', 21945, '123', 94]]);
  return `)]}'\n\n${line.length}\n${line}\n${tail.length}\n${tail}\n`;
}

function fakeBody(text, lang) {
  const inner = JSON.stringify(['lyra', text, lang, null, 2]);
  const freq = JSON.stringify([[['XqA3Ic', inner, null, 'generic']]]);
  return new URLSearchParams({ 'f.req': freq, at: 'TOKEN' }).toString();
}

test('isTtsUrl matches only the Listen RPC', () => {
  assert.ok(P.isTtsUrl('https://gemini.google.com/_/BardChatUi/data/batchexecute?rpcids=XqA3Ic&rt=c'));
  assert.ok(P.isTtsUrl('/_/BardChatUi/data/batchexecute?rpcids=abc,XqA3Ic'));
  assert.ok(!P.isTtsUrl('https://gemini.google.com/_/BardChatUi/data/batchexecute?rpcids=ESY5D'));
  assert.ok(!P.isTtsUrl('blob:https://gemini.google.com/9b759332'));
  assert.ok(!P.isTtsUrl(undefined));
});

test('extractAudioBase64 pulls the audio out of a batchexecute response', () => {
  const found = P.extractAudioBase64(fakeResponse(b64));
  assert.strictEqual(found.length, 1);
  assert.strictEqual(found[0], b64);
  assert.strictEqual(P.extractAudioBase64(')]}\'\n\n5\n[["di",1]]\n').length, 0);
  assert.strictEqual(P.extractAudioBase64(null).length, 0);
});

test('base64ToBytes + detectFormat give an OGG file', () => {
  const bytes = P.base64ToBytes(b64);
  assert.strictEqual(Buffer.from(bytes).equals(fakeOgg), true);
  assert.strictEqual(P.detectFormat(bytes).ext, 'ogg');
  assert.strictEqual(P.detectFormat(P.base64ToBytes(b64.replace(/=+$/, ''))).ext, 'ogg');
});

test('parseRequestInfo reads text and language', () => {
  const info = P.parseRequestInfo(fakeBody('வணக்கம் டீம், ஒரு அப்டேட்', 'ta-IN'));
  assert.strictEqual(info.text, 'வணக்கம் டீம், ஒரு அப்டேட்');
  assert.strictEqual(info.lang, 'ta-IN');
  assert.deepStrictEqual({ ...P.parseRequestInfo('garbage') }, { text: '', lang: '' });
});

test('buildFileName keeps Tamil words and strips unsafe characters', () => {
  const name = P.buildFileName(
    { text: 'வணக்கம் டீம்: "Project/Alpha" release <notes> extra words', lang: 'ta-IN' },
    'ogg',
    new Date(2026, 10, 7, 15, 4, 9)
  );
  assert.strictEqual(name, 'gemini-ta-IN-வணக்கம் டீம் Project Alpha release-2026-11-07_15-04-09.ogg');
  assert.strictEqual(P.buildFileName({ text: '', lang: '' }, 'ogg', new Date(2026, 0, 1, 0, 0, 0)), 'gemini-2026-01-01_00-00-00.ogg');
});

test('real HAR capture decodes to a playable audio file', { skip: !process.env.HAR && 'set HAR=... to run' }, () => {
  const har = JSON.parse(fs.readFileSync(process.env.HAR, 'utf8'));
  const entry = har.log.entries.find((e) => P.isTtsUrl(e.request.url));
  assert.ok(entry, 'no XqA3Ic request in HAR');
  const found = P.extractAudioBase64(entry.response.content.text);
  assert.strictEqual(found.length, 1);
  const bytes = P.base64ToBytes(found[0]);
  assert.ok(bytes.length > 1000, `audio too small: ${bytes.length} bytes`);
  assert.strictEqual(P.detectFormat(bytes).ext, 'ogg');
  const info = P.parseRequestInfo(entry.request.postData.text);
  assert.ok(info.lang, 'language code missing');
  assert.ok(info.text.length > 0, 'response text missing');
  console.log('   file name:', P.buildFileName(info, 'ogg'));
});

// ---------- MP3 encoding (mp3.js + vendored lamejs) ----------
const mctx = { Int16Array, Float32Array, Int8Array, Int32Array, Uint8Array, Math, Promise, setTimeout, Error };
mctx.globalThis = mctx;
vm.createContext(mctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, '../extension/vendor/lame.min.js'), 'utf8'), mctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, '../extension/mp3.js'), 'utf8'), mctx);
const M = mctx.__geminiListenMp3;

test('encodeMp3 turns 3 s of 48 kHz mono into a valid MP3 stream', async () => {
  const rate = 48000;
  const f = new Float32Array(rate * 3);
  for (let i = 0; i < f.length; i++) f[i] = 0.4 * Math.sin((2 * Math.PI * 440 * i) / rate);
  let last = 0;
  const parts = await M.encodeMp3(M.floatToInt16(f), rate, 96, (p) => (last = p), () => Promise.resolve());
  const mp3 = Buffer.concat(parts.map((p) => Buffer.from(p.buffer, p.byteOffset, p.length)));
  assert.strictEqual(last, 1);
  assert.strictEqual(mp3[0], 0xff); // MPEG frame sync
  assert.strictEqual(mp3[1] & 0xe0, 0xe0);
  // 96 kbps * 3 s = 36 KB, allow slack for padding/flush
  assert.ok(mp3.length > 30000 && mp3.length < 42000, `size ${mp3.length}`);
  if (process.env.MP3_OUT) fs.writeFileSync(process.env.MP3_OUT, mp3);
});

test('toMono averages channels and clamps in floatToInt16', () => {
  const mono = M.toMono([new Float32Array([1, 0]), new Float32Array([0, 1])]);
  assert.deepStrictEqual(Array.from(mono), [0.5, 0.5]);
  assert.deepStrictEqual(Array.from(M.floatToInt16(new Float32Array([2, -2, 0]))), [32767, -32768, 0]);
});
