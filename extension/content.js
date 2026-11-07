// Runs in the page's own JS world on gemini.google.com (see manifest "world": "MAIN").
// Captures the audio Gemini plays for "Listen" (RPC XqA3Ic) and shows it in a retro
// cassette-deck panel: play, OGG/MP3 download, trim, clean-up, rename, text, share, library.
(function () {
  if (window.__geminiListenDownloaderLoaded) return;
  window.__geminiListenDownloaderLoaded = true;

  const LOG = '[Gemini Listen Downloader]';
  const P = globalThis.__geminiListenParse;
  const A = globalThis.__geminiListenAudio || null;
  const M = globalThis.__geminiListenMp3 || null;
  const S = globalThis.__geminiListenStore || null;
  if (!P) {
    console.warn(LOG, 'parse.js did not load');
    return;
  }

  const MAX_LIBRARY = 30;
  const SPEEDS = [0.75, 1, 1.25, 1.5, 2];
  const ZOOMS = [1, 2, 4, 8, 16];
  const PREF_KEY = 'gemini-listen-downloader:prefs';

  // ---------- small helpers ----------

  // Remember the Blob behind every audio-sized blob: URL the page creates. Gemini's CSP
  // forbids fetch() on blob: URLs, so replays are read from this map instead (no network).
  const origCreateObjectURL = URL.createObjectURL;
  const origRevokeObjectURL = URL.revokeObjectURL;
  const blobByUrl = new Map();
  URL.createObjectURL = function (obj) {
    const url = origCreateObjectURL.apply(this, arguments);
    try {
      if (obj instanceof Blob && obj.size >= 2048 && (!obj.type || /^(audio\/|application\/octet-stream)/.test(obj.type))) blobByUrl.set(url, obj);
    } catch (_) {
      /* never break the page */
    }
    return url;
  };
  URL.revokeObjectURL = function (url) {
    blobByUrl.delete(url);
    return origRevokeObjectURL.apply(this, arguments);
  };

  const ownUrls = new Set(); // blob: URLs we created (never "capture" our own playback)
  function ownUrl(blob) {
    const u = origCreateObjectURL.call(URL, blob);
    ownUrls.add(u);
    return u;
  }
  function revokeUrl(u) {
    if (!u) return;
    origRevokeObjectURL.call(URL, u);
    ownUrls.delete(u);
  }
  function clamp(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v));
  }
  function safeName(s) {
    return String(s || '')
      .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 100);
  }
  function defaultName(text) {
    const words = String(text || '').replace(/\s+/g, ' ').trim().split(' ').slice(0, 6).join(' ');
    return words.slice(0, 60) || 'Gemini audio';
  }
  function fmtClock(sec) {
    if (!isFinite(sec) || sec < 0) sec = 0;
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
  function fmtTime(sec) {
    return A && A.formatTime ? A.formatTime(sec) : fmtClock(sec);
  }
  function fmtSize(bytes) {
    if (!bytes) return '0 KB';
    return bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`;
  }
  function fmtDate(ms) {
    try {
      const d = new Date(ms);
      return `${d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })} ${d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`;
    } catch (_) {
      return '';
    }
  }
  function fallbackId(bytes) {
    let h = 0x811c9dc5;
    for (let i = 0; i < bytes.length; i++) h = Math.imul(h ^ bytes[i], 0x01000193);
    return `${bytes.length.toString(16)}-${(h >>> 0).toString(16).padStart(8, '0')}`;
  }
  function loadPrefs() {
    try {
      return Object.assign({ boost: false, shorten: false }, JSON.parse(localStorage.getItem(PREF_KEY) || '{}'));
    } catch (_) {
      return { boost: false, shorten: false };
    }
  }
  function savePrefs(p) {
    try {
      localStorage.setItem(PREF_KEY, JSON.stringify(p));
    } catch (_) {
      /* private mode etc. */
    }
  }
  function download(url, fileName) {
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.rel = 'noopener';
    a.style.display = 'none';
    (document.body || document.documentElement).appendChild(a);
    a.click();
    a.remove();
  }

  // DOM builders (no innerHTML: Gemini enforces Trusted Types)
  function h(tag, props, ...children) {
    const n = document.createElement(tag);
    if (props) {
      for (const [k, v] of Object.entries(props)) {
        if (v == null || v === false) continue;
        if (k === 'class') n.className = v;
        else if (k === 'text') n.textContent = v;
        else if (k === 'on') for (const [ev, fn] of Object.entries(v)) n.addEventListener(ev, fn);
        else if (k in n && typeof v !== 'string') n[k] = v;
        else n.setAttribute(k, v === true ? '' : v);
      }
    }
    for (const c of children.flat()) if (c != null) n.append(c);
    return n;
  }
  const SVG_NS = 'http://www.w3.org/2000/svg';
  function s(tag, attrs, ...children) {
    const n = document.createElementNS(SVG_NS, tag);
    if (attrs) for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
    for (const c of children) n.append(c);
    return n;
  }

  // ---------- capture: Gemini's TTS response ----------

  function handleResponse(responseText, requestBody) {
    const list = P.extractAudioBase64(responseText);
    if (!list.length) return;
    const info = P.parseRequestInfo(requestBody);
    for (const b64 of list) {
      try {
        addCapture(P.base64ToBytes(b64), info, 'listen');
      } catch (e) {
        console.warn(LOG, 'could not decode audio', e);
      }
    }
  }

  function addCapture(bytes, info, source) {
    const fmt = P.detectFormat(bytes);
    const id = A && A.fingerprint ? A.fingerprint(bytes) : fallbackId(bytes);
    deck.capture({ id, bytes, fmt, info: info || { text: '', lang: '' }, source });
  }

  function bodyToString(body) {
    if (typeof body === 'string') return body;
    if (body instanceof URLSearchParams) return body.toString();
    return null;
  }

  // XMLHttpRequest (what Gemini's batchexecute client uses today)
  const xhrProto = XMLHttpRequest.prototype;
  const origOpen = xhrProto.open;
  const origSend = xhrProto.send;
  xhrProto.open = function (method, url) {
    try {
      this.__glUrl = url instanceof URL ? url.href : String(url);
    } catch (_) {
      this.__glUrl = '';
    }
    return origOpen.apply(this, arguments);
  };
  xhrProto.send = function (body) {
    if (this.__glUrl && P.isTtsUrl(this.__glUrl)) {
      const reqBody = bodyToString(body);
      this.addEventListener('load', () => {
        try {
          if (this.responseType !== '' && this.responseType !== 'text') return;
          handleResponse(this.responseText, reqBody);
        } catch (e) {
          console.warn(LOG, e);
        }
      });
    }
    return origSend.apply(this, arguments);
  };

  // fetch (in case Gemini switches transport)
  const origFetch = window.fetch;
  if (typeof origFetch === 'function') {
    window.fetch = function (input, init) {
      const promise = origFetch.apply(this, arguments);
      try {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input && input.url;
        if (P.isTtsUrl(url)) {
          const reqBody = init ? bodyToString(init.body) : null;
          promise
            .then((res) => res.clone().text())
            .then((text) => handleResponse(text, reqBody))
            .catch((e) => console.warn(LOG, e));
        }
      } catch (e) {
        console.warn(LOG, e);
      }
      return promise;
    };
  }

  // ---------- capture: replays ----------
  // If Gemini replays audio it fetched earlier (no new request), read the Blob behind the
  // blob: URL the page's own <audio> is about to play (remembered when the page created it).
  // Same bytes -> same id, so no duplicates.
  const checkedMedia = new Set();
  const mediaProto = HTMLMediaElement.prototype;
  const origPlay = mediaProto.play;
  mediaProto.play = function () {
    try {
      captureFromMedia(this);
    } catch (_) {
      /* never break the page's playback */
    }
    return origPlay.apply(this, arguments);
  };
  function captureFromMedia(el) {
    const src = el.currentSrc || el.src;
    if (!src || !src.startsWith('blob:') || ownUrls.has(src) || checkedMedia.has(src)) return;
    const blob = blobByUrl.get(src);
    if (!blob) return; // created before the extension loaded, or not audio: nothing to read
    checkedMedia.add(src);
    blob
      .arrayBuffer()
      .then((buf) => {
        const bytes = new Uint8Array(buf);
        const isOgg = bytes[0] === 0x4f && bytes[1] === 0x67 && bytes[2] === 0x67 && bytes[3] === 0x53;
        if (!isOgg && !/^audio\//.test(blob.type)) return;
        addCapture(bytes, { text: '', lang: '' }, 'replay');
      })
      .catch((e) => console.debug(LOG, 'replay capture skipped:', e && e.message));
  }

  // ---------- styles ----------

  const CSS = `
    :host { all: initial; }
    *, *::before, *::after { box-sizing: border-box; }
    .root {
      --body: #e8dcc2; --body-2: #d6c5a0; --edge: #3b2f27; --ink: #2b211a; --muted: #6e5c4a;
      --accent: #d9541e; --accent-2: #e8a33d; --teal: #2f8a84;
      --key: #f6eedc; --key-2: #e2d4b4; --key-shadow: #9c8763; --key-ink: #2b211a;
      --shell: #34302c; --shell-2: #24211f; --paper: #f8f1de; --paper-line: #e0d2b0;
      --window: rgba(20, 16, 12, .82); --tape: #6b4a32; --hub: #f1e9d6;
      --lcd-bg: #191712; --lcd-fg: #ffb347; --lcd-dim: #5a4224;
      --scope-bg: #10140f; --scope-fg: #9cf06a; --scope-dim: #3c5a2c; --scope-grid: #1f2a1b;
      --led-off: #6b5a48; --led-on: #ff6a2b;
      position: fixed; right: 16px; bottom: 16px; z-index: 2147483647;
      font: 13px/1.35 "Trebuchet MS", "Segoe UI", Roboto, "Noto Sans Tamil", "Nirmala UI", Latha, Arial, sans-serif;
      color: var(--ink);
    }
    @media (prefers-color-scheme: dark) {
      .root {
        --body: #2c2621; --body-2: #211c18; --edge: #0f0c0a; --ink: #f2e7d0; --muted: #b8a68c;
        --key: #463d36; --key-2: #362f29; --key-shadow: #120f0c; --key-ink: #f2e7d0;
        --paper: #ece2c8; --paper-line: #d4c5a2; --led-off: #4c4038;
      }
    }
    .hidden { display: none !important; }

    /* ----- deck shell ----- */
    .deck {
      width: min(440px, calc(100vw - 32px)); max-height: min(86vh, 760px); display: flex; flex-direction: column;
      background: linear-gradient(180deg, var(--body), var(--body-2));
      border: 3px solid var(--edge); border-radius: 14px; outline: none;
      box-shadow: 0 2px 0 rgba(255,255,255,.25) inset, 0 10px 30px rgba(0,0,0,.45), 0 0 0 1px rgba(0,0,0,.2);
    }
    .head {
      display: flex; align-items: center; gap: 8px; padding: 8px 10px 8px 12px;
      border-bottom: 3px solid var(--edge); background: var(--body-2); border-radius: 11px 11px 0 0;
    }
    .brand { flex: 1; display: flex; align-items: center; gap: 8px; min-width: 0; }
    .stripes { display: flex; gap: 2px; transform: skewX(-18deg); }
    .stripes i { display: block; width: 6px; height: 18px; }
    .stripes i:nth-child(1) { background: var(--accent); }
    .stripes i:nth-child(2) { background: var(--accent-2); }
    .stripes i:nth-child(3) { background: var(--teal); }
    .logo { font: italic 900 15px/1 "Arial Black", "Trebuchet MS", sans-serif; letter-spacing: .5px; white-space: nowrap; }
    .logo small { font: 700 9px/1 "Courier New", monospace; letter-spacing: 2px; color: var(--muted); margin-left: 4px; font-style: normal; }
    .body { overflow: auto; padding: 12px; display: flex; flex-direction: column; gap: 10px; }

    /* ----- keys ----- */
    .key {
      all: unset; box-sizing: border-box; cursor: pointer; user-select: none; text-align: center;
      display: inline-flex; align-items: center; justify-content: center; gap: 5px;
      min-height: 32px; padding: 0 10px; border-radius: 5px; border: 2px solid var(--edge);
      background: linear-gradient(180deg, var(--key), var(--key-2)); color: var(--key-ink);
      font: 700 11px/1 "Trebuchet MS", "Noto Sans Tamil", sans-serif; letter-spacing: .6px; text-transform: uppercase;
      box-shadow: 0 3px 0 var(--key-shadow); transition: transform .05s, box-shadow .05s;
    }
    .key:hover { filter: brightness(1.05); }
    .key:active, .key.on { transform: translateY(2px); box-shadow: 0 1px 0 var(--key-shadow); }
    .key.on { background: linear-gradient(180deg, var(--key-2), var(--key)); }
    .key:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
    .key[disabled] { opacity: .55; cursor: progress; }
    .key.primary { background: linear-gradient(180deg, #f07a3f, var(--accent)); color: #fff8ec; }
    .key.small { min-height: 26px; padding: 0 8px; font-size: 10px; }
    .key.icon { min-width: 30px; padding: 0 6px; font-size: 13px; }
    .key.danger { color: #b3261e; }
    .keys { display: grid; gap: 6px; }
    .transport { grid-template-columns: 1fr 1.6fr 1fr 1fr 1.1fr; }
    .transport .key { min-height: 38px; font-size: 15px; }
    .transport .key.speed { font: 700 12px/1 "Courier New", monospace; }
    .functions { grid-template-columns: repeat(auto-fit, minmax(72px, 1fr)); }

    /* ----- cassette ----- */
    .cassette { position: relative; width: 100%; aspect-ratio: 2 / 1; user-select: none; }
    .cassette svg { position: absolute; inset: 0; width: 100%; height: 100%; display: block; }
    .reel { transform-box: fill-box; transform-origin: center; animation: spin var(--spin, 2.4s) linear infinite; animation-play-state: paused; }
    .playing .reel { animation-play-state: running; }
    @keyframes spin { to { transform: rotate(-360deg); } }
    .label { position: absolute; left: 15.5%; right: 7%; top: 10%; height: 30%; display: flex; flex-direction: column; justify-content: center; padding: 0 4px; color: #2b211a; }
    .name {
      all: unset; cursor: text; font: 700 14px/1.25 "Courier New", "Noto Sans Tamil", monospace;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis; border-bottom: 1px dashed transparent;
    }
    .name:hover { border-bottom-color: #9c8763; }
    .name-input { all: unset; font: 700 14px/1.25 "Courier New", "Noto Sans Tamil", monospace; color: #2b211a; background: #fffaf0; border: 1px solid #9c8763; padding: 0 3px; }
    .meta { font: 11px/1.2 "Courier New", monospace; color: #6e5c4a; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

    /* ----- lcd ----- */
    .lcd-row { display: flex; gap: 8px; align-items: stretch; }
    .lcd {
      flex: 1; display: flex; align-items: baseline; justify-content: space-between; gap: 8px;
      background: var(--lcd-bg); color: var(--lcd-fg); border: 2px solid var(--edge); border-radius: 6px; padding: 6px 10px;
      font: 700 20px/1 "Courier New", ui-monospace, monospace; letter-spacing: 1px; text-shadow: 0 0 6px rgba(255,179,71,.55);
      box-shadow: inset 0 0 12px rgba(0,0,0,.8);
    }
    .lcd .total { color: var(--lcd-dim); text-shadow: none; font-size: 14px; }
    .lcd .spd { font-size: 12px; }
    .vu { display: flex; gap: 2px; align-items: flex-end; background: var(--lcd-bg); border: 2px solid var(--edge); border-radius: 6px; padding: 6px; }
    .vu i { display: block; width: 5px; height: 22px; border-radius: 1px; background: #2b2a24; }
    .vu i.lit { background: #8fdc5a; box-shadow: 0 0 4px #8fdc5a; }
    .vu i.lit.warm { background: #ffb347; box-shadow: 0 0 4px #ffb347; }
    .vu i.lit.hot { background: #ff5a3c; box-shadow: 0 0 4px #ff5a3c; }

    /* ----- seek (tape track) ----- */
    .seek { -webkit-appearance: none; appearance: none; width: 100%; height: 14px; background: transparent; cursor: pointer; margin: 0; }
    .seek::-webkit-slider-runnable-track { height: 6px; border-radius: 3px; border: 1px solid var(--edge); background: linear-gradient(90deg, var(--accent) var(--p, 0%), var(--body-2) var(--p, 0%)); }
    .seek::-webkit-slider-thumb { -webkit-appearance: none; width: 14px; height: 14px; margin-top: -5px; border-radius: 3px; border: 2px solid var(--edge); background: var(--key); }

    /* ----- switches ----- */
    .switches { display: flex; gap: 14px; flex-wrap: wrap; align-items: center; font: 700 10px/1 "Trebuchet MS", sans-serif; letter-spacing: .8px; text-transform: uppercase; color: var(--muted); }
    .switch { all: unset; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; color: var(--ink); }
    .switch .led { width: 10px; height: 10px; border-radius: 50%; background: var(--led-off); border: 1px solid var(--edge); }
    .switch[aria-pressed="true"] .led { background: var(--led-on); box-shadow: 0 0 6px var(--led-on); }
    .switch:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
    .switches .hint { flex-basis: 100%; font: 10px/1.2 "Courier New", monospace; letter-spacing: 0; text-transform: none; }

    /* ----- status ----- */
    .status { min-height: 22px; background: var(--lcd-bg); color: var(--lcd-fg); border: 2px solid var(--edge); border-radius: 5px; padding: 4px 8px; font: 700 11px/1.2 "Courier New", monospace; letter-spacing: .5px; text-transform: uppercase; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .status.err { color: #ff6b5a; }
    .status.ok { color: #9cf06a; }

    /* ----- drawers ----- */
    .drawer { border: 2px solid var(--edge); border-radius: 8px; background: var(--body-2); padding: 10px; display: flex; flex-direction: column; gap: 8px; }
    .drawer-title { font: 900 11px/1 "Arial Black", sans-serif; letter-spacing: 1.5px; text-transform: uppercase; display: flex; align-items: center; justify-content: space-between; gap: 8px; }
    .scope-wrap { position: relative; border: 2px solid var(--edge); border-radius: 6px; overflow: hidden; background: var(--scope-bg); }
    .scope { display: block; width: 100%; height: 84px; touch-action: none; cursor: crosshair; }
    .row { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
    .marker { display: flex; align-items: center; gap: 4px; }
    .marker .t { font: 700 12px/1 "Courier New", monospace; min-width: 52px; text-align: center; }
    .grow { flex: 1; }
    .hint { color: var(--muted); font: 10px/1.3 "Courier New", monospace; }
    .text-box { max-height: 180px; overflow: auto; white-space: pre-wrap; background: var(--paper); color: #2b211a; border: 1px solid var(--paper-line); border-radius: 4px; padding: 8px; font: 13px/1.5 "Noto Sans Tamil", "Nirmala UI", Latha, "Trebuchet MS", sans-serif;
      background-image: repeating-linear-gradient(180deg, transparent 0 18.5px, var(--paper-line) 18.5px 19.5px); }
    .empty { text-align: center; padding: 22px 10px; color: var(--muted); font: 12px/1.5 "Courier New", monospace; }

    /* ----- rack (library) ----- */
    .rack-list { display: flex; flex-direction: column; gap: 6px; }
    .tape {
      display: grid; grid-template-columns: 34px 1fr auto; gap: 8px; align-items: center; cursor: pointer;
      background: var(--key); border: 2px solid var(--edge); border-radius: 6px; padding: 6px 8px; box-shadow: 0 2px 0 var(--key-shadow);
    }
    .tape:hover { filter: brightness(1.04); }
    .tape.current { outline: 2px solid var(--accent); outline-offset: 1px; }
    .tape-icon { width: 34px; height: 22px; border-radius: 3px; background: var(--shell); position: relative; }
    .tape-icon::before { content: ""; position: absolute; left: 4px; right: 4px; top: 3px; height: 6px; background: var(--accent-2); border-radius: 1px; }
    .tape-icon::after { content: ""; position: absolute; left: 9px; right: 9px; bottom: 3px; height: 6px; border-radius: 3px; background: var(--hub); }
    .tape-name { font: 700 12px/1.25 "Courier New", "Noto Sans Tamil", monospace; color: var(--key-ink); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .tape-meta { font: 10px/1.2 "Courier New", monospace; color: var(--muted); }
    .rack-foot { display: flex; align-items: center; gap: 8px; font: 10px/1.2 "Courier New", monospace; color: var(--muted); }

    /* ----- pill ----- */
    .pill-wrap { display: flex; align-items: center; gap: 4px; }
    .pill { min-height: 40px; padding: 0 14px; font-size: 12px; box-shadow: 0 3px 0 var(--key-shadow), 0 8px 20px rgba(0,0,0,.35); }
    .pill .mini { width: 26px; height: 16px; border-radius: 3px; background: var(--shell); position: relative; display: inline-block; }
    .pill .mini::before, .pill .mini::after { content: ""; position: absolute; top: 4px; width: 7px; height: 7px; border-radius: 50%; background: var(--hub); }
    .pill .mini::before { left: 4px; } .pill .mini::after { right: 4px; }
    .pill-x { min-height: 24px; min-width: 24px; padding: 0; font-size: 11px; }
  `;

  // ---------- the deck ----------

  const deck = (() => {
    const clips = new Map(); // id -> clip
    const prefs = loadPrefs();
    let current = null;
    let built = false;
    let view = 'deck'; // 'deck' | 'rack'
    let mode = 'hidden'; // 'hidden' | 'pill' | 'open'
    let libraryOk = false;
    let busy = false;
    let statusTimer = null;

    // elements
    let host, root, deckEl, pillWrap, pillCount, bodyEl, rackEl, rackList, rackFoot, rackBtn;
    let emptyEl, playerEl, cassetteEl, svgEl, reelL, reelR, packL, packR, nameEl, metaEl;
    let lcdCur, lcdTotal, lcdSpd, vuBars = [], seekEl, playBtn, speedBtn, statusEl;
    let btnOgg, btnMp3, btnTrim, btnText, btnShare, swBoost, swShorten;
    let trimEl, scope, inT, outT, lenT, zoomT, previewBtn, trimDl;
    let textEl, textBox;

    // audio
    const audio = new Audio();
    audio.preload = 'auto';
    let actx = null;
    let analyser = null;
    let vuBuf = null;
    let raf = 0;
    let previewing = false;

    // trim view
    let zoomIdx = 0;
    let viewStart = 0;
    let peaksCache = { key: '', peaks: null };
    let drag = null;

    // ----- model -----

    function newClip(rec) {
      return {
        id: rec.id,
        blob: rec.blob,
        mime: rec.mime || rec.blob.type || 'audio/ogg',
        ext: rec.ext || (/(mpeg|mp3)/.test(rec.mime || '') ? 'mp3' : 'ogg'),
        text: rec.text || '',
        lang: rec.lang || '',
        name: rec.name || defaultName(rec.text),
        fileBase: rec.fileName || 'gemini-audio',
        createdAt: rec.createdAt || Date.now(),
        duration: rec.duration || null,
        size: rec.size || rec.blob.size,
        url: null,
        decoded: null,
        trim: null,
        mp3: null, // { key, blob, url }
        shareFile: null,
      };
    }

    function toRecord(c) {
      return { id: c.id, blob: c.blob, mime: c.mime, text: c.text, lang: c.lang, name: c.name, fileName: c.fileBase, createdAt: c.createdAt, duration: c.duration, size: c.size };
    }

    function sortedClips() {
      return [...clips.values()].sort((a, b) => b.createdAt - a.createdAt);
    }

    async function persist(c) {
      if (!libraryOk) return;
      try {
        await S.saveClip(toRecord(c));
        const removed = await S.prune(MAX_LIBRARY);
        if (removed) {
          const keep = new Set((await S.listClips()).map((r) => r.id));
          for (const id of [...clips.keys()]) if (!keep.has(id) && id !== (current && current.id)) dropClip(id);
        }
      } catch (e) {
        console.warn(LOG, 'library save failed', e);
        setStatus('Library save failed – tape kept until reload', 'err');
      }
    }

    function dropClip(id) {
      const c = clips.get(id);
      if (!c) return;
      revokeUrl(c.url);
      if (c.mp3) revokeUrl(c.mp3.url);
      clips.delete(id);
    }

    // ----- capture entry point -----

    function capture({ id, bytes, fmt, info, source }) {
      let c = clips.get(id);
      const isNew = !c;
      if (c) {
        if (!c.text && info.text) {
          c.text = info.text;
          c.lang = info.lang || c.lang;
          if (c.name === 'Gemini audio' || c.name === 'Replayed audio') c.name = defaultName(info.text);
          c.fileBase = P.buildFileName(info, c.ext).replace(/\.[a-z0-9]+$/i, '');
          if (libraryOk) S.updateClip(c.id, { text: c.text, lang: c.lang, name: c.name, fileName: c.fileBase }).catch(() => persist(c));
        }
      } else {
        const blob = new Blob([bytes], { type: fmt.mime });
        const fileName = P.buildFileName(info, fmt.ext).replace(/\.[a-z0-9]+$/i, '');
        c = newClip({ id, blob, mime: fmt.mime, ext: fmt.ext, text: info.text, lang: info.lang, fileName, size: bytes.length, name: info.text ? defaultName(info.text) : source === 'replay' ? 'Replayed audio' : 'Gemini audio' });
        c.ext = fmt.ext;
        clips.set(id, c);
        persist(c);
      }
      build();
      setMode('open');
      setView('deck');
      if (current !== c) load(c);
      else refreshLabel();
      renderRack();
      setStatus(isNew ? (source === 'replay' ? 'Replay captured – new tape' : 'New tape recorded') : 'Already in the rack – loaded it', 'ok');
    }

    // ----- building the UI -----

    function build() {
      if (built) {
        if (!host.isConnected) (document.body || document.documentElement).appendChild(host);
        return;
      }
      built = true;
      host = h('div', { id: 'gemini-listen-downloader' });
      const shadow = host.attachShadow({ mode: 'open' });
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(CSS);
      shadow.adoptedStyleSheets = [sheet];
      root = h('div', { class: 'root' });
      shadow.append(root);

      // pill (collapsed)
      pillCount = h('span', { text: 'TAPES' });
      pillWrap = h(
        'div',
        { class: 'pill-wrap hidden' },
        h('button', { class: 'key pill', title: 'Open the Gemini tape deck', on: { click: () => setMode('open') } }, h('span', { class: 'mini' }), pillCount),
        h('button', { class: 'key pill-x', title: 'Hide until the next Listen', text: '✕', on: { click: () => setMode('hidden') } })
      );

      // header
      rackBtn = h('button', { class: 'key small', title: 'Saved tapes', text: 'Rack', on: { click: () => setView(view === 'rack' ? 'deck' : 'rack') } });
      const head = h(
        'div',
        { class: 'head' },
        h('div', { class: 'brand' }, h('div', { class: 'stripes' }, h('i'), h('i'), h('i')), h('div', { class: 'logo', text: 'GEMINI' }, h('small', { text: 'TAPE DECK' }))),
        rackBtn,
        h('button', { class: 'key small icon', title: 'Minimise', text: '–', on: { click: () => setMode('pill') } })
      );

      // empty state
      emptyEl = h('div', { class: 'empty' }, 'No tape loaded.', h('br'), 'Click “Listen” on any Gemini answer', h('br'), 'or open the Rack.');

      // cassette
      cassetteEl = h('div', { class: 'cassette' });
      buildCassetteSvg();
      nameEl = h('button', { class: 'name', title: 'Click to rename', on: { click: startRename } });
      metaEl = h('div', { class: 'meta' });
      cassetteEl.append(svgEl, h('div', { class: 'label' }, nameEl, metaEl));

      // lcd + vu
      lcdCur = h('span', { text: '00:00' });
      lcdTotal = h('span', { class: 'total', text: '/ 00:00' });
      lcdSpd = h('span', { class: 'spd', text: '1.0×' });
      const vu = h('div', { class: 'vu', title: 'Level' });
      for (let i = 0; i < 10; i++) {
        const bar = h('i', { class: i >= 8 ? 'hot' : i >= 6 ? 'warm' : '' });
        vuBars.push(bar);
        vu.append(bar);
      }
      const lcdRow = h('div', { class: 'lcd-row' }, h('div', { class: 'lcd' }, h('span', null, lcdCur, ' ', lcdTotal), lcdSpd), vu);

      seekEl = h('input', { class: 'seek', type: 'range', min: '0', max: '1000', value: '0', title: 'Seek', on: { input: onSeekInput } });

      // transport
      playBtn = h('button', { class: 'key', title: 'Play / pause (Space)', text: '▶', on: { click: togglePlay } });
      speedBtn = h('button', { class: 'key speed', title: 'Playback speed (preview only)', text: '1.0×', on: { click: cycleSpeed } });
      const transport = h(
        'div',
        { class: 'keys transport' },
        h('button', { class: 'key', title: 'Back 5 s (Shift+←)', text: '⏪', on: { click: () => seekBy(-5) } }),
        playBtn,
        h('button', { class: 'key', title: 'Stop', text: '■', on: { click: stop } }),
        h('button', { class: 'key', title: 'Forward 5 s (Shift+→)', text: '⏩', on: { click: () => seekBy(5) } }),
        speedBtn
      );

      // functions
      btnOgg = h('button', { class: 'key', title: 'Original audio, exactly as Gemini sent it', text: '⬇ OGG', on: { click: downloadOgg } });
      btnMp3 = h('button', { class: 'key primary', title: 'Convert to MP3 (plays everywhere)', text: '⬇ MP3', on: { click: downloadMp3 } });
      btnTrim = h('button', { class: 'key', title: 'Cut a part (start / end markers)', text: '✂ Trim', on: { click: () => toggleDrawer('trim') } });
      btnText = h('button', { class: 'key', title: 'Show / copy the spoken text', text: '✎ Text', on: { click: () => toggleDrawer('text') } });
      btnShare = h('button', { class: 'key', title: 'Share the MP3', text: '⤴ Share', on: { click: share } });
      if (!canShareFiles()) btnShare.classList.add('hidden');
      const functions = h('div', { class: 'keys functions' }, btnOgg, btnMp3, btnTrim, btnText, btnShare);

      // switches
      swBoost = makeSwitch('Boost volume', 'boost', 'Make quiet speech louder (MP3 only)');
      swShorten = makeSwitch('Shorten pauses', 'shorten', 'Cut long silences down to ~⅓ s (MP3 only)');
      const switches = h('div', { class: 'switches' }, swBoost, swShorten, h('span', { class: 'hint', text: 'Clean-up applies to MP3 exports. OGG is always the untouched original.' }));

      statusEl = h('div', { class: 'status', text: 'Ready' });

      buildTrimDrawer();
      buildTextDrawer();

      playerEl = h('div', { class: 'hidden' }, cassetteEl, lcdRow, seekEl, transport, functions, switches, statusEl, trimEl, textEl);
      bodyEl = h('div', { class: 'body' }, emptyEl, playerEl);

      // rack
      rackList = h('div', { class: 'rack-list' });
      rackFoot = h('div', { class: 'rack-foot' });
      rackEl = h('div', { class: 'body hidden' }, h('div', { class: 'drawer-title', text: 'Tape rack' }), rackList, rackFoot);

      deckEl = h('div', { class: 'deck hidden', tabindex: '0' }, head, bodyEl, rackEl);
      root.append(deckEl, pillWrap);
      (document.body || document.documentElement).appendChild(host);

      shadow.addEventListener('keydown', onKey);
      shadow.addEventListener('keyup', (e) => {
        if (e.key === ' ' && isButton(e)) e.preventDefault();
      });
      deckEl.addEventListener('pointerdown', (e) => {
        if (!isTyping(e)) setTimeout(() => deckEl.focus({ preventScroll: true }), 0);
      });

      audio.addEventListener('play', onPlayState);
      audio.addEventListener('pause', onPlayState);
      audio.addEventListener('ended', onPlayState);
      audio.addEventListener('loadedmetadata', onMeta);
      audio.addEventListener('durationchange', onMeta);
      audio.addEventListener('timeupdate', () => {
        if (!raf) updateClock();
      });
      audio.addEventListener('seeked', () => {
        updateClock();
        drawScope();
      });
      new ResizeObserver(() => drawScope()).observe(scope);
      updateSwitches();
      applySpeed(SPEEDS[speedIndex()]);
    }

    function buildCassetteSvg() {
      svgEl = s('svg', { viewBox: '0 0 300 150', 'aria-hidden': 'true' });
      const tapeColor = 'var(--tape)';
      svgEl.append(
        s('rect', { x: 2, y: 2, width: 296, height: 146, rx: 12, fill: 'var(--shell)', stroke: 'var(--edge)', 'stroke-width': 3 }),
        s('rect', { x: 14, y: 10, width: 272, height: 66, rx: 5, fill: 'var(--paper)' }),
        s('rect', { x: 14, y: 62, width: 272, height: 6, fill: 'var(--accent)' }),
        s('rect', { x: 14, y: 68, width: 272, height: 4, fill: 'var(--accent-2)' }),
        s('text', { x: 24, y: 42, fill: 'var(--accent)', 'font-family': 'Arial Black, sans-serif', 'font-size': 22, 'font-weight': 900 }, document.createTextNode('A')),
        s('rect', { x: 78, y: 80, width: 144, height: 44, rx: 8, fill: 'var(--window)', stroke: 'var(--edge)', 'stroke-width': 2 }),
        s('path', { d: 'M62 150 L82 128 H218 L238 150 Z', fill: 'var(--shell-2)' }),
        s('circle', { cx: 12, cy: 12, r: 3, fill: 'var(--shell-2)' }),
        s('circle', { cx: 288, cy: 12, r: 3, fill: 'var(--shell-2)' }),
        s('circle', { cx: 12, cy: 138, r: 3, fill: 'var(--shell-2)' }),
        s('circle', { cx: 288, cy: 138, r: 3, fill: 'var(--shell-2)' }),
        s('circle', { cx: 120, cy: 141, r: 3, fill: 'var(--edge)' }),
        s('circle', { cx: 180, cy: 141, r: 3, fill: 'var(--edge)' })
      );
      packL = s('circle', { cx: 112, cy: 102, r: 20, fill: tapeColor });
      packR = s('circle', { cx: 188, cy: 102, r: 13, fill: tapeColor });
      svgEl.append(packL, packR, s('line', { x1: 112, y1: 122, x2: 188, y2: 122, stroke: tapeColor, 'stroke-width': 2 }));
      reelL = makeReel(112, 102);
      reelR = makeReel(188, 102);
      svgEl.append(reelL, reelR);
    }

    function makeReel(cx, cy) {
      const g = s('g', { class: 'reel' });
      g.append(s('circle', { cx, cy, r: 11, fill: 'var(--hub)', stroke: 'var(--edge)', 'stroke-width': 1.5 }));
      for (let i = 0; i < 6; i++) {
        const a = (i * Math.PI) / 3;
        g.append(s('line', { x1: cx + Math.cos(a) * 4, y1: cy + Math.sin(a) * 4, x2: cx + Math.cos(a) * 9.5, y2: cy + Math.sin(a) * 9.5, stroke: 'var(--edge)', 'stroke-width': 2, 'stroke-linecap': 'round' }));
      }
      g.append(s('circle', { cx, cy, r: 3.2, fill: 'var(--edge)' }));
      return g;
    }

    function makeSwitch(label, key, title) {
      const b = h('button', { class: 'switch', title, 'aria-pressed': String(!!prefs[key]) }, h('span', { class: 'led' }), label);
      b.addEventListener('click', () => {
        prefs[key] = !prefs[key];
        savePrefs(prefs);
        updateSwitches();
        if (current) current.shareFile = null;
        setStatus(`${label}: ${prefs[key] ? 'on' : 'off'}`, 'ok');
      });
      return b;
    }

    function updateSwitches() {
      if (!swBoost) return;
      swBoost.setAttribute('aria-pressed', String(!!prefs.boost));
      swShorten.setAttribute('aria-pressed', String(!!prefs.shorten));
      const cleanup = !!(A && A.applyCleanup);
      swBoost.classList.toggle('hidden', !cleanup);
      swShorten.classList.toggle('hidden', !cleanup);
    }

    function buildTrimDrawer() {
      scope = h('canvas', { class: 'scope' });
      inT = h('span', { class: 't', text: '0:00.0' });
      outT = h('span', { class: 't', text: '0:00.0' });
      lenT = h('span', { class: 'hint' });
      zoomT = h('span', { class: 'hint', text: '1×' });
      previewBtn = h('button', { class: 'key small', title: 'Play only the selection (P)', text: '▶ Preview', on: { click: togglePreview } });
      trimDl = h('button', { class: 'key small primary', title: 'Save only the selection as MP3', text: '⬇ Trimmed MP3', on: { click: downloadTrimmed } });
      const nudge = (which, d) => h('button', { class: 'key small icon', title: `${which === 'start' ? 'Start' : 'End'} ${d > 0 ? '+' : '−'}0.1 s`, text: d > 0 ? '▸' : '◂', on: { click: () => nudgeMarker(which, d) } });
      trimEl = h(
        'div',
        { class: 'drawer hidden' },
        h('div', { class: 'drawer-title' }, h('span', { text: '✂ Trim' }), h('span', { class: 'row' }, h('button', { class: 'key small icon', title: 'Zoom out', text: '−', on: { click: () => zoom(-1) } }), zoomT, h('button', { class: 'key small icon', title: 'Zoom in', text: '+', on: { click: () => zoom(1) } }))),
        h('div', { class: 'scope-wrap' }, scope),
        h(
          'div',
          { class: 'row' },
          h('div', { class: 'marker' }, h('button', { class: 'key small', title: 'Start = playhead (I)', text: '[ In', on: { click: () => setMarker('start') } }), nudge('start', -0.1), inT, nudge('start', 0.1)),
          h('span', { class: 'grow' }),
          h('div', { class: 'marker' }, nudge('end', -0.1), outT, nudge('end', 0.1), h('button', { class: 'key small', title: 'End = playhead (O)', text: 'Out ]', on: { click: () => setMarker('end') } }))
        ),
        h('div', { class: 'row' }, previewBtn, h('button', { class: 'key small', title: 'Select the whole tape', text: 'Reset', on: { click: resetTrim } }), lenT, h('span', { class: 'grow' }), trimDl),
        h('div', { class: 'hint', text: 'Keys: Space play · I / O set in / out · P preview · ← → seek 1 s (Shift = 5 s, Alt = 0.1 s) · drag markers · click to seek' })
      );

      scope.addEventListener('pointerdown', onScopeDown);
      scope.addEventListener('pointermove', onScopeMove);
      scope.addEventListener('pointerup', onScopeUp);
      scope.addEventListener('pointercancel', onScopeUp);
    }

    function buildTextDrawer() {
      textBox = h('div', { class: 'text-box' });
      textEl = h(
        'div',
        { class: 'drawer hidden' },
        h('div', { class: 'drawer-title' }, h('span', { text: '✎ Spoken text' }), h('button', { class: 'key small', text: 'Copy text', on: { click: copyText } })),
        textBox
      );
    }

    // ----- modes & views -----

    function setMode(m) {
      if (m !== 'hidden') build();
      mode = m;
      if (!built) return;
      deckEl.classList.toggle('hidden', m !== 'open');
      pillWrap.classList.toggle('hidden', m !== 'pill');
      if (m !== 'open' && !audio.paused) audio.pause();
      if (m === 'open' && !current && clips.size) load(sortedClips()[0]);
      updatePill();
      if (m === 'open') requestAnimationFrame(() => drawScope());
    }

    function setView(v) {
      view = v;
      if (!built) return;
      bodyEl.classList.toggle('hidden', v !== 'deck');
      rackEl.classList.toggle('hidden', v !== 'rack');
      rackBtn.classList.toggle('on', v === 'rack');
      if (v === 'rack') renderRack();
      else requestAnimationFrame(() => drawScope());
    }

    function updatePill() {
      if (!pillCount) return;
      const n = clips.size;
      pillCount.textContent = n ? `TAPES (${n})` : 'TAPE DECK';
      rackBtn.textContent = n ? `Rack ${n}` : 'Rack';
    }

    // ----- loading a tape -----

    function load(c) {
      if (!audio.paused) audio.pause();
      stopPreview();
      current = c;
      if (!c.url) c.url = ownUrl(c.blob);
      audio.src = c.url;
      applySpeed(SPEEDS[speedIndex()]);
      zoomIdx = 0;
      viewStart = 0;
      peaksCache = { key: '', peaks: null };
      emptyEl.classList.add('hidden');
      playerEl.classList.remove('hidden');
      refreshLabel();
      textBox.textContent = c.text || 'No text available for this tape (it was captured from a replay).';
      btnText.disabled = false;
      updateClock();
      if (!trimEl.classList.contains('hidden')) openTrim();
      renderRack();
    }

    function unload() {
      if (!audio.paused) audio.pause();
      current = null;
      audio.removeAttribute('src');
      audio.load();
      emptyEl.classList.remove('hidden');
      playerEl.classList.add('hidden');
    }

    function refreshLabel() {
      if (!current) return;
      nameEl.textContent = current.name;
      nameEl.title = `${current.name}\nClick to rename`;
      const parts = [current.lang, current.duration ? fmtClock(current.duration) : null, fmtSize(current.size), fmtDate(current.createdAt)].filter(Boolean);
      metaEl.textContent = parts.join(' · ');
    }

    function onMeta() {
      if (!current) return;
      const d = audio.duration;
      if (isFinite(d) && d > 0 && current.duration !== d) {
        current.duration = d;
        refreshLabel();
        if (libraryOk) S.updateClip(current.id, { duration: d }).catch(() => {});
      }
      updateClock();
    }

    function duration() {
      if (current && current.decoded) return current.decoded.duration;
      const d = audio.duration;
      return isFinite(d) && d > 0 ? d : (current && current.duration) || 0;
    }

    // ----- rename -----

    function startRename() {
      if (!current) return;
      const c = current;
      const input = h('input', { class: 'name-input', value: c.name, maxlength: '80', 'aria-label': 'Tape name' });
      let done = false;
      const finish = (save) => {
        if (done) return;
        done = true;
        const v = safeName(input.value);
        if (save && v && v !== c.name) {
          c.name = v;
          c.fileBase = v;
          c.shareFile = null;
          if (libraryOk) S.updateClip(c.id, { name: v, fileName: v }).catch(() => {});
          setStatus('Renamed', 'ok');
        }
        input.replaceWith(nameEl);
        refreshLabel();
        renderRack();
      };
      input.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.key === 'Enter') finish(true);
        if (e.key === 'Escape') finish(false);
      });
      input.addEventListener('blur', () => finish(true));
      nameEl.replaceWith(input);
      input.focus();
      input.select();
    }

    // ----- transport -----

    function speedIndex() {
      const i = SPEEDS.indexOf(prefs.speed || 1);
      return i < 0 ? 1 : i;
    }

    function applySpeed(n) {
      audio.defaultPlaybackRate = n;
      audio.playbackRate = n;
      const label = `${n % 1 ? String(n) : n.toFixed(1)}×`;
      speedBtn.textContent = label;
      lcdSpd.textContent = label;
      cassetteEl.style.setProperty('--spin', `${(2.4 / n).toFixed(2)}s`);
    }

    function cycleSpeed() {
      const next = SPEEDS[(speedIndex() + 1) % SPEEDS.length];
      prefs.speed = next;
      savePrefs(prefs);
      applySpeed(next);
      setStatus(`Speed ${speedBtn.textContent} (playback only, files keep normal speed)`, 'ok');
    }

    function ensureAudioGraph() {
      if (actx) {
        if (actx.state === 'suspended') actx.resume().catch(() => {});
        return;
      }
      try {
        actx = new (window.AudioContext || window.webkitAudioContext)();
        const src = actx.createMediaElementSource(audio);
        analyser = actx.createAnalyser();
        analyser.fftSize = 1024;
        vuBuf = new Float32Array(analyser.fftSize);
        src.connect(analyser);
        analyser.connect(actx.destination);
        if (actx.state === 'suspended') actx.resume().catch(() => {});
      } catch (e) {
        console.debug(LOG, 'VU meter unavailable', e);
        analyser = null;
      }
    }

    function togglePlay() {
      if (!current) return;
      if (audio.paused) {
        stopPreview();
        ensureAudioGraph();
        audio.play().catch((e) => setStatus(`Play failed: ${e.message}`, 'err'));
      } else audio.pause();
    }

    function stop() {
      stopPreview();
      audio.pause();
      audio.currentTime = 0;
    }

    function seekBy(sec) {
      if (!current) return;
      audio.currentTime = clamp(audio.currentTime + sec, 0, duration() || 0);
    }

    function onSeekInput() {
      const d = duration();
      if (d) audio.currentTime = (Number(seekEl.value) / 1000) * d;
    }

    function onPlayState() {
      const playing = !audio.paused && !audio.ended;
      playBtn.textContent = playing ? '❚❚' : '▶';
      playBtn.classList.toggle('on', playing);
      cassetteEl.classList.toggle('playing', playing);
      if (!playing) {
        previewing = false;
        previewBtn.textContent = '▶ Preview';
        for (const b of vuBars) b.classList.remove('lit');
      }
      if (playing && !raf) raf = requestAnimationFrame(tick);
      updateClock();
      drawScope();
    }

    function tick() {
      raf = 0;
      updateClock();
      updateVu();
      if (previewing && current && current.trim && audio.currentTime >= current.trim.end) {
        audio.pause();
        audio.currentTime = current.trim.end;
      }
      followPlayhead();
      drawScope();
      if (!audio.paused) raf = requestAnimationFrame(tick);
    }

    function updateClock() {
      if (!built) return;
      const d = duration();
      const t = audio.currentTime || 0;
      lcdCur.textContent = fmtClock(t);
      lcdTotal.textContent = `/ ${fmtClock(d)}`;
      const p = d ? clamp(t / d, 0, 1) : 0;
      seekEl.value = String(Math.round(p * 1000));
      seekEl.style.setProperty('--p', `${(p * 100).toFixed(1)}%`);
      packL.setAttribute('r', String(13 + 8 * (1 - p)));
      packR.setAttribute('r', String(13 + 8 * p));
    }

    function updateVu() {
      if (!analyser) return;
      analyser.getFloatTimeDomainData(vuBuf);
      let sum = 0;
      for (let i = 0; i < vuBuf.length; i++) sum += vuBuf[i] * vuBuf[i];
      const rms = Math.sqrt(sum / vuBuf.length);
      const db = rms > 0 ? 20 * Math.log10(rms) : -100; // speech sits around -30..-12 dBFS
      const lit = Math.round(clamp(((db + 50) / 44) * 10, 0, 10));
      vuBars.forEach((b, i) => b.classList.toggle('lit', i < lit));
    }

    // ----- status -----

    function setStatus(msg, kind) {
      if (!statusEl) return;
      clearTimeout(statusTimer);
      statusEl.textContent = msg;
      statusEl.className = `status${kind ? ` ${kind}` : ''}`;
      if (kind !== 'busy') statusTimer = setTimeout(() => {
        statusEl.textContent = current ? 'Ready' : 'Insert a tape';
        statusEl.className = 'status';
      }, 4000);
    }

    async function withBusy(btn, fn) {
      if (busy) {
        setStatus('Busy – one job at a time', 'err');
        return;
      }
      busy = true;
      if (btn) btn.disabled = true;
      try {
        await fn();
      } catch (e) {
        console.warn(LOG, e);
        setStatus(`Failed: ${(e && e.message) || e}`, 'err');
      } finally {
        busy = false;
        if (btn) btn.disabled = false;
      }
    }

    // ----- exports -----

    function cleanupKey() {
      return `${prefs.boost ? 'B' : ''}${prefs.shorten ? 'S' : ''}` || 'raw';
    }

    async function decoded(c) {
      if (c.decoded) return c.decoded;
      if (!A || !A.decodeBlob) throw new Error('decoder not loaded');
      setStatus('Reading tape…', 'busy');
      c.decoded = await A.decodeBlob(c.blob);
      return c.decoded;
    }

    async function encode(samples, sampleRate, label) {
      if (!M || !M.encodeFloatToMp3) throw new Error('MP3 encoder not loaded');
      let removed = 0;
      if ((prefs.boost || prefs.shorten) && A && A.applyCleanup) {
        setStatus('Cleaning up…', 'busy');
        await new Promise((r) => setTimeout(r, 0));
        const res = A.applyCleanup(samples, sampleRate, { boost: !!prefs.boost, shorten: !!prefs.shorten });
        samples = res.samples;
        removed = res.removedSec || 0;
      }
      const blob = await M.encodeFloatToMp3(samples, sampleRate, (p) => setStatus(`${label} ${Math.round(p * 100)}%`, 'busy'));
      return { blob, removed };
    }

    async function fullMp3(c) {
      const key = cleanupKey();
      if (c.mp3 && c.mp3.key === key) return c.mp3;
      const d = await decoded(c);
      const { blob, removed } = await encode(d.samples, d.sampleRate, 'Encoding MP3');
      if (c.mp3) revokeUrl(c.mp3.url);
      c.mp3 = { key, blob, url: ownUrl(blob), removed };
      return c.mp3;
    }

    function suffix() {
      return `${prefs.boost ? ' (boosted)' : ''}${prefs.shorten ? ' (tight)' : ''}`;
    }

    function doneMsg(blob, removed) {
      return `Saved ${fmtSize(blob.size)}${removed > 0.05 ? ` · ${removed.toFixed(1)} s of pauses cut` : ''}`;
    }

    function downloadOgg() {
      if (!current) return;
      download(current.url || (current.url = ownUrl(current.blob)), `${current.fileBase}.${current.ext}`);
      setStatus(`Saved ${fmtSize(current.size)} ${current.ext.toUpperCase()}`, 'ok');
    }

    function downloadMp3() {
      const c = current;
      if (!c) return;
      withBusy(btnMp3, async () => {
        const mp3 = await fullMp3(c);
        download(mp3.url, `${c.fileBase}${suffix()}.mp3`);
        setStatus(doneMsg(mp3.blob, mp3.removed), 'ok');
      });
    }

    function downloadTrimmed() {
      const c = current;
      if (!c || !c.trim) return;
      withBusy(trimDl, async () => {
        const d = await decoded(c);
        let part = A.sliceSamples(d.samples, d.sampleRate, c.trim.start, c.trim.end);
        part = A.applyFade(part, d.sampleRate);
        const { blob, removed } = await encode(part, d.sampleRate, 'Encoding cut');
        const url = ownUrl(blob);
        download(url, `${c.fileBase} (${fmtClock(c.trim.start).replace(':', 'm')}s-${fmtClock(c.trim.end).replace(':', 'm')}s)${suffix()}.mp3`);
        setTimeout(() => revokeUrl(url), 15000);
        setStatus(doneMsg(blob, removed), 'ok');
      });
    }

    function canShareFiles() {
      try {
        return !!(navigator.canShare && navigator.share && navigator.canShare({ files: [new File([new Uint8Array(4)], 't.mp3', { type: 'audio/mpeg' })] }));
      } catch (_) {
        return false;
      }
    }

    function share() {
      const c = current;
      if (!c) return;
      if (c.shareFile && c.shareFile.__key === cleanupKey()) {
        navigator
          .share({ files: [c.shareFile], title: c.name, text: c.name })
          .then(() => setStatus('Shared', 'ok'))
          .catch((e) => {
            if (e && e.name !== 'AbortError') setStatus(`Share failed: ${e.message}`, 'err');
          });
        btnShare.textContent = '⤴ Share';
        return;
      }
      withBusy(btnShare, async () => {
        const mp3 = await fullMp3(c);
        const file = new File([mp3.blob], `${c.fileBase}${suffix()}.mp3`, { type: 'audio/mpeg' });
        file.__key = cleanupKey();
        c.shareFile = file;
        btnShare.textContent = '⤴ Share now';
        setStatus('MP3 ready – press Share now', 'ok');
      });
    }

    function copyText() {
      if (!current || !current.text) {
        setStatus('No text for this tape', 'err');
        return;
      }
      const t = current.text;
      const fallback = () => {
        const range = document.createRange();
        range.selectNodeContents(textBox);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        setStatus('Text selected – press Ctrl+C', 'ok');
      };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(t).then(() => setStatus('Text copied', 'ok'), fallback);
      else fallback();
    }

    // ----- drawers -----

    function toggleDrawer(which) {
      if (!current) return;
      const el = which === 'trim' ? trimEl : textEl;
      const btn = which === 'trim' ? btnTrim : btnText;
      const open = el.classList.contains('hidden');
      el.classList.toggle('hidden', !open);
      btn.classList.toggle('on', open);
      if (which === 'trim' && open) openTrim();
    }

    async function openTrim() {
      const c = current;
      if (!c) return;
      try {
        await decoded(c);
        if (c !== current) return;
        if (!c.trim) c.trim = { start: 0, end: c.decoded.duration };
        setStatus('Trim: drag the markers or use [ In / Out ]', 'ok');
        updateTrimInfo();
        drawScope();
      } catch (e) {
        setStatus('Could not read this tape for trimming', 'err');
        console.warn(LOG, e);
      }
    }

    // ----- trim logic -----

    function sel(start, end) {
      const d = duration();
      const r = A.clampSelection(start, end, d);
      current.trim = { start: r.start, end: r.end };
      updateTrimInfo();
      drawScope();
    }

    function setMarker(which) {
      if (!current || !current.decoded) return openTrimIfClosed();
      const t = audio.currentTime;
      const tr = current.trim;
      if (which === 'start') sel(t, Math.max(tr.end, t + 0.2));
      else sel(Math.min(tr.start, t - 0.2), t);
    }

    function openTrimIfClosed() {
      if (trimEl.classList.contains('hidden')) toggleDrawer('trim');
    }

    function nudgeMarker(which, d) {
      if (!current || !current.trim) return;
      const tr = current.trim;
      if (which === 'start') sel(tr.start + d, tr.end);
      else sel(tr.start, tr.end + d);
      audio.currentTime = which === 'start' ? current.trim.start : Math.max(current.trim.start, current.trim.end - 1);
    }

    function resetTrim() {
      if (!current || !current.decoded) return;
      sel(0, current.decoded.duration);
    }

    function updateTrimInfo() {
      if (!current || !current.trim) return;
      inT.textContent = fmtTime(current.trim.start);
      outT.textContent = fmtTime(current.trim.end);
      lenT.textContent = `Length ${fmtTime(current.trim.end - current.trim.start)}`;
    }

    function togglePreview() {
      if (!current || !current.trim) return;
      if (previewing) {
        audio.pause();
        return;
      }
      ensureAudioGraph();
      audio.currentTime = current.trim.start;
      audio
        .play()
        .then(() => {
          previewing = true;
          previewBtn.textContent = '■ Stop';
        })
        .catch((e) => setStatus(`Play failed: ${e.message}`, 'err'));
    }

    function stopPreview() {
      previewing = false;
      if (previewBtn) previewBtn.textContent = '▶ Preview';
    }

    function zoom(dir) {
      if (!current || !current.decoded) return;
      zoomIdx = clamp(zoomIdx + dir, 0, ZOOMS.length - 1);
      const d = current.decoded.duration;
      const vd = d / ZOOMS[zoomIdx];
      viewStart = clamp(audio.currentTime - vd / 2, 0, Math.max(0, d - vd));
      zoomT.textContent = `${ZOOMS[zoomIdx]}×`;
      drawScope();
    }

    function viewRange() {
      const d = current.decoded.duration;
      const vd = d / ZOOMS[zoomIdx];
      viewStart = clamp(viewStart, 0, Math.max(0, d - vd));
      return { vs: viewStart, vd };
    }

    function followPlayhead() {
      if (!current || !current.decoded || zoomIdx === 0 || trimEl.classList.contains('hidden') || drag) return;
      const { vs, vd } = viewRange();
      const t = audio.currentTime;
      if (t < vs || t > vs + vd * 0.95) viewStart = t - vd * 0.1;
    }

    function cssVar(name, fallback) {
      return getComputedStyle(root).getPropertyValue(name).trim() || fallback;
    }

    function drawScope() {
      if (!built || !current || !current.decoded || !current.trim || trimEl.classList.contains('hidden') || mode !== 'open') return;
      const rect = scope.getBoundingClientRect();
      if (rect.width <= 0) return;
      const dpr = window.devicePixelRatio || 1;
      const bw = Math.round(rect.width * dpr);
      const bh = Math.round(rect.height * dpr);
      if (scope.width !== bw || scope.height !== bh) {
        scope.width = bw;
        scope.height = bh;
      }
      const ctx = scope.getContext('2d');
      const bg = cssVar('--scope-bg', '#10140f');
      const fg = cssVar('--scope-fg', '#9cf06a');
      const dim = cssVar('--scope-dim', '#3c5a2c');
      const grid = cssVar('--scope-grid', '#1f2a1b');
      const accent = cssVar('--accent', '#d9541e');
      const amber = cssVar('--lcd-fg', '#ffb347');

      const { vs, vd } = viewRange();
      const dec = current.decoded;
      const key = `${current.id}|${bw}|${vs.toFixed(4)}|${vd.toFixed(4)}`;
      if (peaksCache.key !== key) {
        const a = Math.floor(vs * dec.sampleRate);
        const b = Math.min(dec.samples.length, Math.ceil((vs + vd) * dec.sampleRate));
        peaksCache = { key, peaks: A.computePeaks(dec.samples.subarray(a, b), bw) };
      }
      const peaks = peaksCache.peaks;
      const x = (t) => ((t - vs) / vd) * bw;

      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, bw, bh);
      ctx.fillStyle = grid;
      for (let gx = 0; gx < bw; gx += Math.round(24 * dpr)) ctx.fillRect(gx, 0, 1, bh);
      for (let gy = 0; gy < bh; gy += Math.round(14 * dpr)) ctx.fillRect(0, gy, bw, 1);

      const sx = x(current.trim.start);
      const ex = x(current.trim.end);
      ctx.save();
      ctx.globalAlpha = 0.18;
      ctx.fillStyle = fg;
      ctx.fillRect(sx, 0, ex - sx, bh);
      ctx.restore();

      const mid = bh / 2;
      for (let i = 0; i < bw; i++) {
        const p = peaks[i];
        if (!(p > 0)) continue;
        const hgt = Math.max(1, p * (mid - 4 * dpr));
        ctx.fillStyle = i >= sx && i <= ex ? fg : dim;
        ctx.fillRect(i, mid - hgt, 1, hgt * 2);
      }

      const handle = (px, label) => {
        const w = Math.max(2, Math.round(2 * dpr));
        ctx.fillStyle = accent;
        ctx.fillRect(Math.round(px - w / 2), 0, w, bh);
        const tw = Math.round(22 * dpr);
        const th = Math.round(13 * dpr);
        const tx = label === 'IN' ? px : px - tw;
        ctx.fillRect(Math.round(tx), 0, tw, th);
        ctx.fillStyle = '#fff8ec';
        ctx.font = `700 ${Math.round(9 * dpr)}px "Courier New", monospace`;
        ctx.textBaseline = 'middle';
        ctx.fillText(label, Math.round(tx + 3 * dpr), Math.round(th / 2 + 1));
      };
      handle(sx, 'IN');
      handle(ex, 'OUT');

      const t = audio.currentTime || 0;
      if (t >= vs && t <= vs + vd) {
        ctx.fillStyle = amber;
        ctx.fillRect(Math.round(x(t)), 0, Math.max(1, Math.round(dpr)), bh);
      }
    }

    function scopeTime(e) {
      const rect = scope.getBoundingClientRect();
      const { vs, vd } = viewRange();
      return { t: vs + ((e.clientX - rect.left) / rect.width) * vd, px: e.clientX - rect.left, rect, vs, vd };
    }

    function onScopeDown(e) {
      if (!current || !current.trim) return;
      const { t, px, rect, vs, vd } = scopeTime(e);
      const toPx = (tt) => ((tt - vs) / vd) * rect.width;
      const ds = Math.abs(px - toPx(current.trim.start));
      const de = Math.abs(px - toPx(current.trim.end));
      if (Math.min(ds, de) <= 10) {
        drag = ds <= de ? 'start' : 'end';
        scope.setPointerCapture(e.pointerId);
      } else {
        drag = null;
        audio.currentTime = clamp(t, 0, duration());
      }
    }

    function onScopeMove(e) {
      if (!current || !current.trim) return;
      const { t, px, rect, vs, vd } = scopeTime(e);
      if (drag === 'start') sel(t, current.trim.end);
      else if (drag === 'end') sel(current.trim.start, t);
      else {
        const toPx = (tt) => ((tt - vs) / vd) * rect.width;
        const near = Math.min(Math.abs(px - toPx(current.trim.start)), Math.abs(px - toPx(current.trim.end))) <= 10;
        scope.style.cursor = near ? 'ew-resize' : 'crosshair';
      }
    }

    function onScopeUp(e) {
      if (drag) {
        try {
          scope.releasePointerCapture(e.pointerId);
        } catch (_) {
          /* already released */
        }
        audio.currentTime = drag === 'start' ? current.trim.start : Math.max(current.trim.start, current.trim.end - 1);
      }
      drag = null;
    }

    // ----- keyboard -----

    function isTyping(e) {
      const t = e.composedPath()[0];
      return !!t && (t.tagName === 'TEXTAREA' || (t.tagName === 'INPUT' && t.type !== 'range'));
    }
    function isButton(e) {
      const t = e.composedPath()[0];
      return !!t && t.tagName === 'BUTTON';
    }

    function onKey(e) {
      if (isTyping(e) || !current || e.ctrlKey || e.metaKey) return;
      const k = e.key;
      let handled = true;
      if (k === ' ') togglePlay();
      else if (k === 'i' || k === 'I') {
        openTrimIfClosed();
        setMarker('start');
      } else if (k === 'o' || k === 'O') {
        openTrimIfClosed();
        setMarker('end');
      } else if (k === 'p' || k === 'P') {
        openTrimIfClosed();
        togglePreview();
      } else if (k === 'ArrowLeft' || k === 'ArrowRight') {
        const step = e.shiftKey ? 5 : e.altKey ? 0.1 : 1;
        seekBy(k === 'ArrowLeft' ? -step : step);
      } else handled = false;
      if (handled) {
        e.preventDefault();
        e.stopPropagation();
      }
    }

    // ----- rack (library) -----

    function renderRack() {
      if (!built) return;
      updatePill();
      if (view !== 'rack') return;
      while (rackList.firstChild) rackList.firstChild.remove();
      const list = sortedClips();
      if (!list.length) rackList.append(h('div', { class: 'empty', text: 'The rack is empty. Click “Listen” in Gemini to record a tape.' }));
      for (const c of list) {
        let armed = false;
        const del = h('button', { class: 'key small icon danger', title: 'Delete this tape', text: '✕' });
        del.addEventListener('click', (ev) => {
          ev.stopPropagation();
          if (!armed) {
            armed = true;
            del.textContent = 'Sure?';
            setTimeout(() => {
              armed = false;
              del.textContent = '✕';
            }, 2500);
            return;
          }
          removeTape(c.id);
        });
        const row = h(
          'div',
          { class: `tape${current === c ? ' current' : ''}`, title: c.text ? c.text.slice(0, 200) : c.name, on: { click: () => { load(c); setView('deck'); } } },
          h('div', { class: 'tape-icon' }),
          h('div', null, h('div', { class: 'tape-name', text: c.name }), h('div', { class: 'tape-meta', text: [fmtDate(c.createdAt), c.duration ? fmtClock(c.duration) : null, fmtSize(c.size), c.lang].filter(Boolean).join(' · ') })),
          del
        );
        rackList.append(row);
      }
      while (rackFoot.firstChild) rackFoot.firstChild.remove();
      const total = list.reduce((n, c) => n + (c.size || 0), 0);
      const note = libraryOk ? `${list.length} tape${list.length === 1 ? '' : 's'} · ${fmtSize(total)} · keeps the last ${MAX_LIBRARY}` : 'Library unavailable here – tapes last until you reload';
      let armedAll = false;
      const clearBtn = h('button', { class: 'key small danger', text: 'Clear all' });
      clearBtn.addEventListener('click', () => {
        if (!armedAll) {
          armedAll = true;
          clearBtn.textContent = 'Really clear?';
          setTimeout(() => {
            armedAll = false;
            clearBtn.textContent = 'Clear all';
          }, 2500);
          return;
        }
        clearAll();
      });
      rackFoot.append(h('span', { class: 'grow', text: note }), list.length ? clearBtn : null);
    }

    async function removeTape(id) {
      const wasCurrent = current && current.id === id;
      if (wasCurrent) unload();
      dropClip(id);
      if (libraryOk) await S.deleteClip(id).catch((e) => console.warn(LOG, e));
      const next = sortedClips()[0];
      if (wasCurrent && next) load(next);
      renderRack();
    }

    async function clearAll() {
      unload();
      for (const id of [...clips.keys()]) dropClip(id);
      if (libraryOk) await S.clearClips().catch((e) => console.warn(LOG, e));
      renderRack();
    }

    // ----- startup: show saved tapes as a small pill -----

    async function init() {
      if (!S) return;
      try {
        libraryOk = await S.isAvailable();
        if (!libraryOk) return;
        const recs = await S.listClips();
        for (const r of recs) if (r && r.id && r.blob && !clips.has(r.id)) clips.set(r.id, newClip(r));
        if (clips.size && mode === 'hidden') setMode('pill');
        else renderRack();
      } catch (e) {
        libraryOk = false;
        console.warn(LOG, 'library unavailable', e);
      }
    }

    return { capture, init };
  })();

  const start = () => deck.init();
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();

  console.info(LOG, 'ready: click "Listen" on a Gemini answer to record a tape');
})();
