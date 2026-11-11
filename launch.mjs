// Lanzador de Engram View: arranca el servidor en segundo plano (si no está ya) y abre el visor
// en una ventana propia, sin barra de navegador. Lo usa el acceso directo del escritorio.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.ENGRAM_VIEW_PORT || 7438);
const URL_ = `http://localhost:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function up() {
  try {
    const r = await fetch(`${URL_}/api/meta`, { signal: AbortSignal.timeout(800) });
    return r.ok || r.status === 503; // 503 = servidor vivo pero sin base de datos
  } catch { return false; }
}

if (!(await up())) {
  spawn(process.execPath, [path.join(ROOT, 'server.mjs'), '--no-open', '--app', '--port', String(PORT)],
    { cwd: ROOT, detached: true, stdio: 'ignore', windowsHide: true }).unref();
  for (let i = 0; i < 50 && !(await up()); i++) await sleep(150);
}

const env = process.env;
const browsers = [
  [env['ProgramFiles(x86)'], 'Microsoft/Edge/Application/msedge.exe'],
  [env.ProgramFiles, 'Microsoft/Edge/Application/msedge.exe'],
  [env.ProgramFiles, 'Google/Chrome/Application/chrome.exe'],
  [env['ProgramFiles(x86)'], 'Google/Chrome/Application/chrome.exe'],
  [env.LOCALAPPDATA, 'Google/Chrome/Application/chrome.exe'],
].filter(([base]) => base).map(([base, rel]) => path.join(base, rel));
const exe = browsers.find((p) => fs.existsSync(p));

if (exe) spawn(exe, [`--app=${URL_}`, '--window-size=1440,900'], { detached: true, stdio: 'ignore' }).unref();
else if (process.platform === 'win32') spawn('cmd', ['/c', 'start', '', URL_], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
else spawn(process.platform === 'darwin' ? 'open' : 'xdg-open', [URL_], { detached: true, stdio: 'ignore' }).unref();
