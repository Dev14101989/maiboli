; Maiboli Anywhere (Windows) — system-wide voice dictation, any language -> English.
;
; Requires: AutoHotkey v2 (autohotkey.com) and sox (choco install sox.portable).
; 1. Put your API key below.
; 2. Double-click this file to run it (a green "H" appears in the system tray).
; 3. In ANY app: press Ctrl+Alt+V to start recording, press again to stop —
;    the English text is pasted at your cursor.
; To start it automatically with Windows: put a shortcut to this file in
; shell:startup (Win+R, type shell:startup).

#Requires AutoHotkey v2.0
#SingleInstance Force

; ================= CONFIG =================
PROVIDER := "whisper"          ; "whisper" (OpenAI) or "sarvam"
OPENAI_API_KEY := ""           ; paste your OpenAI key here
SARVAM_API_KEY := ""           ; or your Sarvam key here
SOX_PATH := "sox"              ; full path to sox.exe if not on PATH,
                               ; e.g. "C:\Program Files (x86)\sox-14-4-2\sox.exe"
; ===========================================

global recording := false
global recPid := 0
global wavFile := A_Temp . "\maiboli-rec.wav"

^!v:: ToggleRecording()  ; Ctrl+Alt+V

ToggleRecording() {
    global
    if (!recording) {
        try FileDelete(wavFile)
        Run(Format('"{}" -q -d -r 16000 -c 1 -b 16 "{}"', SOX_PATH, wavFile), , "Hide", &recPid)
        recording := true
        TrayTip("Maiboli", "Recording… press Ctrl+Alt+V to stop.", 1)
    } else {
        recording := false
        try ProcessClose(recPid)
        Sleep(300)
        TrayTip("Maiboli", "Transcribing…", 1)
        text := Transcribe()
        if (text = "") {
            TrayTip("Maiboli", "No speech detected (or API error).", 2)
            return
        }
        A_Clipboard := text          ; clipboard first — also the fallback
        Sleep(150)
        Send("^v")                   ; paste at the cursor of the focused app
    }
}

Transcribe() {
    global
    ; sox was hard-killed, so repair the WAV header sizes first.
    FixWavHeader(wavFile)

    respFile := A_Temp . "\maiboli-resp.json"
    try FileDelete(respFile)

    if (PROVIDER = "sarvam") {
        if (SARVAM_API_KEY = "") {
            TrayTip("Maiboli", "Paste your SARVAM_API_KEY at the top of maiboli.ahk", 2)
            return ""
        }
        ; Sarvam rejects clips over 30s — split into 29s chunks and join the text.
        chunkBase := A_Temp . "\maiboli-chunk"
        Loop Files chunkBase . "*.wav"
            try FileDelete(A_LoopFileFullPath)
        RunWait(Format('"{}" "{}" "{}_%03n.wav" trim 0 29 : newfile : restart',
            SOX_PATH, wavFile, chunkBase), , "Hide")
        text := ""
        Loop Files chunkBase . "*.wav" {
            cmd := Format('curl -s --max-time 60 https://api.sarvam.ai/speech-to-text-translate '
                . '-H "api-subscription-key: {}" -F model=saaras:v2.5 '
                . '-F "file=@{};type=audio/wav" -o "{}"', SARVAM_API_KEY, A_LoopFileFullPath, respFile)
            RunWait(A_ComSpec . ' /c ' . cmd, , "Hide")
            part := ReadJsonField(respFile, "transcript")
            if (part != "")
                text .= (text != "" ? " " : "") . part
            try FileDelete(A_LoopFileFullPath)
        }
        try FileDelete(wavFile)
        return text
    } else {
        if (OPENAI_API_KEY = "") {
            TrayTip("Maiboli", "Paste your OPENAI_API_KEY at the top of maiboli.ahk", 2)
            return ""
        }
        cmd := Format('curl -s --max-time 60 https://api.openai.com/v1/audio/translations '
            . '-H "Authorization: Bearer {}" -F model=whisper-1 '
            . '-F "file=@{}" -o "{}"', OPENAI_API_KEY, wavFile, respFile)
    }
    RunWait(A_ComSpec . ' /c ' . cmd, , "Hide")
    try FileDelete(wavFile)
    return ReadJsonField(respFile, "text")
}

; Parse one field out of a JSON response file with PowerShell (no AHK JSON lib).
ReadJsonField(respFile, field) {
    if (!FileExist(respFile))
        return ""
    psOut := A_Temp . "\maiboli-text.txt"
    ps := Format('powershell -NoProfile -Command "(Get-Content -Raw \"{}\" | ConvertFrom-Json).{} | Set-Content -NoNewline \"{}\""',
        respFile, field, psOut)
    RunWait(ps, , "Hide")
    text := ""
    try text := Trim(FileRead(psOut, "UTF-8"))
    try FileDelete(respFile)
    try FileDelete(psOut)
    return text
}

FixWavHeader(file) {
    try {
        f := FileOpen(file, "rw")
        if (!f || f.Length < 44)
            return
        f.Pos := 0
        riff := f.Read(4)
        if (riff != "RIFF") {
            f.Close()
            return
        }
        size := f.Length
        f.Pos := 4
        f.WriteUInt(size - 8)
        ; canonical sox header: "data" chunk size lives at byte 40
        f.Pos := 36
        dataId := f.Read(4)
        if (dataId = "data") {
            f.Pos := 40
            f.WriteUInt(size - 44)
        }
        f.Close()
    }
}
