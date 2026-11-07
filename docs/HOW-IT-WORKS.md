# How it works (technical notes)

This page is for people who want to understand, debug or fix the extension.
You do **not** need it to use the extension.

## 1. What Gemini does when you click "Listen"

Gemini's web app talks to its server through Google's internal `batchexecute` RPC endpoint.
Clicking **Listen** sends one request:

```
POST https://gemini.google.com/_/BardChatUi/data/batchexecute?rpcids=XqA3Ic&...&rt=c
Content-Type: application/x-www-form-urlencoded

f.req=[[["XqA3Ic","[\"lyra\",\"<the full response text>\",\"ta-IN\",null,2]",null,"generic"]]]
at=<anti-CSRF token>
```

| Field | Meaning (as observed) |
|---|---|
| `XqA3Ic` | RPC id of the text-to-speech call |
| `"lyra"` | voice/model identifier |
| response text | the exact text that will be spoken |
| `"ta-IN"` | language/locale of the voice (Tamil, India here) |

The answer is a chunked `batchexecute` response:

```
)]}'

1656615
[["wrb.fr","XqA3Ic","[\"T2dnUwACAAAA...<base64>...\"]",null,null,null,"generic"]]
61
[["di",21945],["af.httprm",21945,"...",94]]
```

The third field of the `wrb.fr` entry is a JSON string whose first element is **base64-encoded
OGG/Opus audio** (48 kHz mono, tagged "Google Speech using libopus"). Gemini decodes it,
wraps it in a `Blob` and plays it from a `blob:https://gemini.google.com/...` URL. That blob
only exists inside the open tab, which is why DevTools shows it but you cannot download it.

## 2. What the extension does

All scripts run as content scripts in the page's **MAIN world** at `document_start`
(see `extension/manifest.json`), in this order:

| File | Job |
|---|---|
| `vendor/lame.min.js` | LAME MP3 encoder (lamejs 1.2.1, unmodified) |
| `parse.js` | Pure helpers: detect the TTS URL, pull the base64 audio out of the response, read text + language from the request, base64 → bytes, sniff the format, build the file name |
| `audio.js` | Pure helpers: waveform peaks, selection clamping, slicing, fades, time formatting, `fingerprint` (FNV-1a id for de-duplication), `normalizeLoudness` (Boost volume), `findSilences` / `shortenPauses` (Shorten pauses), `applyCleanup`; plus `decodeBlob` (Web Audio decode) |
| `store.js` | The tape rack: a small Promise wrapper around IndexedDB (DB `gemini-listen-downloader`, store `clips`), keeps the last 30 tapes |
| `mp3.js` | Float/Int16 PCM → MP3 via lamejs, in ~1 s chunks so the page stays responsive |
| `content.js` | Wraps `XMLHttpRequest`, `fetch` and `HTMLMediaElement.play`, captures the audio, and draws the tape deck UI |

Flow:

1. `content.js` wraps `XMLHttpRequest.prototype.open/send` (and `window.fetch`). For requests
   whose URL contains `/batchexecute` with `rpcids` including `XqA3Ic`, it remembers the request
   body and listens for the response.
2. On `load`, `parse.extractAudioBase64()` scans the response lines for
   `["wrb.fr","XqA3Ic", "<json>"]` and returns the base64 string(s).
3. The bytes get an id (`fingerprint`, so the same audio is never stored twice), are wrapped in a
   `Blob` (`audio/ogg`), saved to the tape rack (IndexedDB) and loaded into the deck.
   The extension does **not** make any extra network requests; it only copies what Gemini
   already received.
4. **Replays:** if Gemini plays audio it fetched earlier (no new request), the wrapped
   `HTMLMediaElement.prototype.play` looks up the `Blob` behind the page's `blob:` URL and reads its
   bytes. Gemini's CSP (`connect-src`) forbids `fetch()` on `blob:` URLs, so the extension wraps
   `URL.createObjectURL` / `revokeObjectURL` and remembers the Blob for every audio-sized URL the
   page creates; no network request is involved. Same bytes → same id → the existing tape is loaded
   instead of a duplicate. Blob URLs created by the deck itself are ignored.
5. **⬇ MP3** decodes the OGG with `OfflineAudioContext.decodeAudioData` (the browser's own Opus
   decoder), optionally runs `applyCleanup` (shorten pauses, then boost), then encodes 96 kbps mono
   MP3 with LAME. Decoded audio and the last MP3 are cached per tape.
6. **✂ Trim** draws the waveform on a `<canvas>` "oscilloscope" with zoom, lets you set IN/OUT
   markers (drag, buttons, ±0.1 s nudges, I/O keys), and encodes only the selected samples
   (10 ms fade at both ends) to MP3.
7. The VU meter routes the deck's `<audio>` through a Web Audio `AnalyserNode` (created on your first
   Play click, as browsers require).

### Why the UI is built the way it is

- **Shadow DOM + `adoptedStyleSheets`**: Gemini's styles can't leak in, ours can't leak out.
- **No `innerHTML`**: gemini.google.com enforces Trusted Types, so all DOM is created with
  `createElement` / `textContent`.
- **Floating deck instead of a button in Gemini's ⋮ menu**: Gemini's menus are re-rendered
  often and their markup changes; a separate deck keeps working across UI updates.
- **Cassette art is inline SVG** built with `createElementNS`, themed with CSS variables
  (light and dark follow your system setting).

## 3. If it stops working

Google can change this internal API at any time. Signs: you click Listen, audio plays, but
the deck doesn't open.

1. Open DevTools → **Network**, filter by `batchexecute`, click **Listen**, and find the request
   whose response is large (hundreds of KB to MB).
2. Check its `rpcids=` value. If it isn't `XqA3Ic`, update `TTS_RPC_ID` in `extension/parse.js`.
3. Check the response shape. If the base64 audio moved, adjust `extractAudioBase64` /
   `findLongString` in `extension/parse.js`.
4. Optionally save a HAR (**Network → ⤓ Export HAR**) and run
   `HAR=/path/to/file.har npm test`. The last test checks that a real capture still decodes.
   **A HAR contains your cookies and conversation, so never commit or share it.**
5. Reload the extension in `chrome://extensions` and reload Gemini.

Console messages from the extension start with `[Gemini Listen Downloader]`.
