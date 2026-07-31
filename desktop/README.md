# Maiboli Desktop 🎤

The zero-dependency way to use Maiboli: a tiny tray app with a mic icon next to your clock. Click it (or press the shortcut) → speak in your language → the English lands wherever your cursor is — VS Code, WhatsApp, Word, browser, anywhere.

**No sox. No PowerShell. No terminal.** The app records audio itself.

## Install

Grab the installer from [Releases](https://github.com/Dev14101989/maiboli/releases):

- **Windows:** `Maiboli Setup x.x.x.exe` — double-click, done. The 🎤 appears in the system tray (bottom-right, near the clock; click the ^ arrow if hidden).
- **macOS (Apple Silicon):** `Maiboli-x.x.x-arm64.dmg` — open, drag Maiboli to Applications. First launch: right-click the app → Open (unsigned-app warning appears once). The 🎤 appears in the menu bar (top-right).

## First run

A settings window opens automatically — pick a provider and paste your API key (Gemini has a free tier: aistudio.google.com). Save.

## Use

- **Click the tray mic** or press **Ctrl+Alt+M** (Mac: **Cmd+Alt+M**) → icon turns red → speak → click/press again → English text pastes at your cursor.
- Right-click the tray icon for: AI rewrite toggle, Settings, Quit.
- macOS will ask for **Microphone** and (for auto-paste) **Accessibility** permission once — allow both.

## Building from source

```bash
cd desktop
npm install
npm start          # run in dev
npm run dist:mac   # build .dmg
npm run dist:win   # build .exe (works from macOS too)
```
