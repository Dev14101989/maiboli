// Speech -> English via the user's chosen provider. Ported from the
// Maiboli VS Code extension (same providers, same behavior).

// Retry transient failures (rate limits, overloaded servers) with a short
// backoff; each attempt capped at 60s so a hung connection can't spin forever.
async function fetchWithRetry(url, options, tries = 3) {
  let res;
  for (let i = 0; i < tries; i++) {
    try {
      res = await fetch(url, { ...options, signal: AbortSignal.timeout(60000) });
    } catch (e) {
      if (e.name === "TimeoutError" || e.name === "AbortError") {
        throw new Error("request timed out after 60s — check your internet connection.");
      }
      throw e;
    }
    if (res.ok || ![429, 500, 502, 503, 504].includes(res.status)) return res;
    if (i < tries - 1) await new Promise((r) => setTimeout(r, 2000 * (i + 1)));
  }
  return res;
}

// OpenAI Whisper /translations -> English (auto-detects 55+ spoken languages)
async function whisper(buffer, cfg) {
  if (!cfg.openaiApiKey) throw new Error("Set your OpenAI API key in Settings.");
  const form = new FormData();
  form.append("file", new Blob([buffer], { type: "audio/wav" }), "audio.wav");
  form.append("model", "whisper-1");
  const res = await fetchWithRetry("https://api.openai.com/v1/audio/translations", {
    method: "POST",
    headers: { Authorization: `Bearer ${cfg.openaiApiKey}` },
    body: form,
  });
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${await res.text()}`);
  const json = await res.json();
  return (json.text || "").trim();
}

// Sarvam's instant endpoint rejects audio over 30s — split long recordings
// into 29s chunks (cut at the quietest pause), then join the English output.
async function sarvamLong(buffer, cfg) {
  const parts = wavChunks(buffer, 29);
  const out = [];
  for (const part of parts) out.push(await sarvam(part, cfg));
  return out.filter(Boolean).join(" ").trim();
}

async function sarvam(buffer, cfg) {
  if (!cfg.sarvamApiKey) throw new Error("Set your Sarvam API key in Settings.");
  const form = new FormData();
  form.append("file", new Blob([buffer], { type: "audio/wav" }), "audio.wav");
  form.append("model", "saaras:v2.5");
  const res = await fetchWithRetry("https://api.sarvam.ai/speech-to-text-translate", {
    method: "POST",
    headers: { "api-subscription-key": cfg.sarvamApiKey },
    body: form,
  });
  if (!res.ok) throw new Error(`Sarvam ${res.status}: ${await res.text()}`);
  const json = await res.json();
  return (json.transcript || json.text || "").trim();
}

// Google Gemini: audio in -> English out in ONE call (auto language
// detection; polishes too when rewrite is on). No 30s limit.
async function gemini(buffer, cfg) {
  if (!cfg.geminiApiKey) throw new Error("Set your Gemini API key in Settings.");
  const model = cfg.geminiModel || "gemini-3.5-flash";
  const instruction = cfg.rewrite
    ? "Listen to this audio. The speaker may use any language, or mix " +
      "languages mid-sentence. Translate what they said into clear, " +
      "polished English: fix grammar, remove filler words, and join broken " +
      "fragments, while preserving the meaning, tone, and all technical " +
      "terms. Output ONLY the final English text — no comments, no quotes."
    : "Listen to this audio. The speaker may use any language, or mix " +
      "languages mid-sentence. Transcribe what they said and translate it " +
      "faithfully into natural English, without adding or dropping " +
      "anything. Output ONLY the English text — no comments, no quotes.";

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  const payload = {
    contents: [
      {
        parts: [
          { inline_data: { mime_type: "audio/wav", data: buffer.toString("base64") } },
          { text: instruction },
        ],
      },
    ],
    // Reasoning models (3.8-flash and newer) can spend the whole reply on
    // internal "thinking" and return empty text; turn thinking off.
    generationConfig: { thinkingConfig: { thinkingBudget: 0 } },
  };
  const opts = (body) => ({
    method: "POST",
    headers: { "x-goog-api-key": cfg.geminiApiKey, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  let res = await fetchWithRetry(url, opts(payload));
  if (res.status === 400) {
    // Older models reject thinkingConfig — retry once without it.
    delete payload.generationConfig;
    res = await fetchWithRetry(url, opts(payload));
  }
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${await res.text()}`);
  const json = await res.json();
  const parts = json.candidates?.[0]?.content?.parts || [];
  const text = parts.map((p) => p.text || "").join("").trim();
  if (!text) {
    const reason =
      json.candidates?.[0]?.finishReason ||
      json.promptFeedback?.blockReason ||
      "empty reply";
    throw new Error(
      `Gemini sent no text back (${reason}). Try again, or set model gemini-3.5-flash in Settings.`
    );
  }
  return text;
}

// Polish text with a small LLM pass (for whisper/sarvam providers).
async function rewrite(text, cfg) {
  const system =
    "You clean up dictated speech-to-text output. Rewrite the user's text " +
    "into clear, natural English: fix grammar and punctuation, remove filler " +
    "words, and smoothly join broken sentence fragments. Preserve the " +
    "meaning, tone, and all technical terms. Return ONLY the rewritten text " +
    "with no comments or quotes.";
  const pref = cfg.rewriteProvider || "auto";

  if ((pref === "auto" || pref === "openai") && cfg.openaiApiKey) {
    const res = await fetchWithRetry("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${cfg.openaiApiKey}`,
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
    return (json.choices?.[0]?.message?.content || "").trim() || text;
  }

  if ((pref === "auto" || pref === "sarvam") && cfg.sarvamApiKey) {
    const res = await fetchWithRetry("https://api.sarvam.ai/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${cfg.sarvamApiKey}`,
        "api-subscription-key": cfg.sarvamApiKey,
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
    return (json.choices?.[0]?.message?.content || "").trim() || text;
  }

  if ((pref === "auto" || pref === "gemini") && cfg.geminiApiKey) {
    const model = cfg.geminiModel || "gemini-3.5-flash";
    const res = await fetchWithRetry(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      {
        method: "POST",
        headers: { "x-goog-api-key": cfg.geminiApiKey, "Content-Type": "application/json" },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: system }] },
          contents: [{ parts: [{ text: text }] }],
        }),
      }
    );
    if (!res.ok) throw new Error(`Gemini ${res.status}`);
    const json = await res.json();
    const parts = json.candidates?.[0]?.content?.parts || [];
    return parts.map((p) => p.text || "").join("").trim() || text;
  }

  return text;
}

// ---- WAV helpers (16kHz mono 16-bit) ----
function findDataChunk(buffer) {
  if (buffer.length < 44 || buffer.toString("ascii", 0, 4) !== "RIFF") return null;
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

function wavChunks(buffer, maxSec) {
  const data = findDataChunk(buffer);
  const bytesPerSec = 16000 * 2;
  const maxBytes = maxSec * bytesPerSec;
  if (!data || data.size <= maxBytes) return [buffer];
  const chunks = [];
  let pos = 0;
  while (data.size - pos > maxBytes) {
    const cut = quietestCut(buffer, data.offset + pos, maxBytes, bytesPerSec);
    chunks.push(makeWav(buffer.subarray(data.offset + pos, data.offset + pos + cut)));
    pos += cut;
  }
  chunks.push(makeWav(buffer.subarray(data.offset + pos, data.offset + data.size)));
  return chunks;
}

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

// Main entry: WAV buffer + settings -> final English text.
async function transcribe(buffer, cfg) {
  let text;
  if (cfg.provider === "sarvam") text = await sarvamLong(buffer, cfg);
  else if (cfg.provider === "whisper") text = await whisper(buffer, cfg);
  else text = await gemini(buffer, cfg);

  if (text && cfg.rewrite && cfg.provider !== "gemini") {
    try {
      text = await rewrite(text, cfg);
    } catch (_) {
      // fall back to the raw transcription
    }
  }
  return text;
}

module.exports = { transcribe, makeWav };
