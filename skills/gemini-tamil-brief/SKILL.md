---
name: gemini-tamil-brief
description: Use when the user wants to share finished work with their team as a Tamil explanation or Tamil voice note, asks for a "Gemini Tamil brief", "Tamil summary for the team", "share with team", or says /gemini-tamil-brief after Claude completes a task.
---

# Gemini Tamil Brief

## Overview

The user shares finished work with their team as a **Tamil audio voice note**:
Claude writes a complete, fact-checked work summary wrapped in instructions for Gemini →
the user pastes it into gemini.google.com → Gemini answers with a spoken-Tamil script →
the user clicks **⋮ → Listen** and downloads the audio with the *Gemini Listen Downloader*
Chrome extension (retro tape deck: OGG/MP3, trim, boost, shorten pauses): https://github.com/sivaezhumalai/gemini-listen-downloader

Claude's job is the **input to Gemini**. Two things decide the audio quality:
1. **The facts:** complete, correct, nothing invented, nothing secret.
2. **The Gemini instructions:** they make Gemini write *listenable* Tamil. Everything Gemini
   writes is read aloud, including an intro like "இதோ உங்கள்…", headings, bullets, URLs and
   follow-up offers, so the instructions shut those out.

## Output: exactly this shape

One block of text = **Gemini instructions (fixed text below)** + **Work summary (English)**.

### 1. Gemini instructions (copy verbatim; fill only `{AUDIENCE}`)

```
You are preparing a Tamil voice note that I will play with Gemini's "Listen" button and share with my team on WhatsApp. Turn the work summary below into a complete spoken-Tamil explanation for: {AUDIENCE}.

How to write it:
- Natural, everyday spoken Tamil (பேச்சுத் தமிழ்), the way a friendly team lead explains things face to face. Simple words, short sentences, warm tone.
- Keep technical and product terms in English where the team uses them (for example API, deploy, booking, database). The first time each one appears, explain what it means in one simple Tamil sentence.
- Plain paragraphs only. No title, headings, bullet points, numbering symbols, tables, bold, emojis, code, URLs or file paths: every character will be read aloud.
- Write numbers, money, dates and times the way they should be spoken, for example "512 கிலோமீட்டர்", "நவம்பர் 2-ஆம் தேதி", "₹2,350", "மதியம் 1:30 மணி".
- Start directly with "வணக்கம் டீம்". Do not write any introduction such as "இதோ…" before it.
- Follow this order: what this update is about in one line; the problem or goal and why it mattered; the cause (if this was a fix); what we did, step by step; the result with the key numbers and how we checked it; what is still pending or risky; exactly what each person or role in the team needs to do now; a short closing.
- Cover every point in the summary. Do not drop details; explain them simply, and give a small everyday example where it helps understanding.
- Finish with the closing sentence. Add nothing after it: no follow-up questions, offers or notes.
- Reply with only the Tamil voice-note script.

Work summary:
```

`{AUDIENCE}`: who will listen, in plain words, e.g. "our developers", "the operations and
support team (non-technical)", "the whole team, technical and non-technical". If the user
hasn't said, use "the whole team, technical and non-technical".

### 2. Work summary (English, plain text, these sections in this order)

```
TITLE: <one line>
AUDIENCE NOTE: <what this audience already knows / does not know>

CONTEXT: <why this work happened; business impact in plain words>
PROBLEM OR GOAL: <what was wrong or wanted; concrete example with real numbers>
CAUSE: <root cause; write "Not applicable (new feature)" for features>
WHAT WE DID:
1. <change, and why>
2. ...
RESULT: <what is true now; before → after numbers>
HOW WE CHECKED: <tests, real data, manual checks; say plainly what was NOT tested>
PENDING AND RISKS: <open items, known limits, what to watch>
ACTIONS FOR THE TEAM:
- <role or person>: <what to do> <by when, if known>
TERMS TO EXPLAIN: <term = one-line plain meaning>, ...
```

Every section is REQUIRED. When a section has nothing, write "None", so Gemini doesn't fill
the gap itself.

## Steps

1. **Collect facts from this session:** the request, the diffs/commits, test and command output,
   numbers, decisions and their reasons. Use only what the session shows. Mark anything
   unverified as "not yet tested" or "expected".
2. **Remove what must not leave the machine:** API keys, tokens, passwords, internal
   hostnames/URLs, customer names, phone numbers, emails, addresses. Summarise them instead
   ("a customer in Chennai", "the payments key"). The text goes to a third-party service.
3. **Write sections 1 + 2** as one block.
4. **Save and copy:**
   ```bash
   mkdir -p ~/gemini-briefs
   f=~/gemini-briefs/$(date +%F)-<short-slug>.txt
   cat > "$f" <<'BRIEF'
   ...the whole block...
   BRIEF
   (pbcopy < "$f" || wl-copy < "$f" || xclip -selection clipboard < "$f" || clip.exe < "$f") 2>/dev/null && echo copied
   ```
5. **Reply to the user** with: the file path, whether it's on the clipboard, the block itself
   in a fenced code block, and the next steps: paste into Gemini → wait for the Tamil reply →
   **⋮ → Listen** → the **tape deck** opens → **⬇ MP3** (optionally switch on **Boost volume** / **Shorten pauses**, or **✂ Trim** first).

## Common mistakes

| Mistake | Result in the audio | Fix |
|---|---|---|
| Summary in Markdown with tables/links | Gemini copies the structure; Listen reads symbols and URLs | Plain text sections as above |
| Vague results ("works better now") | Tamil script sounds empty; team can't act | Real before → after numbers |
| Skipping ACTIONS FOR THE TEAM | Voice note ends without telling anyone what to do | Required section, by role |
| Writing the summary in Tamil yourself | Stiff written Tamil, not spoken style | English facts; Gemini does spoken Tamil |
| Leaving secrets or customer details | Leaked to Gemini and to everyone who gets the audio | Step 2 scrub |
| Claiming untested things work | Team acts on a wrong claim | "not yet tested" in HOW WE CHECKED |
