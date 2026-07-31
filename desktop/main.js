const {
  app,
  Tray,
  Menu,
  BrowserWindow,
  globalShortcut,
  ipcMain,
  clipboard,
  Notification,
  nativeImage,
  systemPreferences,
} = require("electron");
const cp = require("child_process");
const path = require("path");
const store = require("./store");
const { transcribe, makeWav } = require("./transcribe");

let settings = null;
let tray = null;
let recorderWin = null;
let settingsWin = null;
let recording = false;
let busy = false;

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();

function asset(name) {
  return path.join(__dirname, "assets", name);
}

function trayIcon() {
  if (recording) return nativeImage.createFromPath(asset("tray-rec.png"));
  if (process.platform === "darwin") {
    const img = nativeImage.createFromPath(asset("trayTemplate.png"));
    img.setTemplateImage(true);
    return img;
  }
  return nativeImage.createFromPath(asset("tray-win.png"));
}

function updateTray() {
  if (!tray) return;
  tray.setImage(trayIcon());
  tray.setToolTip(
    recording
      ? "Maiboli — recording… (click or shortcut to stop)"
      : `Maiboli — click or ${prettyShortcut()} to dictate`
  );
}

function prettyShortcut() {
  const mod = process.platform === "darwin" ? "Cmd" : "Ctrl";
  return (settings.shortcut || "CommandOrControl+Alt+M").replace(
    "CommandOrControl",
    mod
  );
}

function notify(body) {
  try {
    new Notification({ title: "Maiboli", body, silent: true }).show();
  } catch (_) {}
}

// ---- Recording ----
function createRecorderWindow() {
  recorderWin = new BrowserWindow({
    show: false,
    webPreferences: { nodeIntegration: true, contextIsolation: false },
  });
  recorderWin.loadFile("recorder.html");
}

async function toggle() {
  if (busy) return;
  if (!recording) {
    if (process.platform === "darwin") {
      const ok = await systemPreferences.askForMediaAccess("microphone");
      if (!ok) {
        notify("Microphone access denied — allow Maiboli in System Settings > Privacy > Microphone.");
        return;
      }
    }
    recorderWin.webContents.send("rec-start");
  } else {
    recording = false;
    updateTray();
    recorderWin.webContents.send("rec-stop");
  }
}

ipcMain.on("rec-started", () => {
  recording = true;
  updateTray();
});

ipcMain.on("rec-error", (_e, msg) => {
  recording = false;
  busy = false;
  updateTray();
  notify("Recording failed — " + msg);
});

ipcMain.on("rec-audio", async (_e, pcmBuffer) => {
  busy = true;
  updateTray();
  try {
    const wav = makeWav(Buffer.from(pcmBuffer));
    if (wav.length < 8000) {
      notify("Recording was too short — try again.");
      return;
    }
    notify("Transcribing…");
    const text = await transcribe(wav, settings);
    if (!text) {
      notify("No speech detected.");
      return;
    }
    clipboard.writeText(text);
    const pasted = await pasteKeystroke();
    if (!pasted) {
      notify("Copied to clipboard — press " + (process.platform === "darwin" ? "Cmd" : "Ctrl") + "+V to paste.");
    }
  } catch (e) {
    notify("Error: " + (e.message || e));
  } finally {
    busy = false;
    updateTray();
  }
});

// Simulate a paste keystroke so text lands wherever the cursor is.
function pasteKeystroke() {
  return new Promise((resolve) => {
    const done = (err) => resolve(!err);
    if (process.platform === "darwin") {
      cp.execFile(
        "osascript",
        ["-e", 'tell application "System Events" to keystroke "v" using command down'],
        done
      );
    } else if (process.platform === "win32") {
      cp.execFile(
        "powershell",
        ["-NoProfile", "-Command", "(New-Object -ComObject wscript.shell).SendKeys('^v')"],
        done
      );
    } else {
      cp.execFile("xdotool", ["key", "ctrl+v"], done);
    }
  });
}

// ---- Settings window ----
function openSettings() {
  if (settingsWin) {
    settingsWin.focus();
    return;
  }
  settingsWin = new BrowserWindow({
    width: 440,
    height: 620,
    resizable: false,
    title: "Maiboli Settings",
    webPreferences: { nodeIntegration: true, contextIsolation: false },
  });
  settingsWin.setMenuBarVisibility(false);
  settingsWin.loadFile("settings.html");
  settingsWin.on("closed", () => (settingsWin = null));
}

ipcMain.handle("settings-get", () => settings);
ipcMain.handle("settings-save", (_e, next) => {
  const prevShortcut = settings.shortcut;
  settings = { ...settings, ...next };
  store.save(settings);
  if (settings.shortcut !== prevShortcut) registerShortcut();
  updateTray();
  return true;
});

// ---- Shortcut + tray ----
function registerShortcut() {
  globalShortcut.unregisterAll();
  try {
    const ok = globalShortcut.register(settings.shortcut, toggle);
    if (!ok) throw new Error("shortcut taken");
  } catch (_) {
    notify(`Could not register ${prettyShortcut()} — it may be in use by another app. Change it in Settings.`);
  }
}

function buildMenu() {
  return Menu.buildFromTemplate([
    { label: "Start / Stop dictation", click: toggle },
    { type: "separator" },
    {
      label: "AI rewrite (polish)",
      type: "checkbox",
      checked: !!settings.rewrite,
      click: (item) => {
        settings.rewrite = item.checked;
        store.save(settings);
      },
    },
    { label: "Settings…", click: openSettings },
    { type: "separator" },
    { label: `Shortcut: ${prettyShortcut()}`, enabled: false },
    { label: "Quit Maiboli", click: () => app.quit() },
  ]);
}

app.whenReady().then(() => {
  settings = store.load();
  if (process.platform === "darwin" && app.dock) app.dock.hide();
  if (process.platform === "win32") app.setAppUserModelId("app.maiboli.desktop");

  createRecorderWindow();

  tray = new Tray(trayIcon());
  updateTray();
  tray.on("click", toggle);
  tray.on("right-click", () => tray.popUpContextMenu(buildMenu()));
  // macOS: left-click toggles, hold Ctrl or right-click for the menu.

  registerShortcut();

  if (!settings.geminiApiKey && !settings.openaiApiKey && !settings.sarvamApiKey) {
    openSettings();
    notify("Welcome! Add an API key to start dictating.");
  }
});

app.on("window-all-closed", (e) => {
  // Tray app: keep running with no windows.
});

app.on("will-quit", () => globalShortcut.unregisterAll());
