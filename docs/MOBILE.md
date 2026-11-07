# Tamil audio on your phone

The tape-deck extension only runs in **desktop** Chrome: phone browsers and the Gemini app
can't load Chrome extensions. Here's what works on **Android and iPhone** today, best first.

| Option | Voice | Download? | Cost | Effort |
|---|---|---|---|---|
| [A. NotebookLM app](#a-notebooklm-app-best-for-articles-and-news) | Two friendly hosts chatting in Tamil, podcast style | ✅ yes, built in | Free | Easy |
| [B. Gem + screen recorder](#b-the-gem--your-phones-screen-recorder-exact-gemini-listen-voice) | Exactly Gemini's **Listen** voice, with our Gem script | ✅ via recording | Free | Medium |
| [C. Gemini app Audio Overview](#c-gemini-app-audio-overview) | Two hosts, podcast style | ✅ Download button | Free | Easy |
| [D. Our own mobile web app (planned)](#d-planned-a-mobile-web-app-for-one-tap-mp3) | Gemini's Tamil text-to-speech | ✅ one tap → MP3 → WhatsApp | API usage | Not built yet |

---

## A. NotebookLM app (best for articles and news)

[NotebookLM](https://notebooklm.google.com) is Google's free research app. Its **Audio Overview**
turns a page into a short "podcast" with two hosts talking naturally, in **Tamil**, and you can
**download** it or listen offline.

**Set up once**
1. Install **NotebookLM** from the Play Store (Android 10+) or App Store (iOS 17+). Sign in with your Google account.
2. Set Tamil: open **Settings → Output language → தமிழ் (Tamil)**.

**Each time**
1. In Chrome (or any app), open the article → **Share** → **NotebookLM**.
   (Or open NotebookLM → **+ New notebook** → add the link, text, PDF or YouTube video.)
2. Tap **Audio Overview** → **Customize**, and paste this so it sounds like our Gem:

   ```
   Speak in natural everyday spoken Tamil, warm and friendly, like two friends explaining this over tea to a general Tamil listener. Start with an interesting hook, explain the main points as a story with one everyday Tamil Nadu example, say what it means for the listener, and end with one line to remember. Keep it to about 3 to 5 minutes. Only use facts from the source and say who reported it.
   ```
3. Tap **Generate**. It usually takes a few minutes.
4. Open the audio's **⋮ menu → Download** (or save it for offline), then share the file on WhatsApp.

> Menu names change between app versions. If you don't see *Download*, look in the audio
> player's **⋮** menu or the **Share** button.

---

## B. The Gem + your phone's screen recorder (exact Gemini Listen voice)

Use this when you want **exactly** the single Gemini voice from the
[Tamil Audio Summary Gem](../gemini-gem/tamil-audio-summary.md).

1. Create the Gem once on a computer (see the Gem guide). It then appears in the **Gemini app** under *Gems*.
2. In the Gemini app, open the Gem, paste the link or text, and wait for the Tamil script.
3. Start your phone's screen recorder **with sound**:
   - **Android 11+:** swipe down twice → **Screen record** → choose **Device audio** (not the
     microphone) → **Start**. (Samsung: *Screen recorder → Media sounds*.)
   - **iPhone:** Control Centre → long-press **Screen Recording** → make sure the microphone is
     **off** → **Start Recording**. App sound is recorded automatically.
4. Tap **⋮ → Listen** on the answer. Stop the recording when it finishes.
5. Trim the start and end in **Google Photos / Photos → Edit**, then share the video on WhatsApp.
   WhatsApp plays it fine. If you need audio only, any free "video to MP3" app can convert it.

---

## C. Gemini app Audio Overview

The Gemini app can turn a **document you upload** (or a Deep Research report) into a two-host
**Audio Overview**, with a **Download** control in its player on Android.

1. In the Gemini app, tap **+** and upload a document (PDF, Doc), or run **Deep Research** on the topic.
2. Tap **Generate Audio Overview** (shown above the chat box, or under the report).
3. When it's ready, open it in the player → **Download**.

> We haven't confirmed which languages the Gemini app's Audio Overview supports. If Tamil isn't
> offered, use NotebookLM (option A), which supports Tamil.

---

## D. Planned: a mobile web app for one-tap MP3

The most phone-friendly fix would be a small web app you add to your home screen:

1. In the Gemini app, long-press the Gem's Tamil answer → **Copy** (or **Share**).
2. **Share** it to the *Tamil Voice Note* app (it appears in the share sheet).
3. The app reads it aloud with **Gemini's Tamil text-to-speech** (Google lists Tamil, `ta-IN`, as
   supported), lets you trim, boost the volume or shorten pauses, and gives you an **MP3 →
   WhatsApp** button.

It isn't built yet. It needs a Google AI API key (Google AI Studio has a free tier, and paid
usage is billed per character), plus a small server so the key isn't exposed. If you'd like it,
open an issue or ask in the repo.
