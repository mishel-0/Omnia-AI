const { app, BrowserWindow, dialog } = require('electron');
const { spawn, fork, execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const http = require('http');
const net = require('net');

let mainWindow = null;
let backendProcess = null;
let frontendServer = null;

// Preferred ports, not fixed ones. 3000 in particular is the default for most
// Node development servers, so on a machine that does any web work at all it is
// frequently taken — and the previous behaviour was a dialog telling the user
// to close whatever held it, which on a managed hospital workstation is not
// something they can act on. These are now the starting point of a search.
const PREFERRED_BACKEND_PORT = 8000;
const PREFERRED_FRONTEND_PORT = 3000;
const PORT_SEARCH_RANGE = 40;

// Resolved at startup and used everywhere after. Both services bind to
// loopback, so a non-default port changes nothing a user can see.
let backendPort = PREFERRED_BACKEND_PORT;
let frontendPort = PREFERRED_FRONTEND_PORT;

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

/** The first free port at or above `preferred`, or null if none in range. */
async function findFreePort(preferred, taken = []) {
  for (let port = preferred; port < preferred + PORT_SEARCH_RANGE; port++) {
    if (taken.includes(port)) continue;
    if (!(await isPortInUse(port))) return port;
  }
  return null;
}

// ── Path resolution ─────────────────────────────────────────────────────
function getBackendPath() {
  if (app.isPackaged) {
    // The backend is a PyInstaller onedir bundle: a directory named `backend`
    // holding the executable and an `_internal` folder of libraries. It used
    // to be a single file copied to Resources/backend, which is why this once
    // pointed straight at that path.
    //
    // The executable keeps PyInstaller's own name inside the directory, and
    // only Windows carries an extension — asking for the extensionless name
    // there found nothing and reported "Backend component not found" on every
    // launch, which is the bug this comment previously described.
    const exe = process.platform === 'win32' ? 'omnia-backend.exe' : 'omnia-backend';
    return path.join(process.resourcesPath, 'backend', exe);
  }
  return path.join(__dirname, '..', 'backend', 'main.py');
}

function getFrontendServerPath() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'frontend', 'server.js');
  }
  return path.join(__dirname, '..', '.next', 'standalone', 'server.js');
}

// getModelPath() used to live here and set OMNIA_MODEL_PATH to
// `aria_model_dicom.pth` — a checkpoint from the retired DICOM product that
// has not existed since this became a pathology tool. It was harmless only
// because the backend never read the variable: grading_model.py resolves its
// checkpoint from sys._MEIPASS. Both halves are gone rather than left to
// mislead the next reader.

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
    // Own process group, so shutdown can signal the PyInstaller bootstrap
    // parent *and* the real server it re-executes. See killTree().
    detached: process.platform !== 'win32',
    env: {
      ...process.env,
      PYTHONUNBUFFERED: '1',
      OMNIA_DATA_DIR: dataDir,
      PORT: String(backendPort),
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

  const env = { ...process.env, PORT: String(frontendPort), HOSTNAME: '127.0.0.1' };

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
    detached: process.platform !== 'win32',
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
    `http://127.0.0.1:${backendPort}/health`,
    (code) => code === 200,
    60,
    2000,
  );
}

function waitForFrontend() {
  return waitForService(
    'Frontend',
    `http://127.0.0.1:${frontendPort}/login`,
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
      // The page's API base is compiled in at build time and therefore always
      // says 8000. When the search lands the backend somewhere else, this is
      // how the renderer finds out — read by preload before any page script.
      additionalArguments: [`--omnia-api-base=http://127.0.0.1:${backendPort}`],
    },
    icon: path.join(__dirname, 'icon.png'),
    show: false,
  });
  mainWindow.loadURL(`http://127.0.0.1:${frontendPort}/login`);
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

/** Reclaim ports held by servers *this app* leaked on a previous run.
 *
 * The startup guard treats any busy port as a third-party conflict and
 * quits with "close other applications" — advice the user cannot act on
 * when the process holding the port is Omnia's own orphaned backend or
 * frontend.
 *
 * Ownership is established by PID, recorded when we spawn the children,
 * not by matching the process name. Name matching was actively dangerous:
 * the pattern included `node`, and port 3000 is the default for most local
 * development servers, so launching Omnia would SIGKILL an unrelated
 * Next/React/Rails process — someone else's unsaved work — with no prompt
 * and no visible message. A PID we wrote down ourselves is the only thing
 * that actually proves the process is ours. */
const PID_FILE = path.join(app.getPath('userData'), 'child-pids.json');

function recordChildPids() {
  try {
    const pids = {
      backend: backendProcess ? backendProcess.pid : null,
      frontend: frontendServer ? frontendServer.pid : null,
      recorded: Date.now(),
    };
    fs.mkdirSync(path.dirname(PID_FILE), { recursive: true });
    fs.writeFileSync(PID_FILE, JSON.stringify(pids));
  } catch (e) {
    console.error('[Omnia] Could not record child PIDs:', e.message);
  }
}

function readRecordedPids() {
  try {
    const raw = JSON.parse(fs.readFileSync(PID_FILE, 'utf8'));
    return [raw.backend, raw.frontend].filter((p) => Number.isInteger(p) && p > 0);
  } catch { return []; }   // no previous run, or the file is unreadable
}

async function reclaimOwnPorts() {
  let reclaimed = false;
  for (const pid of readRecordedPids()) {
    if (pid === process.pid) continue;
    try {
      process.kill(pid, 0);           // still alive? throws if not
    } catch { continue; }             // already gone — nothing to reclaim
    try {
      process.kill(pid, 'SIGKILL');
      console.log(`[Omnia] Stopped leftover child process ${pid} from a previous run`);
      reclaimed = true;
    } catch (e) {
      console.error(`[Omnia] Could not stop leftover process ${pid}: ${e.message}`);
    }
  }
  try { fs.unlinkSync(PID_FILE); } catch { /* nothing to clear */ }
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

  // Move aside rather than refuse. Both services are loopback-only, so which
  // port they end up on is an implementation detail — where it used to be a
  // reason the application would not open at all.
  const foundBackend = await findFreePort(PREFERRED_BACKEND_PORT);
  const foundFrontend = await findFreePort(PREFERRED_FRONTEND_PORT, [foundBackend]);

  if (foundBackend === null || foundFrontend === null) {
    await dialog.showMessageBox({
      type: 'error',
      title: 'No free port',
      message: 'Omnia Pathology AI could not find a free port on this computer.',
      detail: `Every port between ${PREFERRED_BACKEND_PORT} and `
        + `${PREFERRED_BACKEND_PORT + PORT_SEARCH_RANGE}, and between `
        + `${PREFERRED_FRONTEND_PORT} and ${PREFERRED_FRONTEND_PORT + PORT_SEARCH_RANGE}, `
        + 'is in use. This is unusual — restarting the computer normally clears it.',
      buttons: ['Quit'],
    });
    app.quit();
    return;
  }

  backendPort = foundBackend;
  frontendPort = foundFrontend;
  if (backendPort !== PREFERRED_BACKEND_PORT || frontendPort !== PREFERRED_FRONTEND_PORT) {
    console.log(`[Omnia] Preferred ports were taken; using backend ${backendPort}, `
              + `frontend ${frontendPort}`);
  }

  startBackend();
  startFrontendServer();
  // Written before the health checks, not after: if startup fails or the
  // user force-quits during it, these are exactly the processes the next
  // launch needs to be able to identify as ours and reclaim.
  recordChildPids();

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

/** Kill one child and everything it spawned.
 *
 * The bundled backend is a PyInstaller onefile binary: a bootstrap parent
 * that re-executes the real server as a child. Signalling only the parent
 * leaves the server alive and still holding port 8000, which is the leak
 * that makes the *next* launch fail. Children are spawned detached so they
 * lead their own process group, and a negative PID signals the whole group.
 * Windows has no process groups, so taskkill /T does the same job there. */
function killTree(pid, signal) {
  if (!pid) return;
  if (process.platform === 'win32') {
    try {
      execFileSync('taskkill', ['/pid', String(pid), '/T', '/F'], { timeout: 4000 });
    } catch { /* already gone, or taskkill unavailable */ }
    return;
  }
  try { process.kill(-pid, signal); }     // whole group
  catch {
    try { process.kill(pid, signal); }    // fall back to the bare process
    catch { /* already gone */ }
  }
}

function isAlive(pid) {
  if (!pid) return false;
  try { process.kill(pid, 0); return true; } catch { return false; }
}

/** Stop both children, and do not return until they are actually dead.
 *
 * The previous version scheduled the SIGKILL escalation with setTimeout, so
 * it never ran: Electron tears the process down on quit without waiting for
 * pending timers, and `process.on('exit')` cannot await anything either. The
 * escalation this function exists for was dead code, and the leaked servers
 * it was written to prevent kept happening. The wait is synchronous for that
 * reason — a spin here costs at most SIGKILL_AFTER_MS on quit, and buys a
 * launch that is not blocked by our own orphans. */
const SIGKILL_AFTER_MS = 2000;

function stopServers() {
  if (shuttingDown) return;
  shuttingDown = true;

  const pids = [
    ['frontend', frontendServer && frontendServer.pid],
    ['backend', backendProcess && backendProcess.pid],
  ].filter(([, pid]) => pid);

  for (const [, pid] of pids) killTree(pid, 'SIGTERM');

  // Give them a moment to exit cleanly, then insist. Atomics.wait blocks
  // this thread without spawning anything or burning CPU — the one way to
  // sleep synchronously in Node, which is what quit-time requires.
  const deadline = Date.now() + SIGKILL_AFTER_MS;
  const idle = new Int32Array(new SharedArrayBuffer(4));
  while (Date.now() < deadline && pids.some(([, pid]) => isAlive(pid))) {
    Atomics.wait(idle, 0, 0, 100);
  }
  for (const [name, pid] of pids) {
    if (isAlive(pid)) {
      console.log(`[Omnia] ${name} (${pid}) ignored SIGTERM — forcing.`);
      killTree(pid, 'SIGKILL');
    }
  }

  try { fs.unlinkSync(PID_FILE); } catch { /* nothing recorded */ }
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
