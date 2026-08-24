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
  screen,
} = require("electron");
const cp = require("child_process");
const path = require("path");
const store = require("./store");
const { transcribe, makeWav } = require("./transcribe");

// Hardcoded maximum recording length in seconds; null = unlimited.
// The "Maiboli 5min" edition sets this to 300.
const MAX_RECORD_SECONDS = 300;

let settings = null;
let tray = null;
let recorderWin = null;
let settingsWin = null;
let floatWin = null;
let recording = false;
let busy = false;
let recTimer = null;

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
  if (tray) {
    tray.setImage(trayIcon());
    tray.setToolTip(
      recording
        ? "Maiboli — recording… (click or shortcut to stop)"
        : `Maiboli — click or ${prettyShortcut()} to dictate`
    );
  }
  if (floatWin) {
    floatWin.webContents.send(
      "state",
      busy ? "busy" : recording ? "rec" : "idle"
    );
  }
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

function stopRecording() {
  if (!recording) return;
  if (recTimer) {
    clearTimeout(recTimer);
    recTimer = null;
  }
  recording = false;
  updateTray();
  recorderWin.webContents.send("rec-stop");
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
    stopRecording();
  }
}

ipcMain.on("rec-started", () => {
  recording = true;
  updateTray();
  if (MAX_RECORD_SECONDS) {
    recTimer = setTimeout(() => {
      if (recording) {
        notify(
          `Reached the ${Math.round(MAX_RECORD_SECONDS / 60)}-minute recording limit — transcribing…`
        );
        stopRecording();
      }
    }, MAX_RECORD_SECONDS * 1000);
  }
});

ipcMain.on("rec-error", (_e, msg) => {
  if (recTimer) {
    clearTimeout(recTimer);
    recTimer = null;
  }
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

// ---- Floating mic button (drag anywhere, click to dictate) ----
let dragTimer = null;
let dragOffset = null;
let dragStartPt = null;

function defaultFloatPos() {
  const area = screen.getPrimaryDisplay().workArea;
  return { x: area.x + area.width - 76, y: area.y + area.height - 130 };
}

// A remembered position can be outside every screen after a monitor is
// unplugged or the resolution changes — pull the bubble back if so.
function clampFloatPos(pos) {
  if (!pos) return defaultFloatPos();
  const SIZE = 56, MARGIN = 10;
  const visible = screen.getAllDisplays().some((d) => {
    const a = d.workArea;
    return (
      pos.x + SIZE - MARGIN >= a.x &&
      pos.x + MARGIN <= a.x + a.width &&
      pos.y + SIZE - MARGIN >= a.y &&
      pos.y + MARGIN <= a.y + a.height
    );
  });
  return visible ? pos : defaultFloatPos();
}

function createFloatWindow() {
  if (floatWin) return;
  const pos = clampFloatPos(settings.floatPos);
  floatWin = new BrowserWindow({
    width: 56,
    height: 56,
    x: Math.round(pos.x),
    y: Math.round(pos.y),
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    focusable: false,
    fullscreenable: false,
    webPreferences: { nodeIntegration: true, contextIsolation: false },
  });
  floatWin.setAlwaysOnTop(true, "screen-saver");
  if (process.platform === "darwin") {
    floatWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  }
  floatWin.loadFile("floater.html");
  floatWin.on("closed", () => (floatWin = null));
}

function destroyFloatWindow() {
  if (floatWin) floatWin.close();
  floatWin = null;
}

function resetFloatPos() {
  settings.floatPos = null;
  store.save(settings);
  const pos = defaultFloatPos();
  if (floatWin) {
    floatWin.setPosition(pos.x, pos.y);
    floatWin.show();
  } else if (settings.floatEnabled !== false) {
    createFloatWindow();
  }
}

// If screens change (monitor unplugged, resolution switch), make sure the
// bubble is still somewhere visible.
function ensureFloatVisible() {
  if (!floatWin) return;
  const [x, y] = floatWin.getPosition();
  const pos = clampFloatPos({ x, y });
  if (pos.x !== x || pos.y !== y) floatWin.setPosition(pos.x, pos.y);
}

ipcMain.on("float-down", (_e, offset) => {
  dragOffset = offset;
  dragStartPt = screen.getCursorScreenPoint();
  clearInterval(dragTimer);
  dragTimer = setInterval(() => {
    if (!floatWin || !dragOffset) return;
    const p = screen.getCursorScreenPoint();
    floatWin.setPosition(
      Math.round(p.x - dragOffset.x),
      Math.round(p.y - dragOffset.y)
    );
  }, 16);
});

ipcMain.on("float-up", () => {
  clearInterval(dragTimer);
  dragTimer = null;
  dragOffset = null;
  if (!floatWin || !dragStartPt) return;
  const p = screen.getCursorScreenPoint();
  const travel = Math.hypot(p.x - dragStartPt.x, p.y - dragStartPt.y);
  dragStartPt = null;
  const [x, y] = floatWin.getPosition();
  settings.floatPos = { x, y };
  store.save(settings);
  if (travel < 4) toggle(); // barely moved -> it was a click
});

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
    {
      label: "Floating mic button",
      type: "checkbox",
      checked: settings.floatEnabled !== false,
      click: (item) => {
        settings.floatEnabled = item.checked;
        store.save(settings);
        if (item.checked) createFloatWindow();
        else destroyFloatWindow();
      },
    },
    { label: "Reset floating button position", click: resetFloatPos },
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
  if (settings.floatEnabled !== false) createFloatWindow();

  tray = new Tray(trayIcon());
  updateTray();
  tray.on("click", toggle);
  tray.on("right-click", () => tray.popUpContextMenu(buildMenu()));
  // macOS: left-click toggles, hold Ctrl or right-click for the menu.

  registerShortcut();

  screen.on("display-removed", ensureFloatVisible);
  screen.on("display-added", ensureFloatVisible);
  screen.on("display-metrics-changed", ensureFloatVisible);

  if (!settings.geminiApiKey && !settings.openaiApiKey && !settings.sarvamApiKey) {
    openSettings();
    notify("Welcome! Add an API key to start dictating.");
  }
});

app.on("window-all-closed", (e) => {
  // Tray app: keep running with no windows.
});

app.on("will-quit", () => globalShortcut.unregisterAll());
