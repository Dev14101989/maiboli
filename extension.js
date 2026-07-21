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

  const toggleRewrite = vscode.commands.registerCommand(
    "maiboli.toggleRewrite",
    async () => {
      const cfg = vscode.workspace.getConfiguration("maiboli");
      const next = !cfg.get("rewrite", false);
      await cfg.update("rewrite", next, vscode.ConfigurationTarget.Global);
      vscode.window.showInformationMessage(
        next
          ? "Maiboli: AI rewrite ON — dictations will be polished."
          : "Maiboli: AI rewrite OFF — raw transcription."
      );
    }
  );
  context.subscriptions.push(toggleRewrite);
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

    let text = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Maiboli: transcribing (${provider})…`,
      },
      () =>
        provider === "sarvam"
          ? sarvamLong(buffer, cfg)
          : provider === "gemini"
            ? gemini(buffer, cfg)
            : whisper(buffer, cfg)
    );

    // Gemini polishes in the same call (see prompt) — no separate pass.
    if (text && provider !== "gemini" && cfg.get("rewrite", false)) {
      text = await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: "Maiboli: polishing…",
        },
        // On any rewrite failure, fall back to the raw transcription.
        () => rewrite(text, cfg).catch(() => text)
      );
    }

    if (text) insertText(text);
    else vscode.window.showWarningMessage("Maiboli: no speech detected.");
  } catch (e) {
    vscode.window.showErrorMessage("Maiboli: " + e.message);
  } finally {
    try { if (audioPath) fs.unlinkSync(audioPath); } catch (_) {}
  }
}

// Retry transient failures (rate limits, overloaded servers) with a short
// backoff before giving up — a 503 usually clears within seconds. Each
// attempt is capped at 60s so a hung connection can't spin forever.
async function fetchWithRetry(url, options, tries = 3) {
  let res;
  for (let i = 0; i < tries; i++) {
    try {
      res = await fetch(url, { ...options, signal: AbortSignal.timeout(60000) });
    } catch (e) {
      if (e.name === "TimeoutError" || e.name === "AbortError") {
        throw new Error("request timed out after 60s — check your internet connection and try again.");
      }
      throw e;
    }
    if (res.ok || ![429, 500, 502, 503, 504].includes(res.status)) return res;
    if (i < tries - 1) {
      await new Promise((r) => setTimeout(r, 2000 * (i + 1)));
    }
  }
  return res;
}

// OpenAI Whisper /translations -> English (auto-detects 55+ spoken languages)
async function whisper(buffer, cfg) {
  const key = cfg.get("openaiApiKey");
  if (!key) throw new Error("Set maiboli.openaiApiKey in Settings.");

  const form = new FormData();
  form.append("file", new Blob([buffer], { type: "audio/wav" }), "audio.wav");
  form.append("model", "whisper-1");

  const res = await fetchWithRetry("https://api.openai.com/v1/audio/translations", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}` },
    body: form,
  });
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${await res.text()}`);
  const json = await res.json();
  return (json.text || "").trim();
}

// Sarvam's instant endpoint rejects audio over 30s — split long recordings
// into 29s chunks, transcribe each in order, and join the English output.
async function sarvamLong(buffer, cfg) {
  const parts = wavChunks(buffer, 29);
  const out = [];
  for (const part of parts) {
    out.push(await sarvam(part, cfg));
  }
  return out.filter(Boolean).join(" ").trim();
}

// Sarvam speech-to-text-translate -> English (best for Indian languages/Hinglish)
async function sarvam(buffer, cfg) {
  const key = cfg.get("sarvamApiKey");
  if (!key) throw new Error("Set maiboli.sarvamApiKey in Settings.");

  const form = new FormData();
  form.append("file", new Blob([buffer], { type: "audio/wav" }), "audio.wav");
  form.append("model", "saaras:v2.5");

  const res = await fetchWithRetry("https://api.sarvam.ai/speech-to-text-translate", {
    method: "POST",
    headers: { "api-subscription-key": key },
    body: form,
  });
  if (!res.ok) throw new Error(`Sarvam ${res.status}: ${await res.text()}`);
  const json = await res.json();
  return (json.transcript || json.text || "").trim();
}

// Google Gemini: audio in -> English out in ONE call (auto language
// detection; polishes too when maiboli.rewrite is on). No 30s limit.
async function gemini(buffer, cfg) {
  const key = cfg.get("geminiApiKey");
  if (!key) throw new Error("Set maiboli.geminiApiKey in Settings.");
  const model = cfg.get("geminiModel") || "gemini-3.5-flash";

  const instruction = cfg.get("rewrite", false)
    ? "Listen to this audio. The speaker may use any language, or mix " +
      "languages mid-sentence. Translate what they said into clear, " +
      "polished English: fix grammar, remove filler words, and join broken " +
      "fragments, while preserving the meaning, tone, and all technical " +
      "terms. Output ONLY the final English text — no comments, no quotes."
    : "Listen to this audio. The speaker may use any language, or mix " +
      "languages mid-sentence. Transcribe what they said and translate it " +
      "faithfully into natural English, without adding or dropping " +
      "anything. Output ONLY the English text — no comments, no quotes.";

  const res = await fetchWithRetry(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    {
      method: "POST",
      headers: { "x-goog-api-key": key, "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              {
                inline_data: {
                  mime_type: "audio/wav",
                  data: buffer.toString("base64"),
                },
              },
              { text: instruction },
            ],
          },
        ],
      }),
    }
  );
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${await res.text()}`);
  const json = await res.json();
  const parts = json.candidates?.[0]?.content?.parts || [];
  return parts.map((p) => p.text || "").join("").trim();
}

// Polish dictated text with a small LLM pass. maiboli.rewriteProvider picks
// the engine; "auto" prefers OpenAI (gpt-4o-mini) over Sarvam (sarvam-m).
async function rewrite(text, cfg) {
  const system =
    "You clean up dictated speech-to-text output. Rewrite the user's text " +
    "into clear, natural English: fix grammar and punctuation, remove filler " +
    "words, and smoothly join broken sentence fragments. Preserve the " +
    "meaning, tone, and all technical terms. Return ONLY the rewritten text " +
    "with no comments or quotes.";

  const pref = cfg.get("rewriteProvider", "auto");
  const openaiKey = cfg.get("openaiApiKey");
  if ((pref === "auto" || pref === "openai") && openaiKey) {
    const res = await fetchWithRetry("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${openaiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0.2,
        messages: [
          { role: "system", content: system },
          { role: "user", content: text },
        ],
      }),
    });
    if (!res.ok) throw new Error(`OpenAI ${res.status}`);
    const json = await res.json();
    const out = (json.choices?.[0]?.message?.content || "").trim();
    return out || text;
  }

  const sarvamKey = cfg.get("sarvamApiKey");
  if ((pref === "auto" || pref === "sarvam") && sarvamKey) {
    const res = await fetchWithRetry("https://api.sarvam.ai/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${sarvamKey}`,
        "api-subscription-key": sarvamKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "sarvam-m",
        temperature: 0.2,
        messages: [
          { role: "system", content: system },
          { role: "user", content: text },
        ],
      }),
    });
    if (!res.ok) throw new Error(`Sarvam ${res.status}`);
    const json = await res.json();
    const out = (json.choices?.[0]?.message?.content || "").trim();
    return out || text;
  }

  const geminiKey = cfg.get("geminiApiKey");
  if ((pref === "auto" || pref === "gemini") && geminiKey) {
    const model = cfg.get("geminiModel") || "gemini-3.5-flash";
    const res = await fetchWithRetry(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      {
        method: "POST",
        headers: { "x-goog-api-key": geminiKey, "Content-Type": "application/json" },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: system }] },
          contents: [{ parts: [{ text: text }] }],
        }),
      }
    );
    if (!res.ok) throw new Error(`Gemini ${res.status}`);
    const json = await res.json();
    const parts = json.candidates?.[0]?.content?.parts || [];
    const out = parts.map((p) => p.text || "").join("").trim();
    return out || text;
  }

  return text;
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

// Locate the PCM "data" chunk inside a WAV buffer.
function findDataChunk(buffer) {
  if (buffer.length < 44 || buffer.toString("ascii", 0, 4) !== "RIFF") {
    return null;
  }
  let off = 12;
  while (off + 8 <= buffer.length) {
    const id = buffer.toString("ascii", off, off + 4);
    const size = buffer.readUInt32LE(off + 4);
    if (id === "data") {
      return { offset: off + 8, size: Math.min(size, buffer.length - off - 8) };
    }
    if (size === 0 || size === 0xffffffff) return null;
    off += 8 + size + (size % 2);
  }
  return null;
}

// Split a 16kHz/mono/16-bit WAV into standalone WAVs of at most maxSec each.
// Cuts are placed at the quietest moment near each boundary (usually a pause
// between sentences), so chunks stay meaningful on their own.
function wavChunks(buffer, maxSec) {
  const data = findDataChunk(buffer);
  const bytesPerSec = 16000 * 2;
  const maxBytes = maxSec * bytesPerSec;
  if (!data || data.size <= maxBytes) return [buffer];

  const chunks = [];
  let pos = 0;
  while (data.size - pos > maxBytes) {
    const cut = quietestCut(buffer, data.offset + pos, maxBytes, bytesPerSec);
    chunks.push(
      makeWav(buffer.subarray(data.offset + pos, data.offset + pos + cut))
    );
    pos += cut;
  }
  chunks.push(makeWav(buffer.subarray(data.offset + pos, data.offset + data.size)));
  return chunks;
}

// Scan 100ms frames in the last 40% of the allowed chunk length and return
// a sample-aligned cut point at the quietest one.
function quietestCut(buffer, start, maxBytes, bytesPerSec) {
  const frame = Math.floor(bytesPerSec / 10 / 2) * 2;
  const from = Math.floor((maxBytes * 0.6) / 2) * 2;
  let best = maxBytes;
  let bestEnergy = Infinity;
  for (let p = from; p + frame <= maxBytes; p += frame) {
    let energy = 0;
    for (let i = 0; i < frame; i += 2) {
      energy += Math.abs(buffer.readInt16LE(start + p + i));
    }
    if (energy < bestEnergy) {
      bestEnergy = energy;
      best = p + frame / 2;
    }
  }
  return Math.floor(best / 2) * 2;
}

// Wrap raw 16kHz/mono/16-bit PCM in a canonical 44-byte WAV header.
function makeWav(pcm) {
  const h = Buffer.alloc(44);
  h.write("RIFF", 0);
  h.writeUInt32LE(36 + pcm.length, 4);
  h.write("WAVE", 8);
  h.write("fmt ", 12);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(1, 22);
  h.writeUInt32LE(16000, 24);
  h.writeUInt32LE(32000, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write("data", 36);
  h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}

function deactivate() {
  if (recProc) recProc.kill("SIGINT");
}

module.exports = { activate, deactivate };
