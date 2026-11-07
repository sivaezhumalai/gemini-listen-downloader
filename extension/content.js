// Runs in the page's own JS world on gemini.google.com (see manifest "world": "MAIN").
// It watches Gemini's "Listen" request (RPC XqA3Ic), keeps a copy of the audio it
// returns, and shows a small panel with Play and Download for each clip.
(function () {
  if (window.__geminiListenDownloaderLoaded) return;
  window.__geminiListenDownloaderLoaded = true;

  const P = globalThis.__geminiListenParse;
  if (!P) {
    console.warn('[Gemini Listen Downloader] parse.js did not load');
    return;
  }
  const LOG = '[Gemini Listen Downloader]';
  const MAX_CLIPS = 10;

  // ---------- capture ----------

  const seen = new Set();

  function handleResponse(responseText, requestBody) {
    const clips = P.extractAudioBase64(responseText);
    if (!clips.length) return;
    const info = P.parseRequestInfo(requestBody);
    for (const b64 of clips) {
      const key = `${b64.length}:${b64.slice(0, 64)}:${b64.slice(-64)}`;
      if (seen.has(key)) {
        ui.show();
        continue;
      }
      seen.add(key);
      try {
        const bytes = P.base64ToBytes(b64);
        const fmt = P.detectFormat(bytes);
        const blob = new Blob([bytes], { type: fmt.mime });
        ui.addClip({
          blob,
          url: URL.createObjectURL(blob),
          fileName: P.buildFileName(info, fmt.ext),
          text: info.text,
          lang: info.lang,
          size: bytes.length,
        });
      } catch (e) {
        console.warn(LOG, 'could not decode audio', e);
      }
    }
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

  // ---------- UI (Shadow DOM: Gemini enforces Trusted Types) ----------

  const CSS = `
    :host { all: initial; }
    .wrap {
      --bg: #ffffff; --fg: #1f1f1f; --muted: #5f6368; --border: #dadce0;
      --accent: #0b57d0; --accent-fg: #ffffff; --card: #f8fafd;
      position: fixed; right: 16px; bottom: 16px; z-index: 2147483647;
      font: 13px/1.4 "Google Sans", Roboto, "Noto Sans Tamil", "Nirmala UI", Latha, Arial, sans-serif; color: var(--fg);
    }
    @media (prefers-color-scheme: dark) {
      .wrap {
        --bg: #1e1f20; --fg: #e3e3e3; --muted: #a8abaf; --border: #3c4043;
        --accent: #a8c7fa; --accent-fg: #062e6f; --card: #282a2c;
      }
    }
    .panel {
      width: min(420px, calc(100vw - 32px)); max-height: 70vh; overflow: auto;
      background: var(--bg); border: 1px solid var(--border); border-radius: 16px;
      box-shadow: 0 6px 24px rgba(0,0,0,.25);
    }
    .head {
      display: flex; align-items: center; gap: 8px; padding: 10px 12px 10px 16px;
      border-bottom: 1px solid var(--border); position: sticky; top: 0; background: var(--bg);
    }
    .title { flex: 1; font-weight: 600; font-size: 14px; }
    .iconbtn {
      all: unset; cursor: pointer; width: 28px; height: 28px; border-radius: 50%;
      display: grid; place-items: center; color: var(--muted); font-size: 16px;
    }
    .iconbtn:hover { background: var(--card); color: var(--fg); }
    .list { padding: 8px; display: flex; flex-direction: column; gap: 8px; }
    .clip { background: var(--card); border-radius: 12px; padding: 10px 12px; }
    .label {
      display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;
      overflow: hidden; margin-bottom: 4px;
    }
    .meta { color: var(--muted); font-size: 12px; margin-bottom: 8px; }
    audio { width: 100%; height: 36px; display: block; margin-bottom: 8px; }
    .dl {
      all: unset; cursor: pointer; display: inline-flex; align-items: center; gap: 6px;
      background: var(--accent); color: var(--accent-fg); border-radius: 999px;
      padding: 6px 14px; font-weight: 600;
    }
    .dl:hover { filter: brightness(1.08); }
    .dl[disabled] { opacity: .7; cursor: progress; }
    .dl.secondary { background: transparent; color: var(--accent); box-shadow: inset 0 0 0 1px var(--accent); }
    .actions { display: flex; gap: 8px; flex-wrap: wrap; }
    .pill {
      all: unset; cursor: pointer; display: inline-flex; align-items: center; gap: 8px;
      background: var(--accent); color: var(--accent-fg); border-radius: 999px;
      padding: 10px 16px; font-weight: 600; box-shadow: 0 4px 16px rgba(0,0,0,.25);
    }
    .hidden { display: none !important; }
    .trim-section { margin-top: 10px; padding-top: 10px; border-top: 1px solid var(--border); }
    .trim-waveform { width: 100%; height: 64px; display: block; border-radius: 8px; touch-action: none; cursor: pointer; }
    .trim-info { color: var(--muted); font-size: 12px; margin: 8px 0; }
    .trim-row { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 8px; }
    .trim-btn { padding: 4px 10px; font-size: 12px; }
    .trim-loading { color: var(--muted); font-size: 12px; padding: 4px 0; }
    .trim-error { color: #d93025; font-size: 12px; padding: 4px 0; }
  `;

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function formatSize(bytes) {
    return bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`;
  }

  function formatDuration(sec) {
    if (!isFinite(sec) || sec <= 0) return '';
    const m = Math.floor(sec / 60);
    const s = Math.round(sec % 60);
    return `${m}:${String(s).padStart(2, '0')}`;
  }

  function download(clip) {
    const a = el('a');
    a.href = clip.url;
    a.download = clip.fileName;
    a.rel = 'noopener';
    a.style.display = 'none';
    (document.body || document.documentElement).appendChild(a);
    a.click();
    a.remove();
  }

  async function downloadMp3(clip, btn) {
    const mp3Name = clip.fileName.replace(/\.[a-z0-9]+$/i, '.mp3');
    if (clip.mp3Url) {
      download({ url: clip.mp3Url, fileName: mp3Name });
      return;
    }
    if (clip.converting) return;
    const M = globalThis.__geminiListenMp3;
    const A = globalThis.__geminiListenAudio;
    if (!M) {
      btn.textContent = 'MP3 unavailable';
      return;
    }
    clip.converting = true;
    btn.disabled = true;
    btn.textContent = 'Converting… 0%';
    try {
      let mp3;
      if (clip.decoded) {
        mp3 = await M.encodeFloatToMp3(clip.decoded.samples, clip.decoded.sampleRate, (p) => {
          btn.textContent = `Converting… ${Math.round(p * 100)}%`;
        });
      } else if (A && A.decodeBlob) {
        clip.decoded = await A.decodeBlob(clip.blob);
        mp3 = await M.encodeFloatToMp3(clip.decoded.samples, clip.decoded.sampleRate, (p) => {
          btn.textContent = `Converting… ${Math.round(p * 100)}%`;
        });
      } else {
        mp3 = await M.convertBlobToMp3(clip.blob, (p) => {
          btn.textContent = `Converting… ${Math.round(p * 100)}%`;
        });
      }
      clip.mp3Url = URL.createObjectURL(mp3);
      btn.textContent = '⬇ MP3';
      btn.title = `${mp3Name} (${formatSize(mp3.size)})`;
      download({ url: clip.mp3Url, fileName: mp3Name });
    } catch (e) {
      console.warn(LOG, 'MP3 conversion failed', e);
      btn.textContent = 'MP3 failed – retry';
    } finally {
      clip.converting = false;
      btn.disabled = false;
    }
  }

  function setupTrim(clip, card, audio, wrap) {
    let trimSection = null;
    let isOpen = false;
    let isDecoding = false;
    let controlsBuilt = false;

    let start = 0;
    let end = 0;
    let duration = 0;
    let isPreviewing = false;
    let rafId = null;

    let canvas, infoEl, previewBtn, drawFn;

    function setIsPreviewing(val) {
      isPreviewing = val;
      if (previewBtn) {
        previewBtn.textContent = val ? '■ Stop' : '▶ Preview';
      }
    }

    function playbackLoop() {
      if (drawFn) drawFn();
      if (isPreviewing && audio.currentTime >= end) {
        audio.pause();
        audio.currentTime = end;
        setIsPreviewing(false);
        if (drawFn) drawFn();
        rafId = null;
        return;
      }
      rafId = requestAnimationFrame(playbackLoop);
    }

    function startPlaybackLoop() {
      if (!rafId && isOpen) {
        rafId = requestAnimationFrame(playbackLoop);
      }
    }

    function stopPlaybackLoop() {
      if (rafId) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
      if (isPreviewing) {
        setIsPreviewing(false);
      }
      if (isOpen && drawFn) {
        drawFn();
      }
    }

    function onSeeked() {
      if (isOpen && drawFn) {
        drawFn();
      }
    }

    audio.addEventListener('play', startPlaybackLoop);
    audio.addEventListener('pause', stopPlaybackLoop);
    audio.addEventListener('ended', stopPlaybackLoop);
    audio.addEventListener('seeked', onSeeked);

    function buildControls() {
      const A = globalThis.__geminiListenAudio;
      const M = globalThis.__geminiListenMp3;
      duration = clip.decoded.duration || audio.duration || 0;
      const clamped = A.clampSelection(0, duration, duration);
      start = clamped.start;
      end = clamped.end;

      canvas = el('canvas', 'trim-waveform');
      trimSection.appendChild(canvas);

      let cachedPeaks = null;
      let cachedPeaksWidth = 0;

      drawFn = function () {
        if (!clip.decoded) return;
        const rect = canvas.getBoundingClientRect();
        if (rect.width <= 0) return;
        const dpr = window.devicePixelRatio || 1;
        const bw = Math.round(rect.width * dpr);
        const bh = Math.round(rect.height * dpr) || Math.round(64 * dpr);
        if (canvas.width !== bw || canvas.height !== bh) {
          canvas.width = bw;
          canvas.height = bh;
        }
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, bw, bh);

        const style = getComputedStyle(wrap);
        const muted = style.getPropertyValue('--muted').trim() || '#5f6368';
        const accent = style.getPropertyValue('--accent').trim() || '#0b57d0';
        const fg = style.getPropertyValue('--fg').trim() || '#1f1f1f';

        if (!cachedPeaks || cachedPeaksWidth !== bw) {
          cachedPeaks = A.computePeaks(clip.decoded.samples, bw);
          cachedPeaksWidth = bw;
        }

        const dur = duration || 1;
        const startRatio = Math.max(0, Math.min(1, start / dur));
        const endRatio = Math.max(0, Math.min(1, end / dur));
        const startPx = startRatio * bw;
        const endPx = endRatio * bw;

        // Selected region background (~25% alpha)
        ctx.save();
        ctx.globalAlpha = 0.25;
        ctx.fillStyle = accent;
        ctx.fillRect(startPx, 0, endPx - startPx, bh);
        ctx.restore();

        // Waveform peaks
        const midY = bh / 2;
        for (let x = 0; x < bw; x++) {
          const p = cachedPeaks[x];
          if (p <= 0) continue;
          const barH = Math.max(1, p * midY);
          ctx.fillStyle = (x >= startPx && x <= endPx) ? accent : muted;
          ctx.fillRect(x, midY - barH, 1, barH * 2);
        }

        // Handles (2px vertical line + 8x12 tab)
        const lineW = Math.max(1, Math.round(2 * dpr));
        const tabW = Math.round(8 * dpr);
        const tabH = Math.round(12 * dpr);

        ctx.fillStyle = accent;
        ctx.fillRect(Math.round(startPx - lineW / 2), 0, lineW, bh);
        ctx.fillRect(Math.round(startPx - tabW / 2), 0, tabW, tabH);

        ctx.fillRect(Math.round(endPx - lineW / 2), 0, lineW, bh);
        ctx.fillRect(Math.round(endPx - tabW / 2), 0, tabW, tabH);

        // Playhead (1px line in --fg)
        if (Number.isFinite(audio.currentTime) && audio.currentTime >= 0) {
          const playRatio = Math.max(0, Math.min(1, audio.currentTime / dur));
          const playPx = playRatio * bw;
          const playW = Math.max(1, Math.round(1 * dpr));
          ctx.fillStyle = fg;
          ctx.fillRect(Math.round(playPx - playW / 2), 0, playW, bh);
        }
      };

      const ro = new ResizeObserver(() => {
        if (isOpen && drawFn) drawFn();
      });
      ro.observe(canvas);

      // Pointer interactions
      let dragTarget = null;

      function getMetrics() {
        const rect = canvas.getBoundingClientRect();
        const dur = duration || 1;
        const startX = (start / dur) * rect.width;
        const endX = (end / dur) * rect.width;
        return { rect, dur, startX, endX };
      }

      canvas.addEventListener('pointermove', (e) => {
        const { rect, dur, startX, endX } = getMetrics();
        if (rect.width <= 0) return;
        const x = e.clientX - rect.left;

        if (dragTarget === 'start') {
          const newTime = (x / rect.width) * dur;
          const res = A.clampSelection(newTime, end, dur);
          start = res.start;
          end = res.end;
          updateInfo();
          drawFn();
        } else if (dragTarget === 'end') {
          const newTime = (x / rect.width) * dur;
          const res = A.clampSelection(start, newTime, dur);
          start = res.start;
          end = res.end;
          updateInfo();
          drawFn();
        } else {
          const dStart = Math.abs(x - startX);
          const dEnd = Math.abs(x - endX);
          if (dStart <= 10 || dEnd <= 10) {
            canvas.style.cursor = 'ew-resize';
          } else {
            canvas.style.cursor = 'pointer';
          }
        }
      });

      canvas.addEventListener('pointerdown', (e) => {
        const { rect, dur, startX, endX } = getMetrics();
        if (rect.width <= 0) return;
        const x = e.clientX - rect.left;
        const dStart = Math.abs(x - startX);
        const dEnd = Math.abs(x - endX);

        if (dStart <= 10 && dStart <= dEnd) {
          dragTarget = 'start';
          canvas.setPointerCapture(e.pointerId);
        } else if (dEnd <= 10) {
          dragTarget = 'end';
          canvas.setPointerCapture(e.pointerId);
        } else {
          dragTarget = null;
          const seekTime = Math.max(0, Math.min(dur, (x / rect.width) * dur));
          audio.currentTime = seekTime;
          drawFn();
        }
      });

      function endDrag(e) {
        if (dragTarget) {
          try {
            canvas.releasePointerCapture(e.pointerId);
          } catch (_) {}
          dragTarget = null;
        }
      }
      canvas.addEventListener('pointerup', endDrag);
      canvas.addEventListener('pointercancel', endDrag);

      // Button row
      const btnRow = el('div', 'trim-row');

      const setStartBtn = el('button', 'dl secondary trim-btn', '[ Set start');
      setStartBtn.addEventListener('click', () => {
        const res = A.clampSelection(audio.currentTime, end, duration);
        start = res.start;
        end = res.end;
        updateInfo();
        drawFn();
      });

      const setEndBtn = el('button', 'dl secondary trim-btn', 'Set end ]');
      setEndBtn.addEventListener('click', () => {
        const res = A.clampSelection(start, audio.currentTime, duration);
        start = res.start;
        end = res.end;
        updateInfo();
        drawFn();
      });

      previewBtn = el('button', 'dl secondary trim-btn', '▶ Preview');
      previewBtn.addEventListener('click', () => {
        if (isPreviewing) {
          audio.pause();
        } else {
          audio.currentTime = start;
          audio.play().then(() => {
            setIsPreviewing(true);
          }).catch((e) => console.warn(LOG, 'preview playback failed', e));
        }
      });

      const resetBtn = el('button', 'dl secondary trim-btn', 'Reset');
      resetBtn.addEventListener('click', () => {
        const res = A.clampSelection(0, duration, duration);
        start = res.start;
        end = res.end;
        updateInfo();
        drawFn();
      });

      btnRow.append(setStartBtn, setEndBtn, previewBtn, resetBtn);
      trimSection.appendChild(btnRow);

      // Info line
      infoEl = el('div', 'trim-info');
      function updateInfo() {
        const dur = Math.max(0, end - start);
        infoEl.textContent = `Start ${A.formatTime(start)} · End ${A.formatTime(end)} · Length ${A.formatTime(dur)}`;
      }
      updateInfo();
      trimSection.appendChild(infoEl);

      // Download Trimmed MP3 primary button
      const trimDlBtn = el('button', 'dl', '⬇ Trimmed MP3');
      const trimmedName = clip.fileName.replace(/\.[a-z0-9]+$/i, '-trimmed.mp3');
      trimDlBtn.title = trimmedName;
      let trimConverting = false;

      trimDlBtn.addEventListener('click', async () => {
        if (trimConverting) return;
        if (!M || !M.encodeFloatToMp3) {
          trimDlBtn.textContent = 'MP3 unavailable';
          return;
        }
        trimConverting = true;
        trimDlBtn.disabled = true;
        trimDlBtn.textContent = 'Converting… 0%';

        try {
          const sliced = A.sliceSamples(clip.decoded.samples, clip.decoded.sampleRate, start, end);
          const faded = A.applyFade(sliced, clip.decoded.sampleRate);
          const mp3Blob = await M.encodeFloatToMp3(faded, clip.decoded.sampleRate, (p) => {
            trimDlBtn.textContent = `Converting… ${Math.round(p * 100)}%`;
          });
          const url = URL.createObjectURL(mp3Blob);
          trimDlBtn.textContent = '⬇ Trimmed MP3';
          download({ url, fileName: trimmedName });
          setTimeout(() => URL.revokeObjectURL(url), 10000);
        } catch (e) {
          console.warn(LOG, 'Trimmed MP3 conversion failed', e);
          trimDlBtn.textContent = 'MP3 failed – retry';
        } finally {
          trimConverting = false;
          trimDlBtn.disabled = false;
        }
      });

      trimSection.appendChild(trimDlBtn);
      controlsBuilt = true;
      drawFn();
    }

    async function toggle() {
      if (isOpen) {
        isOpen = false;
        if (trimSection) trimSection.classList.add('hidden');
        if (rafId) {
          cancelAnimationFrame(rafId);
          rafId = null;
        }
        return;
      }

      isOpen = true;
      if (!trimSection) {
        trimSection = el('div', 'trim-section');
        card.appendChild(trimSection);
      }
      trimSection.classList.remove('hidden');

      if (controlsBuilt) {
        if (!audio.paused) {
          startPlaybackLoop();
        }
        drawFn();
        return;
      }

      if (clip.decoded) {
        buildControls();
        return;
      }

      if (isDecoding) return;
      isDecoding = true;
      while (trimSection.firstChild) trimSection.firstChild.remove();
      const loadingEl = el('div', 'trim-loading', 'Loading waveform…');
      trimSection.appendChild(loadingEl);

      const A = globalThis.__geminiListenAudio;
      if (!A || !A.decodeBlob) {
        loadingEl.className = 'trim-error';
        loadingEl.textContent = 'Could not load audio for trimming';
        console.warn(LOG, 'audio.js decoder not loaded');
        isDecoding = false;
        return;
      }

      try {
        clip.decoded = await A.decodeBlob(clip.blob);
        if (!isOpen) return;
        loadingEl.remove();
        buildControls();
      } catch (e) {
        console.warn(LOG, 'Could not load audio for trimming', e);
        loadingEl.className = 'trim-error';
        loadingEl.textContent = 'Could not load audio for trimming';
      } finally {
        isDecoding = false;
      }
    }

    return { toggle };
  }

  const ui = (() => {
    let host, wrap, panel, list, pill, countEl;
    const clips = [];

    function build() {
      if (host) {
        if (!host.isConnected) (document.body || document.documentElement).appendChild(host);
        return;
      }
      host = el('div');
      host.id = 'gemini-listen-downloader';
      const root = host.attachShadow({ mode: 'open' });
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(CSS);
      root.adoptedStyleSheets = [sheet];

      wrap = el('div', 'wrap');
      panel = el('div', 'panel');
      const head = el('div', 'head');
      head.appendChild(el('div', 'title', '🔊 Gemini audio'));
      const minBtn = el('button', 'iconbtn', '–');
      minBtn.title = 'Minimise';
      minBtn.addEventListener('click', () => setCollapsed(true));
      const closeBtn = el('button', 'iconbtn', '✕');
      closeBtn.title = 'Close (clips are kept until you reload)';
      closeBtn.addEventListener('click', () => hideAll());
      head.append(minBtn, closeBtn);
      list = el('div', 'list');
      panel.append(head, list);

      pill = el('button', 'pill hidden');
      pill.append(el('span', null, '🔊'));
      countEl = el('span');
      pill.append(countEl);
      pill.addEventListener('click', () => setCollapsed(false));

      wrap.append(panel, pill);
      root.appendChild(wrap);
      (document.body || document.documentElement).appendChild(host);
    }

    function setCollapsed(collapsed) {
      panel.classList.toggle('hidden', collapsed);
      pill.classList.toggle('hidden', !collapsed);
      countEl.textContent = `Gemini audio (${clips.length})`;
    }

    function hideAll() {
      wrap.classList.add('hidden');
    }

    function show() {
      if (!host) return;
      build();
      wrap.classList.remove('hidden');
      setCollapsed(false);
    }

    function addClip(clip) {
      build();
      clips.unshift(clip);
      while (clips.length > MAX_CLIPS) {
        const old = clips.pop();
        URL.revokeObjectURL(old.url);
        if (old.mp3Url) URL.revokeObjectURL(old.mp3Url);
        if (old.node) old.node.remove();
      }

      const card = el('div', 'clip');
      const label = (clip.text || 'Gemini audio').replace(/\s+/g, ' ').trim();
      card.appendChild(el('div', 'label', label));
      const meta = el('div', 'meta', [clip.lang, formatSize(clip.size)].filter(Boolean).join(' · '));
      card.appendChild(meta);
      const audio = el('audio');
      audio.controls = true;
      audio.preload = 'metadata';
      audio.src = clip.url;
      audio.addEventListener('loadedmetadata', () => {
        const d = formatDuration(audio.duration);
        if (d) meta.textContent = [clip.lang, d, formatSize(clip.size)].filter(Boolean).join(' · ');
      });
      card.appendChild(audio);

      const actions = el('div', 'actions');
      const dl = el('button', 'dl', '⬇ OGG');
      dl.title = clip.fileName;
      dl.addEventListener('click', () => download(clip));
      const mp3Btn = el('button', 'dl secondary', '⬇ MP3');
      mp3Btn.title = clip.fileName.replace(/\.[a-z0-9]+$/i, '.mp3');
      mp3Btn.addEventListener('click', () => downloadMp3(clip, mp3Btn));
      const trimBtn = el('button', 'dl secondary', '✂ Trim');
      trimBtn.title = 'Trim audio';
      actions.append(dl, mp3Btn, trimBtn);
      card.appendChild(actions);

      const trim = setupTrim(clip, card, audio, wrap);
      trimBtn.addEventListener('click', () => trim.toggle());

      clip.node = card;

      list.prepend(card);
      wrap.classList.remove('hidden');
      setCollapsed(false);
    }

    return { addClip, show };
  })();

  console.info(LOG, 'ready: click "Listen" on a Gemini response to capture its audio');
})();
