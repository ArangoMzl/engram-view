// Engram View como aplicación de escritorio (Electron).
// Arranca server.mjs en un proceso aparte, en un puerto libre, y muestra el visor en su propia ventana.
// Una sola instancia: al volver a abrirla se reutiliza la ventana y se trae al monitor donde está el cursor.
import { app, BrowserWindow, Menu, screen, shell, utilityProcess, dialog } from 'electron';
import net from 'node:net';
import path from 'node:path';

const ROOT = app.getAppPath();
const ICON = path.join(ROOT, process.platform === 'win32' ? 'engram-view.ico' : 'public/engram-icon.png');
const W = 1440, H = 900;

let win = null;
let server = null;
let quitting = false;

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (win) showOnCursorDisplay(win); });
  app.whenReady().then(start);
}

function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
  });
}

async function waitUp(url, ms = 15000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try {
      const r = await fetch(`${url}/api/meta`, { signal: AbortSignal.timeout(800) });
      if (r.ok || r.status === 503) return true; // 503 = servidor vivo pero sin base de datos
    } catch {}
    await new Promise((r) => setTimeout(r, 120));
  }
  return false;
}

// coloca la ventana centrada en el monitor donde está el ratón (donde se hizo clic)
function boundsOnCursorDisplay() {
  const { workArea: a } = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const width = Math.min(W, a.width), height = Math.min(H, a.height);
  return { x: Math.round(a.x + (a.width - width) / 2), y: Math.round(a.y + (a.height - height) / 2), width, height };
}

function showOnCursorDisplay(w) {
  if (w.isMinimized()) w.restore();
  const target = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const current = screen.getDisplayMatching(w.getBounds());
  if (target.id !== current.id && !w.isMaximized() && !w.isFullScreen()) w.setBounds(boundsOnCursorDisplay());
  w.show();
  w.focus();
}

async function start() {
  Menu.setApplicationMenu(null);
  const port = await freePort();
  const url = `http://localhost:${port}`;
  if (process.env.ENGRAM_VIEW_DEBUG) console.log('[engram-view] url', url);
  const extra = process.argv.includes('--demo') ? ['--demo'] : [];

  server = utilityProcess.fork(path.join(ROOT, 'server.mjs'), ['--no-open', '--port', String(port), ...extra], {
    serviceName: 'Engram View server', stdio: 'pipe',
  });
  let log = '';
  server.stdout?.on('data', (d) => { log += d; });
  server.stderr?.on('data', (d) => { log += d; });
  if (process.env.ENGRAM_VIEW_DEBUG) { server.stdout?.on('data', (d) => process.stdout.write(d)); server.stderr?.on('data', (d) => process.stderr.write(d)); }
  server.on('exit', (code) => {
    if (quitting) return;
    dialog.showErrorBox('Engram View', `El servidor interno se detuvo (código ${code}).\n\n${log.slice(-1500)}`);
    app.quit();
  });

  win = new BrowserWindow({
    ...boundsOnCursorDisplay(),
    minWidth: 900, minHeight: 600,
    show: false,
    backgroundColor: '#0a0a0b',
    title: 'Engram View',
    icon: ICON,
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, sandbox: true },
  });
  win.once('ready-to-show', () => { win.show(); win.focus(); });
  win.on('closed', () => { win = null; });

  // enlaces externos al navegador del sistema; la ventana solo navega dentro del visor
  win.webContents.setWindowOpenHandler(({ url: u }) => { if (/^https?:/.test(u)) shell.openExternal(u); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, u) => { if (!u.startsWith(url)) { e.preventDefault(); if (/^https?:/.test(u)) shell.openExternal(u); } });

  if (!(await waitUp(url))) {
    dialog.showErrorBox('Engram View', `No se pudo arrancar el servidor interno.\n\n${log.slice(-1500)}`);
    return app.quit();
  }
  win.loadURL(url);
}

app.on('before-quit', () => { quitting = true; server?.kill(); });
app.on('window-all-closed', () => app.quit());
