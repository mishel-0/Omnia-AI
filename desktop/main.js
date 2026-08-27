const { app, BrowserWindow, dialog } = require('electron');
const { spawn, fork, execFileSync } = require('child_process');
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
    // Once the service answers, the loop must stop. Without this flag a
    // request already in flight (or a pending retry timer) kept firing after
    // resolve(), so the startup log showed "Backend ready" immediately
    // followed by "Backend failed to start after 120s" for a backend that
    // was in fact running — and the timer chain outlived the check.
    let settled = false;
    let timer = null;

    const finish = (ok) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      if (ok) console.log(`[Omnia] ${name} ready`);
      else console.error(`[Omnia] ${name} failed to start after ${(maxRetries * interval) / 1000}s`);
      resolve(ok);
    };

    const retry = () => {
      if (settled) return;
      if (++retries >= maxRetries) finish(false);
      else timer = setTimeout(check, interval);
    };

    const check = () => {
      if (settled) return;
      const req = http.get(url, (res) => {
        res.resume();  // drain, otherwise the socket is held open
        if (statusCheck(res.statusCode)) finish(true);
        else retry();
      });
      req.on('error', () => retry());
      req.setTimeout(interval, () => { req.destroy(); retry(); });
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

/** Reclaim ports held by servers this app leaked on a previous run.
 *
 * The startup guard treats any busy port as a third-party conflict and
 * quits with "close other applications" — advice the user cannot act on
 * when the process holding the port is Omnia's own orphaned backend or
 * frontend. Identify the owner and, if it is ours, stop it. Anything we
 * do not recognise is left alone and reported honestly. */
function portOwners(port) {
  try {
    const out = execFileSync('/usr/sbin/lsof',
      ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-F', 'pc'],
      { encoding: 'utf8', timeout: 4000 });
    const owners = [];
    let pid = null;
    for (const line of out.split('\n')) {
      if (line.startsWith('p')) pid = parseInt(line.slice(1), 10);
      else if (line.startsWith('c') && pid) owners.push({ pid, command: line.slice(1) });
    }
    return owners;
  } catch { return []; }   // lsof missing or nothing listening
}

async function reclaimOwnPorts() {
  const OURS = /omnia|next-server|node/i;
  let reclaimed = false;
  for (const port of [BACKEND_PORT, FRONTEND_PORT]) {
    for (const { pid, command } of portOwners(port)) {
      if (pid === process.pid || !OURS.test(command)) continue;
      try {
        process.kill(pid, 'SIGKILL');
        console.log(`[Omnia] Reclaimed port ${port} from leftover process ${pid} (${command})`);
        reclaimed = true;
      } catch (e) {
        console.error(`[Omnia] Could not stop process ${pid} on port ${port}: ${e.message}`);
      }
    }
  }
  if (reclaimed) await new Promise((r) => setTimeout(r, 800));  // let the sockets close
}

async function startApp() {
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

  // A port is most often held by a previous instance of THIS app whose
  // servers outlived it, not by unrelated software. Telling the user to
  // "close other applications" in that case is a dead end they cannot act
  // on, so reclaim our own leftovers first and only report a genuine
  // third-party conflict.
  await reclaimOwnPorts();

  const backendBusy = await isPortInUse(BACKEND_PORT);
  const frontendBusy = await isPortInUse(FRONTEND_PORT);

  if (backendBusy || frontendBusy) {
    const ports = [];
    if (backendBusy) ports.push(`port ${BACKEND_PORT} (backend)`);
    if (frontendBusy) ports.push(`port ${FRONTEND_PORT} (frontend)`);
    const { response } = await dialog.showMessageBox({
      type: 'warning',
      title: 'Port In Use',
      message: `Another application is using ${ports.join(' and ')}.`,
      detail: 'Omnia Pathology AI needs these ports for its local engine. Close the other application, then choose Try Again.',
      buttons: ['Try Again', 'Quit'],
      defaultId: 0,
      cancelId: 1,
    });
    if (response === 0) { startApp(); return; }   // let the user recover
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
}

app.whenReady().then(() => {
  initLogging();
  startApp();
});

/** Stop the backend and frontend children.
 *
 * SIGTERM first, then SIGKILL for anything still alive. The bundled backend
 * is a PyInstaller onefile binary: it runs a bootstrap parent that spawns
 * the real server as a child, so a plain SIGTERM to the parent can leave
 * the server holding its port. Leaked servers are not harmless — the next
 * launch finds ports 3000/8000 occupied and refuses to start. */
let shuttingDown = false;
function stopServers() {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const [name, proc] of [['frontend', frontendServer], ['backend', backendProcess]]) {
    if (!proc || proc.killed) continue;
    try {
      proc.kill('SIGTERM');
      const pid = proc.pid;
      setTimeout(() => {
        try { process.kill(pid, 0); process.kill(pid, 'SIGKILL'); } catch { /* already gone */ }
      }, 2000);
    } catch (e) {
      console.error(`[Omnia] Failed to stop ${name}:`, e.message);
    }
  }
  frontendServer = null;
  backendProcess = null;
}

app.on('window-all-closed', () => {
  // On macOS an app normally stays resident with no windows, and clicking
  // the dock icon reopens one. Killing the servers here would leave that
  // reopened window pointing at a backend that is gone, so let the servers
  // run and rely on 'before-quit' for the real teardown.
  if (process.platform !== 'darwin') {
    stopServers();
    app.quit();
  }
});

// The teardown that actually matters: without it, quitting left the backend
// and frontend running and holding their ports.
app.on('before-quit', stopServers);
process.on('exit', stopServers);
process.on('SIGINT', () => { stopServers(); process.exit(0); });
process.on('SIGTERM', () => { stopServers(); process.exit(0); });

app.on('activate', () => {
  if (!mainWindow) createWindow();
});
