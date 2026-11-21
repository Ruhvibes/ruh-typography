# Ruh Typography Studio

Free music & typography studio for creators. No login, no subscription, no watermark.

**Make words move.** Lyrics, typography, mashups and video — one studio, on your phone.

By **Hasnain Khan** (ruhvibes) · Instagram [@ruhvibes1](https://instagram.com/ruhvibes1)

## Download

[RuhTypographyStudio.apk](https://github.com/Ruhvibes/ruh-typography/releases/download/v1/RuhTypographyStudio.apk)

## Studios

- **Typography Studio** — kinetic words from your audio. 6 word effects, 2 layouts (Spotlight + Karaoke), 3 backgrounds, 3 fonts, 10 themes. Hindi, English, Urdu (Nastaliq) and Hinglish.
- **Auto Lyrics Sync** — paste lyrics (or import TXT/SRT/LRC) and snap every word to real vocal onsets in the song — not equal spacing. Manual word-time correction, karaoke preview.
- **Audio Studio** — waveform, trim/cut, merge, gain, fade in/out, normalize, speed, BPM & beat detection. Export WAV/MP3.
- **AI Mashup Studio** — two songs, BPM detection, tempo matching, crossfade, mix balance, WAV export.
- **Video Editor** — trim, speed, filters, captions, 9:16 / 16:9 / 1:1, 720p / 1080p / 4K export.
- **Auto Captions** — burn word-by-word captions onto any video.
- **Emoji Studio** — mood-matched emoji suggestions from your lyrics (love, sad, romantic, lofi, sufi…), plus emoji overlays.
- **GIF Studio** — import local GIFs as overlays (position, size, opacity).
- **AI Visual Generator** — on-device mood backgrounds, particles and a real music visualizer.
- **Templates Library** — 14 real style presets (Romantic, Sad, Lofi, Neon, Sufi, Karaoke…).
- **Script to Video / Text to Voice** — device TTS voices, save as audio.
- **AI Assistant** — plain-language commands that run real app functions.
- **RUH AI Gateway** — add your own provider keys (Groq, Gemini, OpenAI, Mistral, OpenRouter, Cloudflare AI, NVIDIA NIM). Keys stay on your device; nothing is hardcoded.
- **My Projects / Export History / Settings** — local projects with backup & restore, export log, language and export defaults.

## Honest limits

- Lyrics sync uses on-device vocal-onset alignment. Studio-grade word timing (WhisperX-style) needs a cloud model — use the manual correction tools for fine-tuning.
- Video export is WebM (MP4 is not available from the in-app encoder). 4K renders where the device and codec support it, otherwise it falls back to 1080p.
- Live transcription is mic-based (Android SpeechRecognizer). GIF search needs a provider key in RUH AI Gateway.
- Long projects (30–60 min) work but are heavier on memory; 10 minutes or less is smoothest on most phones.

## Build

Android app (WebView + native bridge for text-to-speech, speech recognition, file saving, sharing and JS dialogs).

- Package: `com.ruhvibes.typographystudio`
- Version: 1.0 (versionCode 1)
- Min SDK 26, target SDK 34
- Keystore: per-app, kept out of the repo (`keystore/` is gitignored)

```bash
cd android
gradle assembleDebug   # JAVA_HOME must point at JDK 17
```
