// Tiny JSON settings store in the app's user-data folder.
const fs = require("fs");
const path = require("path");
const { app } = require("electron");

const DEFAULTS = {
  provider: "gemini",
  geminiApiKey: "",
  openaiApiKey: "",
  sarvamApiKey: "",
  geminiModel: "gemini-3.5-flash",
  rewrite: false,
  rewriteProvider: "auto",
  shortcut: "CommandOrControl+Alt+M",
};

function file() {
  return path.join(app.getPath("userData"), "settings.json");
}

function load() {
  try {
    return { ...DEFAULTS, ...JSON.parse(fs.readFileSync(file(), "utf8")) };
  } catch (_) {
    return { ...DEFAULTS };
  }
}

function save(settings) {
  fs.mkdirSync(path.dirname(file()), { recursive: true });
  fs.writeFileSync(file(), JSON.stringify(settings, null, 2));
}

module.exports = { load, save, DEFAULTS };
