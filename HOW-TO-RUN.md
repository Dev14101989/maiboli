# How to run Maiboli Desktop 🎤

Maiboli Desktop comes in **two editions** — pick one from [Releases](https://github.com/Dev14101989/maiboli/releases):

| Edition | Recording limit | Release to download |
|---|---|---|
| **Maiboli** (standard) | Unlimited | `v0.4.1` (or newest standard release) |
| **Maiboli 5min** | Auto-stops at 5 minutes, then transcribes | `v0.4.2-limit5` |

Both work identically otherwise: tray icon + floating mic bubble + keyboard shortcut, English pasted at your cursor in any app. They install as separate apps, so you can even have both.

## Windows

1. Download `Maiboli Setup … .exe` (or `Maiboli 5min Setup … .exe`) from the release.
2. Double-click it. If you see **"Windows protected your PC"** → click **More info → Run anyway** (appears because the app isn't code-signed; it's the same file we built from the public source in this repo).
3. Done. The 🎤 appears in the system tray (bottom-right, near the clock — click the `^` arrow if hidden) plus a floating mic bubble on screen.

## macOS (Apple Silicon)

1. Download the `.dmg` from the release and open it.
2. Drag **Maiboli** into **Applications**.
3. First launch only — macOS shows **"Maiboli is damaged and can't be opened"** for unsigned apps. It isn't damaged; clear the flag by pasting this in **Terminal**:
   ```
   xattr -cr /Applications/Maiboli.app
   ```
   (For the 5min edition: `xattr -cr "/Applications/Maiboli 5min.app"`)
4. Open the app from Applications. Allow **Microphone** when asked, and enable Maiboli under **System Settings → Privacy & Security → Accessibility** (that's what lets it paste for you).

## First run (both platforms)

A Settings window opens automatically:

1. Pick a **Provider** — Gemini is the easy start (free API key at [aistudio.google.com](https://aistudio.google.com)).
2. Paste your API key. **Save.**

## Daily use

- **Click the floating mic bubble** (drag it anywhere; it remembers its spot) or press **Ctrl+Alt+M** (Mac: **Cmd+Alt+M**).
- Speak in your language — Hindi, Marathi, Hinglish, Spanish, 55+ languages.
- Click / press again to stop (the 5min edition also stops by itself at 5:00).
- The English text is pasted wherever your cursor is — VS Code, WhatsApp, Word, browser, anywhere. If there's nowhere to paste, it's on your clipboard.
- **Right-click the tray icon** for: AI rewrite (polish) toggle, floating button on/off, Settings, Quit.

## Troubleshooting

| Problem | Fix |
|---|---|
| "Recording failed — …" | Allow the Microphone permission in system privacy settings. |
| Text only lands on the clipboard (Mac) | Enable Maiboli in System Settings → Privacy & Security → Accessibility. |
| Shortcut doesn't work | Another app owns that combo — change it in Settings (e.g. `Ctrl+Shift+Space`). |
| Gemini errors | Check the API key; model `gemini-3.5-flash` is the safe default. |
