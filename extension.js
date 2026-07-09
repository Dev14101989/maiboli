const vscode = require("vscode");
const cp = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

let recording = false;
let recProc = null;
let audioPath = null;
let pendingTranscribe = false;
let statusItem;
let targetEditor;

function activate(context) {
  statusItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    100
  );
  statusItem.command = "maiboli.startDictation";
  context.subscriptions.push(statusItem);
  updateStatus();

  const cmd = vscode.commands.registerCommand(
    "maiboli.startDictation",
    () => {
      if (recording) stopAndTranscribe();
      else startRecording();
    }
  );
  context.subscriptions.push(cmd);
}

function updateStatus() {
  if (recording) {
    statusItem.text = "$(record) Recording… (Cmd/Ctrl+Alt+V to stop)";
    statusItem.tooltip = "Press Cmd/Ctrl+Alt+V to stop and transcribe";
  } else {
    statusItem.text = "$(mic) Maiboli";
    statusItem.tooltip = "Press Cmd/Ctrl+Alt+V to start dictation";
  }
  statusItem.show();
}

// ---- Start recording with a native tool (sox by default) ----
function startRecording() {
  targetEditor = vscode.window.activeTextEditor;

  const cfg = vscode.workspace.getConfiguration("maiboli");
  const recorder = cfg.get("recorder", "sox");
  const customPath = cfg.get("recorderPath", "").trim();

  audioPath = path.join(os.tmpdir(), `maiboli-${Date.now()}.wav`);

  let bin, args;
  if (recorder === "ffmpeg" && process.platform === "darwin") {
    bin = customPath || "ffmpeg";
    args = ["-y", "-f", "avfoundation", "-i", ":default",
            "-ar", "16000", "-ac", "1", audioPath];
  } else {
    bin = customPath || "sox";
    args = ["-q", "-d", "-r", "16000", "-c", "1", "-b", "16", audioPath];
  }

  // GUI apps on macOS often miss Homebrew paths — add them so sox/ffmpeg are found.
  const env = {
    ...process.env,
    PATH: `${process.env.PATH || ""}:/opt/homebrew/bin:/usr/local/bin`,
  };

  try {
    recProc = cp.spawn(bin, args, { env });
  } catch (e) {
    vscode.window.showErrorMessage("Maiboli: " + e.message);
    return;
  }

  recProc.on("error", (err) => {
    recording = false;
    updateStatus();
    if (err.code === "ENOENT") {
      vscode.window.showErrorMessage(
        `Maiboli: '${bin}' not found. Install it first (see README).`
      );
    } else {
      vscode.window.showErrorMessage("Maiboli: " + err.message);
    }
  });

  recProc.on("close", () => {
    if (pendingTranscribe) {
      pendingTranscribe = false;
      transcribeFile();
    }
    recProc = null;
  });

  recording = true;
  updateStatus();
}

function stopAndTranscribe() {
  if (!recProc) {
    recording = false;
    updateStatus();
    return;
  }
  pendingTranscribe = true;
  recording = false;
  updateStatus();
  if (process.platform === "win32") {
    // Windows has no SIGINT for GUI-spawned processes — hard-kill and
    // repair the WAV header afterwards (see fixWavHeader).
    recProc.kill();
  } else {
    // SIGINT lets sox/ffmpeg close the file cleanly.
    recProc.kill("SIGINT");
  }
}

// ---- Read the recorded file, send to the chosen engine, insert text ----
async function transcribeFile() {
  try {
    if (!audioPath || !fs.existsSync(audioPath)) {
      throw new Error("no audio was recorded.");
    }
    const buffer = fixWavHeader(fs.readFileSync(audioPath));
    if (buffer.length < 2000) {
      throw new Error(
        "recording was empty. Check that VS Code is allowed to use the microphone in your system privacy settings."
      );
    }

    const cfg = vscode.workspace.getConfiguration("maiboli");
    const provider = cfg.get("provider", "whisper");

    const text = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Maiboli: transcribing (${provider})…`,
      },
      () =>
        provider === "sarvam" ? sarvam(buffer, cfg) : whisper(buffer, cfg)
    );

    if (text) insertText(text);
    else vscode.window.showWarningMessage("Maiboli: no speech detected.");
  } catch (e) {
    vscode.window.showErrorMessage("Maiboli: " + e.message);
  } finally {
    try { if (audioPath) fs.unlinkSync(audioPath); } catch (_) {}
  }
}

// OpenAI Whisper /translations -> English (auto-detects 55+ spoken languages)
async function whisper(buffer, cfg) {
  const key = cfg.get("openaiApiKey");
  if (!key) throw new Error("Set maiboli.openaiApiKey in Settings.");

  const form = new FormData();
  form.append("file", new Blob([buffer], { type: "audio/wav" }), "audio.wav");
  form.append("model", "whisper-1");

  const res = await fetch("https://api.openai.com/v1/audio/translations", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}` },
    body: form,
  });
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${await res.text()}`);
  const json = await res.json();
  return (json.text || "").trim();
}

// Sarvam speech-to-text-translate -> English (best for Indian languages/Hinglish)
async function sarvam(buffer, cfg) {
  const key = cfg.get("sarvamApiKey");
  if (!key) throw new Error("Set maiboli.sarvamApiKey in Settings.");

  const form = new FormData();
  form.append("file", new Blob([buffer], { type: "audio/wav" }), "audio.wav");
  form.append("model", "saaras:v2.5");

  const res = await fetch("https://api.sarvam.ai/speech-to-text-translate", {
    method: "POST",
    headers: { "api-subscription-key": key },
    body: form,
  });
  if (!res.ok) throw new Error(`Sarvam ${res.status}: ${await res.text()}`);
  const json = await res.json();
  return (json.transcript || json.text || "").trim();
}

async function insertText(text) {
  // Always put the text on the clipboard, then paste it at the current
  // focus point — this works in code editors, AI chat boxes (Claude,
  // Copilot), the terminal, search fields, anywhere.
  await vscode.env.clipboard.writeText(text);
  try {
    await pasteKeystroke();
    return;
  } catch (_) {
    // No permission to send keystrokes — fall back to direct editor insert.
  }

  const editor =
    vscode.window.activeTextEditor ||
    (targetEditor && !targetEditor.document.isClosed ? targetEditor : null);

  if (editor) {
    editor.edit((builder) => {
      editor.selections.forEach((sel) => builder.insert(sel.active, text));
    });
  } else {
    vscode.window.showInformationMessage(
      "Copied to clipboard — paste it where you need it:\n" + text
    );
  }
}

// Simulate a paste keystroke so the text lands wherever the cursor is.
// macOS: needs Accessibility permission for VS Code (asked once).
// Windows: uses SendKeys, no special permission needed.
function pasteKeystroke() {
  return new Promise((resolve, reject) => {
    const done = (err) => (err ? reject(err) : resolve());
    if (process.platform === "darwin") {
      cp.execFile(
        "osascript",
        ["-e", 'tell application "System Events" to keystroke "v" using command down'],
        done
      );
    } else if (process.platform === "win32") {
      cp.execFile(
        "powershell",
        ["-NoProfile", "-Command",
         "(New-Object -ComObject wscript.shell).SendKeys('^v')"],
        done
      );
    } else {
      cp.execFile("xdotool", ["key", "ctrl+v"], done);
    }
  });
}

// A hard-killed sox (Windows stop) leaves placeholder sizes in the WAV
// header, which some APIs reject. Patch the RIFF and data chunk sizes
// to match the real file length; leaves already-valid files untouched.
function fixWavHeader(buffer) {
  if (buffer.length < 44 || buffer.toString("ascii", 0, 4) !== "RIFF") {
    return buffer;
  }
  const riffSize = buffer.readUInt32LE(4);
  const realRiff = buffer.length - 8;
  if (riffSize !== realRiff) buffer.writeUInt32LE(realRiff, 4);

  let off = 12;
  while (off + 8 <= buffer.length) {
    const id = buffer.toString("ascii", off, off + 4);
    const size = buffer.readUInt32LE(off + 4);
    if (id === "data") {
      const real = buffer.length - off - 8;
      if (size !== real) buffer.writeUInt32LE(real, off + 4);
      break;
    }
    if (size === 0 || size === 0xffffffff) break;
    off += 8 + size + (size % 2);
  }
  return buffer;
}

function deactivate() {
  if (recProc) recProc.kill("SIGINT");
}

module.exports = { activate, deactivate };
