# Maiboli Anywhere 🎤🌍

The same magic as the VS Code extension, but **everywhere on your computer**: WhatsApp Web, Word, Slack, the browser, any text field in any app.

Press a global hotkey → speak in your language → press again → **English text appears at your cursor**. If there's nowhere to paste, the text stays on your clipboard.

## macOS setup

1. **Requirements:** `brew install sox` (you likely have it already if you use the VS Code extension).
2. **Put the script somewhere permanent**, e.g.:
   ```bash
   mkdir -p ~/maiboli && cp mac/maiboli.sh ~/maiboli/ && chmod +x ~/maiboli/maiboli.sh
   ```
3. **Run it once** to create the config, then add your API key:
   ```bash
   ~/maiboli/maiboli.sh
   ```
   It opens `~/.config/maiboli/config` — fill in `OPENAI_API_KEY=` (or switch `PROVIDER=sarvam` and fill `SARVAM_API_KEY=`).
4. **Bind a global hotkey** with the built-in **Shortcuts** app:
   - Open **Shortcuts** → **+** new shortcut → add the action **"Run Shell Script"**.
   - Script: `~/maiboli/maiboli.sh` (shell: zsh or bash, input: none).
   - Name it "Maiboli".
   - Click the shortcut's info (ⓘ) panel → **Add Keyboard Shortcut** → press e.g. **⌥⌘M**.
5. **First use:** press the hotkey anywhere → speak → press again.
   - macOS will ask for **Microphone** access (for Shortcuts) → allow.
   - For auto-paste, allow **Accessibility**: System Settings → Privacy & Security → Accessibility → enable **Shortcuts**. Until then, the text is on your clipboard — just press Cmd+V.

## Windows setup

1. **Requirements:**
   - [AutoHotkey v2](https://www.autohotkey.com) (free, tiny — the standard Windows automation tool)
   - sox: `choco install sox.portable` or `scoop install sox` (or [download](https://sourceforge.net/projects/sox/) and set `SOX_PATH` in the script)
2. Open `windows/maiboli.ahk` in Notepad → paste your API key at the top (`OPENAI_API_KEY := "sk-..."`).
3. Double-click `maiboli.ahk` — a green **H** appears in the system tray. That's it.
4. In any app: **Ctrl+Alt+V** to start, speak, **Ctrl+Alt+V** to stop → English text pastes at your cursor.
5. Optional: auto-start with Windows — press Win+R, type `shell:startup`, drop a shortcut to `maiboli.ahk` there.

## Notes

- Output is always **English**; input can be Hindi, Marathi, Spanish, or 55+ languages (Whisper) / Indian languages (Sarvam).
- Each dictation overwrites your clipboard (the text travels through it).
- Your audio goes only to the provider you configured, and the temp recording is deleted after each use.
