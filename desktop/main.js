const { app, BrowserWindow, dialog } = require('electron');
const { spawn, fork } = require('child_process');
const path = require('path');
const fs = require('fs');
const http = require('http');
const net = require('net');

let mainWindow = null;
let backendProcess = null;
let frontendServer = null;

const BACKEND_PORT = 8000;
const FRONTEND_PORT = 3000;

// ── Startup logging ──────────────────────────────────────────────────────
// When the app is launched from Finder there is no console attached, so a
// failed startup previously left nothing to diagnose. Mirror console output
// to a log file next to the app's data.
let logStream = null;
function initLogging() {
  try {
    const logPath = path.join(app.getPath('userData'), 'omnia-startup.log');
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    logStream = fs.createWriteStream(logPath, { flags: 'a' });
    const stamp = () => new Date().toISOString();
    for (const level of ['log', 'error', 'warn']) {
      const original = console[level].bind(console);
      console[level] = (...args) => {
        original(...args);
        try {
          logStream.write(`${stamp()} [${level}] ${args.join(' ')}\n`);
        } catch { /* logging must never break startup */ }
      };
    }
    console.log(`--- Omnia starting (v${app.getVersion()}, path=${app.getAppPath()}) ---`);
  } catch { /* non-fatal */ }
}

// ── Window sizing ────────────────────────────────────────────────────────
// The setup wizard (/, /login, /install) is a small fixed-size dialog, like a
// real installer. The main app (/dashboard, /admin) is the full resizable window.
const WIZARD_SIZE = { width: 780, height: 860 };
const APP_SIZE = { width: 1400, height: 900, minWidth: 1024, minHeight: 700 };

function isWizardRoute(pathname) {
  return pathname === '/' || pathname === '/login' || pathname === '/install';
}

function applyWindowModeForURL(url) {
  if (!mainWindow) return;
  let pathname = '/';
  try { pathname = new URL(url).pathname; } catch {}

  if (isWizardRoute(pathname)) {
    mainWindow.setResizable(false);
    mainWindow.setMinimumSize(WIZARD_SIZE.width, WIZARD_SIZE.height);
    mainWindow.setMaximumSize(WIZARD_SIZE.width, WIZARD_SIZE.height);
    mainWindow.setSize(WIZARD_SIZE.width, WIZARD_SIZE.height);
    mainWindow.center();
  } else {
    mainWindow.setMaximumSize(0, 0);
    mainWindow.setMinimumSize(APP_SIZE.minWidth, APP_SIZE.minHeight);
    mainWindow.setResizable(true);
    mainWindow.setSize(APP_SIZE.width, APP_SIZE.height);
    mainWindow.center();
  }
}

// ── Port conflict detection ─────────────────────────────────────────────
function isPortInUse(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(true));
    server.once('listening', () => { server.close(); resolve(false); });
    server.listen(port, '127.0.0.1');
  });
}

// ── Path resolution ─────────────────────────────────────────────────────
function getBackendPath() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'backend');
  }
  return path.join(__dirname, '..', 'backend', 'main.py');
}

function getFrontendServerPath() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'frontend', 'server.js');
  }
  return path.join(__dirname, '..', '.next', 'standalone', 'server.js');
}

function getModelPath(backendExePath) {
  // Model is bundled inside PyInstaller binary via --add-data
  return path.join(path.dirname(backendExePath), 'aria_model_dicom.pth');
}

// ── Service management ──────────────────────────────────────────────────
function startBackend() {
  const backendPath = getBackendPath();
  console.log('[Omnia] Starting backend:', backendPath);
  if (!fs.existsSync(backendPath)) {
    console.error('[Omnia] Backend not found at:', backendPath);
    dialog.showErrorBox('Backend Error', 'Backend component not found. Please reinstall Omnia Pathology AI.');
    return;
  }
  const dataDir = app.getPath('userData');
  fs.mkdirSync(dataDir, { recursive: true });

  backendProcess = spawn(backendPath, [], {
    cwd: path.dirname(backendPath),
    stdio: ['pipe', 'pipe', 'pipe'],
    env: {
      ...process.env,
      PYTHONUNBUFFERED: '1',
      OMNIA_MODEL_PATH: getModelPath(backendPath),
      OMNIA_DATA_DIR: dataDir,
    },
  });
  backendProcess.stdout.on('data', (d) => console.log(`[Backend] ${d.toString().trim()}`));
  backendProcess.stderr.on('data', (d) => console.error(`[Backend] ${d.toString().trim()}`));
  backendProcess.on('exit', (code) => {
    console.log(`[Backend] Exited with code ${code}`);
    backendProcess = null;
  });
}

function startFrontendServer() {
  const serverPath = getFrontendServerPath();
  if (!fs.existsSync(serverPath)) {
    console.error('[Omnia] Frontend server not found at:', serverPath);
    return;
  }

  const frontendDir = path.dirname(serverPath);
  const modulesPath = path.join(frontendDir, 'node_modules');
  const modulesBak = path.join(frontendDir, '_modules');

  const env = { ...process.env, PORT: String(FRONTEND_PORT), HOSTNAME: '127.0.0.1' };

  // electron-builder strips node_modules; use _modules as NODE_PATH fallback
  if (!fs.existsSync(modulesPath)) {
    if (fs.existsSync(modulesBak)) {
      env.NODE_PATH = modulesBak;
      console.log('[Omnia] Frontend using _modules for node dependencies');
    } else {
      console.error('[Omnia] No node_modules or _modules found in:', frontendDir);
    }
  }

  frontendServer = fork(serverPath, [], {
    cwd: frontendDir,
    stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
    env,
  });
  frontendServer.stdout.on('data', (d) => console.log(`[Frontend] ${d.toString().trim()}`));
  frontendServer.stderr.on('data', (d) => console.error(`[Frontend] ${d.toString().trim()}`));
  frontendServer.on('exit', (code) => {
    console.log(`[Frontend] Exited with code ${code}`);
    frontendServer = null;
  });
}

// ── Health checks ──────────────────────────────────────────────────────
function waitForService(name, url, statusCheck, maxRetries, interval) {
  return new Promise((resolve) => {
    let retries = 0;
    const check = () => {
      const req = http.get(url, (res) => {
        if (statusCheck(res.statusCode)) {
          console.log(`[Omnia] ${name} ready`);
          resolve(true);
        } else {
          retry();
        }
      });
      req.on('error', () => retry());
      req.setTimeout(interval, () => { req.destroy(); retry(); });
    };
    const retry = () => {
      if (++retries >= maxRetries) {
        console.error(`[Omnia] ${name} failed to start after ${maxRetries * interval / 1000}s`);
        resolve(false);
      } else {
        setTimeout(check, interval);
      }
    };
    check();
  });
}

function waitForBackend() {
  return waitForService(
    'Backend',
    `http://127.0.0.1:${BACKEND_PORT}/health`,
    (code) => code === 200,
    60,
    2000,
  );
}

function waitForFrontend() {
  return waitForService(
    'Frontend',
    `http://127.0.0.1:${FRONTEND_PORT}/login`,
    (code) => code >= 200 && code < 400,
    30,
    2000,
  );
}

// ── Window management ──────────────────────────────────────────────────
function createWindow() {
  mainWindow = new BrowserWindow({
    width: WIZARD_SIZE.width,
    height: WIZARD_SIZE.height,
    minWidth: WIZARD_SIZE.width,
    minHeight: WIZARD_SIZE.height,
    resizable: false,
    center: true,
    title: 'Omnia Pathology AI',
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
    icon: path.join(__dirname, 'icon.png'),
    show: false,
  });
  mainWindow.loadURL(`http://127.0.0.1:${FRONTEND_PORT}/login`);
  mainWindow.webContents.on('did-navigate', (_e, url) => applyWindowModeForURL(url));
  mainWindow.webContents.on('did-navigate-in-page', (_e, url) => applyWindowModeForURL(url));
  mainWindow.once('ready-to-show', () => mainWindow.show());
  // Show window after 15s even if page hasn't loaded (loading indicator)
  setTimeout(() => {
    if (mainWindow && !mainWindow.isVisible()) {
      mainWindow.show();
      console.log('[Omnia] Window shown (timeout fallback)');
    }
  }, 15000);
  mainWindow.on('closed', () => { mainWindow = null; });
}

// ── App lifecycle ──────────────────────────────────────────────────────

/** Running straight from the mounted .dmg leaves the app on a read-only volume,
 * where the bundled backend cannot be started. That failed silently and showed
 * up only as "Backend Offline", so detect it and say what to actually do. */
function isRunningFromDiskImage() {
  return app.isPackaged && app.getAppPath().startsWith('/Volumes/');
}

app.whenReady().then(async () => {
  initLogging();

  if (isRunningFromDiskImage()) {
    dialog.showErrorBox(
      'Please Install Omnia Pathology AI First',
      'Omnia Pathology AI is running directly from the installer disk image, ' +
      'which is read-only — the analysis engine cannot start there.\n\n' +
      'Drag "Omnia Pathology AI" into your Applications folder, eject the ' +
      'installer, and open it from Applications.',
    );
    app.quit();
    return;
  }

  const backendBusy = await isPortInUse(BACKEND_PORT);
  const frontendBusy = await isPortInUse(FRONTEND_PORT);

  if (backendBusy || frontendBusy) {
    const ports = [];
    if (backendBusy) ports.push(`port ${BACKEND_PORT} (backend)`);
    if (frontendBusy) ports.push(`port ${FRONTEND_PORT} (frontend)`);
    dialog.showErrorBox(
      'Port Conflict',
      `Another application is using ${ports.join(' and ')}.\n\nPlease close other applications and restart Omnia Pathology AI.`,
    );
    app.quit();
    return;
  }

  startBackend();
  startFrontendServer();

  const [backendOk, frontendOk] = await Promise.all([waitForBackend(), waitForFrontend()]);

  if (!backendOk || !frontendOk) {
    const issues = [];
    if (!backendOk) issues.push('Backend failed to start');
    if (!frontendOk) issues.push('Frontend failed to start');
    dialog.showErrorBox(
      'Startup Error',
      `${issues.join(' and ')}.\n\nCheck logs and restart Omnia Pathology AI.`,
    );
    app.quit();
    return;
  }

  createWindow();
});

app.on('window-all-closed', () => {
  if (frontendServer) frontendServer.kill();
  if (backendProcess) backendProcess.kill();
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (!mainWindow) createWindow();
});
