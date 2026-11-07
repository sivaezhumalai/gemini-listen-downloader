// Pure helpers for reading Gemini's text-to-speech ("Listen") RPC.
//
// When you click "Listen", Gemini POSTs to
//   /_/BardChatUi/data/batchexecute?rpcids=XqA3Ic...
// with f.req = [[["XqA3Ic", "[\"lyra\", <text>, <lang e.g. ta-IN>, null, 2]", ...]]]
// and gets back a batchexecute response whose "wrb.fr" entry carries
// a JSON string ["<base64 OGG/Opus audio>"].
(function () {
  const TTS_RPC_ID = 'XqA3Ic';

  function isTtsUrl(url) {
    if (!url || typeof url !== 'string' || !url.includes('/batchexecute')) return false;
    try {
      const u = new URL(url, 'https://gemini.google.com/');
      const ids = (u.searchParams.get('rpcids') || '').split(',');
      return ids.includes(TTS_RPC_ID);
    } catch (_) {
      return false;
    }
  }

  // Returns every base64 audio string found in a batchexecute response body.
  function extractAudioBase64(responseText) {
    const found = [];
    if (typeof responseText !== 'string') return found;
    for (const rawLine of responseText.split('\n')) {
      const line = rawLine.trim();
      if (!line.startsWith('[') || !line.includes(TTS_RPC_ID)) continue;
      let entries;
      try {
        entries = JSON.parse(line);
      } catch (_) {
        continue;
      }
      if (!Array.isArray(entries)) continue;
      for (const entry of entries) {
        if (!Array.isArray(entry) || entry[0] !== 'wrb.fr' || entry[1] !== TTS_RPC_ID) continue;
        if (typeof entry[2] !== 'string') continue;
        let payload;
        try {
          payload = JSON.parse(entry[2]);
        } catch (_) {
          continue;
        }
        const b64 = findLongString(payload);
        if (b64) found.push(b64);
      }
    }
    return found;
  }

  // The audio is the first long string in the payload (currently payload[0]).
  function findLongString(value) {
    if (typeof value === 'string') return value.length > 200 ? value : null;
    if (Array.isArray(value)) {
      for (const v of value) {
        const s = findLongString(v);
        if (s) return s;
      }
    }
    return null;
  }

  // Reads { text, lang } from the request body (form-encoded f.req=...).
  function parseRequestInfo(body) {
    const info = { text: '', lang: '' };
    if (typeof body !== 'string' || !body) return info;
    try {
      const freq = new URLSearchParams(body).get('f.req');
      if (!freq) return info;
      const outer = JSON.parse(freq);
      const calls = Array.isArray(outer) && Array.isArray(outer[0]) ? outer[0] : [];
      const call = calls.find((c) => Array.isArray(c) && c[0] === TTS_RPC_ID);
      if (!call || typeof call[1] !== 'string') return info;
      const args = JSON.parse(call[1]);
      if (Array.isArray(args)) {
        if (typeof args[1] === 'string') info.text = args[1];
        if (typeof args[2] === 'string') info.lang = args[2];
      }
    } catch (_) {
      /* keep defaults */
    }
    return info;
  }

  function base64ToBytes(b64) {
    let s = b64.replace(/[\s]/g, '').replace(/-/g, '+').replace(/_/g, '/');
    while (s.length % 4) s += '=';
    const bin = atob(s);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  }

  // Sniff the container from magic bytes so the file gets the right extension.
  function detectFormat(bytes) {
    const ascii = (start, len) => String.fromCharCode(...bytes.slice(start, start + len));
    if (ascii(0, 4) === 'OggS') return { ext: 'ogg', mime: 'audio/ogg' };
    if (ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WAVE') return { ext: 'wav', mime: 'audio/wav' };
    if (ascii(0, 3) === 'ID3' || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0)) return { ext: 'mp3', mime: 'audio/mpeg' };
    if (ascii(4, 4) === 'ftyp') return { ext: 'm4a', mime: 'audio/mp4' };
    if (bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) return { ext: 'webm', mime: 'audio/webm' };
    return { ext: 'ogg', mime: 'audio/ogg' };
  }

  // "gemini-ta-IN-இதோ உங்கள் வாட்ஸ்அப்-2026-11-07_15-24.ogg"
  function buildFileName(info, ext, date) {
    const d = date || new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
    const words = (info.text || '')
      .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ')
      .replace(/[^\p{L}\p{M}\p{N} _-]+/gu, ' ')
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 5)
      .join(' ')
      .slice(0, 50)
      .trim();
    const parts = ['gemini'];
    if (info.lang) parts.push(info.lang.replace(/[^A-Za-z0-9-]/g, ''));
    if (words) parts.push(words);
    parts.push(stamp);
    return `${parts.join('-')}.${ext}`;
  }

  globalThis.__geminiListenParse = {
    TTS_RPC_ID,
    isTtsUrl,
    extractAudioBase64,
    parseRequestInfo,
    base64ToBytes,
    detectFormat,
    buildFileName,
  };
})();
