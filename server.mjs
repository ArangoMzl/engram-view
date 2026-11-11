// Engram View — servidor local de solo lectura sobre engram.db
// Uso: node server.mjs [--db ruta] [--port 7438] [--demo] [--no-open]
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { exec } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const opt = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(ROOT, 'public');
const PORT = Number(opt('--port') || process.env.PORT || 7438);
const DEMO = flag('--demo');

let DB_PATH = opt('--db') || process.env.ENGRAM_DB ||
  path.join(process.env.ENGRAM_DATA_DIR || path.join(os.homedir(), '.engram'), 'engram.db');
if (DEMO) {
  DB_PATH = path.join(os.tmpdir(), 'engram-view-demo.db');
  const { createDemo } = await import('./seed.mjs');
  createDemo(DB_PATH);
}

// ---------- base de datos (solo lectura) ----------
let db = null;
function getDb() {
  if (db) return db;
  if (!fs.existsSync(DB_PATH)) {
    throw Object.assign(new Error(`No se encontró la base de datos en ${DB_PATH}`), { code: 'db_missing' });
  }
  db = new DatabaseSync(DB_PATH, { readOnly: true });
  return db;
}
const all = (sql, ...p) => getDb().prepare(sql).all(...p);
const one = (sql, ...p) => getDb().prepare(sql).get(...p);

// filtro por proyecto: sin parámetro = todos; "" = memorias sin proyecto
function pf(u, col = 'project') {
  const p = u.searchParams.get('project');
  return p === null ? { w: '', a: [] } : { w: ` AND coalesce(${col},'') = ?`, a: [p] };
}
const LIVE = 'deleted_at IS NULL';
const LIST_COLS = `id, type, title, substr(content,1,260) AS excerpt, coalesce(project,'') AS project,
  scope, topic_key, pinned, revision_count, session_id, created_at, updated_at`;

const routes = {
  meta() {
    let size = 0, mtime = null;
    try { const s = fs.statSync(DB_PATH); size = s.size; mtime = s.mtime.toISOString(); } catch {}
    return {
      dbPath: DB_PATH, demo: DEMO, size, mtime,
      total: one(`SELECT count(*) c FROM observations WHERE ${LIVE}`).c,
      sessions: one('SELECT count(*) c FROM sessions').c,
      projects: all(`SELECT coalesce(project,'') AS project, count(*) AS count FROM observations
                     WHERE ${LIVE} GROUP BY 1 ORDER BY count DESC`),
    };
  },

  stats(u) {
    const o = pf(u), s = pf(u, 'project');
    const n = (sql, a) => one(sql, ...a).c;
    const last = one(`SELECT id, project, started_at, ended_at, summary FROM sessions WHERE 1=1${s.w}
                      ORDER BY started_at DESC LIMIT 1`, ...s.a);
    if (last) {
      last.prompts = all('SELECT content FROM user_prompts WHERE session_id = ? ORDER BY created_at LIMIT 4', last.id).map(r => r.content);
      last.saved = n(`SELECT count(*) c FROM observations WHERE session_id = ? AND ${LIVE}`, [last.id]);
    }
    return {
      memories: n(`SELECT count(*) c FROM observations WHERE ${LIVE}${o.w}`, o.a),
      sessions: n(`SELECT count(*) c FROM sessions WHERE 1=1${s.w}`, s.a),
      pinned: n(`SELECT count(*) c FROM observations WHERE ${LIVE} AND pinned = 1${o.w}`, o.a),
      revisions: n(`SELECT coalesce(sum(revision_count - 1),0) c FROM observations WHERE ${LIVE}${o.w}`, o.a),
      prompts: n(`SELECT count(*) c FROM user_prompts WHERE 1=1${s.w}`, s.a),
      weekMemories: n(`SELECT count(*) c FROM observations WHERE ${LIVE} AND created_at >= datetime('now','-7 days')${o.w}`, o.a),
      weekSessions: n(`SELECT count(*) c FROM sessions WHERE started_at >= datetime('now','-7 days')${s.w}`, s.a),
      byType: all(`SELECT type, count(*) c FROM observations WHERE ${LIVE}${o.w} GROUP BY type ORDER BY c DESC`, ...o.a),
      activity: all(`SELECT date(created_at,'localtime') d, count(*) c FROM observations
                     WHERE ${LIVE} AND created_at >= date('now','-130 days')${o.w} GROUP BY d`, ...o.a),
      recent: all(`SELECT id, type, title, created_at FROM observations WHERE ${LIVE}${o.w}
                   ORDER BY created_at DESC, id DESC LIMIT 6`, ...o.a),
      lastSession: last || null,
    };
  },

  observations(u) {
    const o = pf(u);
    const type = u.searchParams.get('type') || '';
    const q = (u.searchParams.get('q') || '').trim();
    let w = `${LIVE}${o.w}`, a = [...o.a];
    if (q) {
      let ids = null;
      if (q.length >= 3) { // el índice FTS usa trigramas: mínimo 3 caracteres
        try {
          ids = all('SELECT rowid AS id FROM observations_fts WHERE observations_fts MATCH ? LIMIT 2000',
            '"' + q.replace(/"/g, '""') + '"').map(r => r.id);
        } catch { ids = null; }
      }
      if (ids) { w += ` AND id IN (${ids.length ? ids.join(',') : 'NULL'})`; }
      else { w += ` AND (title LIKE ? OR content LIKE ? OR topic_key LIKE ?)`; a.push(`%${q}%`, `%${q}%`, `%${q}%`); }
    }
    const types = all(`SELECT type, count(*) c FROM observations WHERE ${w} GROUP BY type ORDER BY c DESC`, ...a);
    const wt = type ? `${w} AND type = ?` : w, at = type ? [...a, type] : a;
    return {
      total: types.reduce((s, t) => s + t.c, 0),
      types,
      items: all(`SELECT ${LIST_COLS} FROM observations WHERE ${wt}
                  ORDER BY created_at DESC, id DESC LIMIT 300`, ...at),
    };
  },

  observation(u, id) {
    const obs = one(`SELECT id, sync_id, session_id, type, title, content, tool_name, coalesce(project,'') AS project,
        scope, topic_key, revision_count, duplicate_count, last_seen_at, pinned, created_at, updated_at
      FROM observations WHERE id = ? AND ${LIVE}`, Number(id));
    if (!obs) return null;
    const brief = 'o.id, o.type, o.title';
    return {
      obs,
      versions: all('SELECT version, title, content, created_at FROM observation_versions WHERE observation_id = ? ORDER BY version DESC', obs.id),
      session: one('SELECT id, project, directory, started_at, ended_at, summary FROM sessions WHERE id = ?', obs.session_id) || null,
      relations: obs.sync_id ? all(`SELECT ${brief}, r.relation, r.reason, r.confidence FROM memory_relations r
          JOIN observations o ON o.sync_id = CASE WHEN r.source_id = ? THEN r.target_id ELSE r.source_id END
          WHERE (r.source_id = ? OR r.target_id = ?) AND r.superseded_at IS NULL AND o.deleted_at IS NULL AND o.id <> ?`,
        obs.sync_id, obs.sync_id, obs.sync_id, obs.id) : [],
      sameTopic: obs.topic_key ? all(`SELECT ${brief} FROM observations o WHERE o.topic_key = ? AND o.id <> ? AND o.deleted_at IS NULL
          ORDER BY o.created_at DESC LIMIT 8`, obs.topic_key, obs.id) : [],
      sameSession: all(`SELECT ${brief} FROM observations o WHERE o.session_id = ? AND o.id <> ? AND o.deleted_at IS NULL
          ORDER BY o.created_at DESC LIMIT 8`, obs.session_id, obs.id),
    };
  },

  sessions(u) {
    const s = pf(u);
    const list = all(`SELECT id, project, directory, started_at, ended_at, summary FROM sessions WHERE 1=1${s.w}
                      ORDER BY started_at DESC LIMIT 150`, ...s.a);
    if (!list.length) return [];
    const by = Object.fromEntries(list.map(x => [x.id, Object.assign(x, { prompts: [], observations: [] })]));
    const ph = list.map(() => '?').join(','), ids = list.map(x => x.id);
    for (const p of all(`SELECT session_id, content, created_at FROM user_prompts WHERE session_id IN (${ph}) ORDER BY created_at`, ...ids))
      by[p.session_id].prompts.push({ content: p.content, created_at: p.created_at });
    for (const m of all(`SELECT session_id, id, type, title FROM observations WHERE session_id IN (${ph}) AND ${LIVE} ORDER BY created_at`, ...ids))
      by[m.session_id].observations.push({ id: m.id, type: m.type, title: m.title });
    return list;
  },

  graph(u) {
    const o = pf(u);
    const nodes = all(`SELECT id, sync_id, type, title, coalesce(project,'') AS project, topic_key, session_id, created_at
                       FROM observations WHERE ${LIVE}${o.w} ORDER BY created_at DESC, id DESC LIMIT 250`, ...o.a);
    const bySync = new Map(nodes.filter(n => n.sync_id).map(n => [n.sync_id, n.id]));
    const seen = new Set(), edges = [];
    const add = (a, b, kind, label) => {
      if (a == null || b == null || a === b) return;
      const k = a < b ? `${a}-${b}` : `${b}-${a}`;
      if (seen.has(k)) return; seen.add(k); edges.push({ a, b, kind, label });
    };
    for (const r of all('SELECT source_id, target_id, relation FROM memory_relations WHERE superseded_at IS NULL'))
      add(bySync.get(r.source_id), bySync.get(r.target_id), 'relation', r.relation);
    // mismo tema y misma sesión: se encadenan (no todos contra todos) para no saturar el grafo
    const chain = (key, kind, label) => {
      const g = new Map();
      for (const n of nodes) { const k = n[key]; if (k) (g.get(k) || g.set(k, []).get(k)).push(n.id); }
      for (const ids of g.values()) for (let i = 1; i < ids.length; i++) add(ids[i - 1], ids[i], kind, label);
    };
    chain('topic_key', 'topic', 'mismo tema');
    chain('session_id', 'session', 'misma sesión');
    return { nodes: nodes.map(({ sync_id, session_id, ...n }) => n), edges };
  },
};

// ---------- avisos en vivo (SSE) ----------
const clients = new Set();
let lastSig = '';
const sig = () => [DB_PATH, DB_PATH + '-wal'].map(f => { try { const s = fs.statSync(f); return s.mtimeMs + ':' + s.size; } catch { return '-'; } }).join('|');
setInterval(() => {
  const s = sig();
  if (s !== lastSig) { if (lastSig) for (const c of clients) c.write('event: change\ndata: {}\n\n'); lastSig = s; }
}, 1500).unref();

// modo aplicación (--app): el servidor se apaga solo cuando se cierra la ventana del visor
if (flag('--app')) {
  let lastSeen = Date.now() + 45000; // margen inicial para que la ventana conecte
  setInterval(() => {
    if (clients.size) lastSeen = Date.now();
    else if (Date.now() - lastSeen > 20000) process.exit(0);
  }, 5000);
}

// ---------- http ----------
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
const json = (res, code, body) => { res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(JSON.stringify(body)); };

const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://localhost');
  if (req.method !== 'GET') return json(res, 405, { error: 'solo lectura' });

  if (u.pathname === '/api/events') {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
    res.write('retry: 3000\n\n');
    clients.add(res); req.on('close', () => clients.delete(res));
    return;
  }
  if (u.pathname.startsWith('/api/')) {
    try {
      const parts = u.pathname.slice(5).split('/');
      let out;
      if (parts[0] === 'observations' && parts[1]) out = routes.observation(u, parts[1]);
      else if (routes[parts[0]] && parts.length === 1 && parts[0] !== 'observation') out = routes[parts[0]](u);
      else return json(res, 404, { error: 'ruta desconocida' });
      return out === null ? json(res, 404, { error: 'no encontrado' }) : json(res, 200, out);
    } catch (e) {
      if (e.code !== 'db_missing') { console.error(e); db = null; }
      return json(res, e.code === 'db_missing' ? 503 : 500, { error: e.code || 'error', message: e.message, dbPath: DB_PATH });
    }
  }
  const rel = u.pathname === '/' ? 'index.html' : decodeURIComponent(u.pathname.slice(1));
  const file = path.resolve(PUBLIC, rel);
  if (file !== PUBLIC && !file.startsWith(PUBLIC + path.sep)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404, { 'content-type': 'text/plain' }); return res.end('No encontrado'); }
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(buf);
  });
});

server.on('error', (e) => {
  console.error(e.code === 'EADDRINUSE' ? `El puerto ${PORT} ya está en uso. Prueba con --port <otro>.` : e.message);
  process.exit(1);
});
server.listen(PORT, '127.0.0.1', () => {
  const url = `http://localhost:${PORT}`;
  console.log(`\n  Engram View  →  ${url}\n  Base de datos: ${DB_PATH}${DEMO ? '  (demostración)' : ''}\n  Modo: solo lectura\n`);
  if (!flag('--no-open')) {
    const cmd = process.platform === 'win32' ? `start "" "${url}"` : process.platform === 'darwin' ? `open "${url}"` : `xdg-open "${url}"`;
    exec(cmd, () => {});
  }
});
