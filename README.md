# Gemini Listen Downloader

A Chrome extension that lets you download the audio Gemini plays when you click **Listen** on a response.

## Install (once)

1. Open `chrome://extensions`
2. Turn on **Developer mode** (top right)
3. Click **Load unpacked** and pick the `extension/` folder in this project
4. Reload any open gemini.google.com tabs

## Use

1. On a Gemini response, click **⋮ → Listen** (or the ▶ button at the top)
2. A **🔊 Gemini audio** panel appears at the bottom right with a player and two buttons:
   - **⬇ OGG**: the original audio exactly as Gemini sent it (smallest file, instant)
   - **⬇ MP3**: converted in your browser (96 kbps mono, plays everywhere incl. iPhone). A 2½-minute
     clip takes about 10 s; the button shows progress
3. Files are named `gemini-<language>-<first words>-<date>.ogg` / `.mp3`

### Trim

Click **✂ Trim** on any clip card to open the waveform editor. Drag the start and end handles on the waveform (or use **[ Set start** / **Set end ]** while playing to set markers), check your selection with **▶ Preview**, then click **⬇ Trimmed MP3** to export. Trimmed exports are MP3 only (the full-clip OGG stays the untouched original).

MP3 encoding uses LAME via [lamejs](https://github.com/zhuker/lamejs) 1.2.1 (LGPL, unmodified, in
`extension/vendor/`, see https://lame.sourceforge.io).

After changing any file in `extension/`, click the ↻ reload icon on the extension's card in
`chrome://extensions` and reload the Gemini tab.

## How it works

Clicking Listen makes Gemini call `batchexecute?rpcids=XqA3Ic` with
`["lyra", <response text>, <language e.g. ta-IN>, null, 2]`. The server returns the audio as base64
OGG/Opus, which the page turns into a `blob:` URL. The extension runs in the page
(`content.js`), keeps a copy of that response and decodes it (`parse.js`). It doesn't send
any extra requests and talks to no other server.

If Gemini changes the RPC id or response shape, update `TTS_RPC_ID` / `extractAudioBase64` in
`extension/parse.js`.

## Tests

```
node --test test/parse.test.js
HAR=~/Downloads/gemini.google.com.har node --test test/parse.test.js   # also checks a real capture
```
