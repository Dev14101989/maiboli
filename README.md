# Maiboli (VoiceBridge — Speak to Code) 🎤

**Speak in your mother tongue. Code in English.**

Maiboli (मायबोली, "mother tongue" in Marathi) is a VS Code extension that listens to you speak — in Hindi, Marathi, Tamil, Spanish, Portuguese, or **55+ languages** — and types the **English translation** wherever your cursor is:

- 📝 in your code files
- 💬 in AI chat boxes (Claude Code, GitHub Copilot Chat)
- ⌨️ in the terminal, search bars, commit messages… anywhere

Press one shortcut, talk naturally (mixed languages like Hinglish work too), press it again — the English text appears at your cursor.

> "ek function likhna hai jo array ko sort kare" → *"I need to write a function that sorts an array"*

Works on **macOS and Windows**.

## Why?

AI coding assistants speak English. Millions of great developers think in something else. Maiboli is the bridge — describe your problem out loud in the language you think in, and prompt Copilot/Claude in clean English without typing a word.

## Install (one time)

1. **Install the extension:** grab the latest `.vsix` from [Releases](https://github.com/Dev14101989/maiboli/releases) → in VS Code open the Extensions panel (Cmd/Ctrl+Shift+X) → `···` menu → **Install from VSIX…**
2. **Install the recorder (sox):**
   - **Mac:** `brew install sox` in Terminal ([Homebrew](https://brew.sh) if you don't have it)
   - **Windows:** `choco install sox.portable` or `scoop install sox` in PowerShell. No package manager? [Download SoX](https://sourceforge.net/projects/sox/), then set the full path to `sox.exe` in Settings → *Maiboli: Recorder Path*.
3. **Add your API key:** Settings (Cmd/Ctrl+,) → search **Maiboli**:

   | Provider | Best for | Get a key |
   |---|---|---|
   | `whisper` (default) | Any of 55+ languages → English | [platform.openai.com](https://platform.openai.com) |
   | `sarvam` | Indian languages + Hinglish (code-mixed) → English | [dashboard.sarvam.ai](https://dashboard.sarvam.ai) — free credits on signup |
   | `gemini` | Any language → English in one call; polishes too when Rewrite is on; no 30s limit | [aistudio.google.com](https://aistudio.google.com) — free tier |

## Use

1. Put your cursor where you want the text.
2. Press **Cmd+Alt+V** (Mac) / **Ctrl+Alt+V** (Windows) — the 🎤 in the status bar turns into "Recording…"
3. Speak.
4. Press the shortcut again. The English text lands at your cursor.

**Tip:** use the keyboard shortcut, not the mouse — clicking the status bar button moves your cursor out of chat boxes.

## Optional: AI rewrite ✨

Dictated text can come out slightly rough — fillers, grammar slips, broken sentence joins. Turn on **AI rewrite** and Maiboli passes the English through a small LLM that polishes it while keeping your meaning and technical terms:

- Toggle it from the Command Palette: **Maiboli: Toggle AI Rewrite** (or Settings → *Maiboli: Rewrite*).
- It reuses the API key you already have: OpenAI key → `gpt-4o-mini`, Sarvam key → `sarvam-m`. Cost is a tiny fraction of the transcription itself.
- **Mix and match:** transcribe with Sarvam, polish with GPT — just set both keys. *Maiboli: Rewrite Provider* forces a specific polisher (`auto` prefers OpenAI).
- With `gemini` as provider, polishing happens inside the same call — no separate step.
- Off = raw transcription, exactly as you spoke it. If a rewrite ever fails, you get the raw version automatically.

## Supported languages

- **Whisper mode:** auto-detects the spoken language — Hindi, Marathi, Tamil, Telugu, Bengali, Urdu, Spanish, Portuguese, French, German, Japanese, Korean, Arabic, and [40+ more](https://platform.openai.com/docs/guides/speech-to-text). Output is always English.
- **Sarvam mode:** Indian languages, tuned for real Indian speech and mid-sentence language mixing. Output is always English.

## First-run permissions

- **Mac — Microphone:** "Visual Studio Code wants to access the microphone" → allow.
- **Mac — Accessibility:** lets Maiboli paste for you. If text only lands on your clipboard: System Settings → Privacy & Security → **Accessibility** → enable **Visual Studio Code**.
- **Windows:** usually no prompts. Empty recordings? Settings → Privacy & security → Microphone → allow desktop apps.

## Troubleshooting

| Problem | Fix |
|---|---|
| `'sox' not found` | Install sox (step 2), reload VS Code. Windows: set *Maiboli: Recorder Path* to the full `sox.exe` path. |
| `recording was empty` | Allow VS Code to use the microphone in system privacy settings. |
| "Copied to clipboard…" instead of auto-paste (Mac) | Grant the Accessibility permission above. |
| Text goes to the wrong place | Use the keyboard shortcut instead of clicking the 🎤 button. |

Note: each dictation overwrites your clipboard (the text travels through it).

## Privacy

Your audio is sent only to the provider you configured (OpenAI or Sarvam) for transcription, then deleted from disk. Your API key stays in your VS Code settings. No telemetry, no middleman server.

## License

[MIT](LICENSE) — free to use, modify, and share.
