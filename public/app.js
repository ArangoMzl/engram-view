// Engram View — interfaz. Solo lee de /api/*; no modifica la base de datos.
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ---------- tipos ----------
const KNOWN = {
  decision: ['Decisión', '#ea1889'], bugfix: ['Bugfix', '#f87171'], discovery: ['Hallazgo', '#34d399'],
  architecture: ['Arquitectura', '#a78bfa'], pattern: ['Patrón', '#fbbf24'], config: ['Config', '#38bdf8'],
  preference: ['Preferencia', '#fb923c'], learning: ['Aprendizaje', '#2dd4bf'],
  session_summary: ['Resumen de sesión', '#a1a1aa'], manual: ['Manual', '#e4e4e7'],
};
const PAL = ['#f472b6', '#60a5fa', '#4ade80', '#facc15', '#c084fc', '#fb7185', '#22d3ee'];
function tinfo(t) {
  t = t || 'otro';
  if (KNOWN[t]) return KNOWN[t];
  let h = 0; for (const c of t) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return [t.replace(/_/g, ' '), PAL[h % PAL.length]];
}
const tag = (t) => { const [l, c] = tinfo(t); return `<span class="tag" style="--c:${c}">${esc(l)}</span>`; };

// ---------- fechas ----------
const dt = (s) => (s ? new Date(/T|Z$/.test(s) ? s : s.replace(' ', 'T') + 'Z') : null);
const fmt = (s, o) => { const d = dt(s); return d && !isNaN(d) ? d.toLocaleDateString('es', o || { day: 'numeric', month: 'short' }) : '—'; };
const hm = (s) => { const d = dt(s); return d && !isNaN(d) ? d.toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' }) : ''; };
function dur(a, b) {
  const x = dt(a), y = dt(b); if (!x || !y || isNaN(x) || isNaN(y)) return '';
  const m = Math.max(0, Math.round((y - x) / 60000)); if (!m) return '';
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min`;
}
const bytes = (n) => (n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB');
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

// ---------- contenido ----------
const inline = (s) => esc(s).replace(/`([^`\n]+)`/g, '<code>$1</code>').replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
const plain = (s) => String(s ?? '').replace(/\*\*(What|Why|Where|Learned)\*\*\s*:?/gi, '').replace(/[`*#]/g, '').replace(/\s+/g, ' ').trim();
function md(text) {
  return String(text ?? '').split(/```/).map((part, i) => {
    if (i % 2) return `<pre><code>${esc(part.replace(/^[a-z0-9_-]*\n/i, ''))}</code></pre>`;
    return part.split(/\n{2,}/).map((b) => {
      b = b.trim(); if (!b) return '';
      const lines = b.split('\n');
      if (lines.every((l) => /^\s*[-*]\s+/.test(l))) return '<ul>' + lines.map((l) => `<li>${inline(l.replace(/^\s*[-*]\s+/, ''))}</li>`).join('') + '</ul>';
      if (/^#{1,6}\s/.test(b) && lines.length === 1) return `<h3>${inline(b.replace(/^#+\s*/, ''))}</h3>`;
      return `<p>${lines.map(inline).join('<br>')}</p>`;
    }).join('');
  }).join('');
}
const LBL = { what: 'Qué', why: 'Por qué', where: 'Dónde', learned: 'Aprendido' };
function sections(c) {
  const re = /(?:^|\n)[ \t]*\*\*(What|Why|Where|Learned)\s*:?\*\*[ \t]*:?[ \t]*/gi;
  const m = [...String(c ?? '').matchAll(re)];
  if (m.length < 2) return null;
  const out = [], pre = c.slice(0, m[0].index).trim();
  if (pre) out.push({ k: '', t: pre });
  m.forEach((x, i) => out.push({ k: LBL[x[1].toLowerCase()], t: c.slice(x.index + x[0].length, i + 1 < m.length ? m[i + 1].index : c.length).trim() }));
  return out;
}
function diffLines(a, b) {
  const A = a.split('\n'), B = b.split('\n'), n = A.length, m = B.length;
  const L = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = A[i] === B[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const out = []; let i = 0, j = 0;
  while (i < n && j < m) { if (A[i] === B[j]) { out.push([' ', A[i]]); i++; j++; } else if (L[i + 1][j] >= L[i][j + 1]) out.push(['-', A[i++]]); else out.push(['+', B[j++]]); }
  while (i < n) out.push(['-', A[i++]]); while (j < m) out.push(['+', B[j++]]);
  return out.filter((x) => x[1].trim() !== '');
}

// ---------- estado ----------
const st = { view: 'resumen', proj: null, type: '', q: '', sel: null, force: false, ver: 0, gsel: null };
const D = { meta: null, stats: null, list: null, detail: null, sessions: null, graph: null, error: null, live: true };
const G = { sig: '', N: [], E: [], by: {}, deg: {}, vb: null, alpha: 0, raf: 0, drag: null, userView: false, fresh: false, labels: true, elN: {}, elL: [] };

async function api(p, params = {}) {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== null && v !== undefined && !(v === '' && k !== 'project')) u.set(k, v);
  const r = await fetch(`/api/${p}${u.size ? '?' + u : ''}`);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(j.message || 'Error al leer la base de datos'), j);
  return j;
}

let token = 0;
async function refresh(keep) {
  const my = ++token;
  try {
    const meta = await api('meta'), P = { project: st.proj };
    const n = {};
    if (st.view === 'resumen') n.stats = await api('stats', P);
    if (st.view === 'memorias') {
      n.list = await api('observations', { ...P, type: st.type, q: st.q });
      const ids = n.list.items.map((m) => m.id);
      if (st.sel == null || (!ids.includes(st.sel) && !st.force)) { st.sel = ids[0] ?? null; st.ver = 0; }
      n.detail = st.sel != null ? await api('observations/' + st.sel).catch(() => null) : null;
    }
    if (st.view === 'sesiones') n.sessions = await api('sessions', P);
    if (st.view === 'grafo') { n.graph = await api('graph', P); }
    if (my !== token) return;
    Object.assign(D, n, { meta, error: null, live: true });
    if (n.graph) layoutGraph();
  } catch (e) {
    if (my !== token) return;
    D.error = e; D.live = false;
  }
  render(keep);
}

// ---------- marco ----------
const ICON = {
  resumen: '<path d="M4 13h6V4H4zM14 20h6v-9h-6zM4 20h6v-3H4zM14 7h6V4h-6z"/>',
  memorias: '<path d="M5 4h14v16H5zM9 9h6M9 13h6M9 17h3"/>',
  sesiones: '<circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/>',
  grafo: '<circle cx="6" cy="7" r="2.5"/><circle cx="18" cy="6" r="2.5"/><circle cx="12" cy="18" r="2.5"/><path d="M8.2 8.2 11 15.6M15.8 7.6l-2.9 8M8.5 6.8l7-.6"/>',
};
const projName = (p) => (p === '' ? 'sin proyecto' : p);
function chrome() {
  const m = D.meta, projs = m ? m.projects : [];
  const cur = st.proj === null ? null : projs.find((p) => p.project === st.proj);
  const n = { resumen: '', memorias: m ? (cur ? cur.count : m.total) : '', sesiones: st.proj === null && m ? m.sessions : '', grafo: '' };
  $('#nav').innerHTML = Object.keys(ICON).map((v) => `<button data-view="${v}" class="${st.view === v ? 'on' : ''}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICON[v]}</svg>${v[0].toUpperCase() + v.slice(1)}<span class="n">${n[v]}</span></button>`).join('');
  $('#projects').innerHTML = `<button data-proj="-1" class="${st.proj === null ? 'on' : ''}"><span class="dot"></span><span class="lbl">Todos</span><span class="n">${m ? m.total : ''}</span></button>` +
    projs.map((p, i) => `<button data-proj="${i}" class="${st.proj === p.project ? 'on' : ''}" title="${esc(projName(p.project))}"><span class="dot"></span><span class="lbl">${esc(projName(p.project))}</span><span class="n">${p.count}</span></button>`).join('');
  $('#scope').textContent = st.proj === null ? 'todos los proyectos' : projName(st.proj);
  $('#demo').hidden = !(m && m.demo);
  $('#foot').innerHTML = `<div class="live"><span class="pulse ${D.live ? '' : 'off'}"></span>${D.live ? 'solo lectura · en vivo' : 'sin conexión'}</div>` +
    (m ? `<div title="${esc(m.dbPath)}">${esc(m.dbPath.replace(/\\/g, '/').replace(/^.*\/(?=[^/]+\/[^/]+$)/, '…/'))}</div><div>${bytes(m.size)} · ${hm(m.mtime) ? 'cambió ' + fmt(m.mtime) + ' ' + hm(m.mtime) : ''}</div>` : '');
}

function stateCard() {
  const e = D.error, m = D.meta;
  if (e) return `<div class="pad"><div class="card state"><div class="eyebrow">${e.error === 'db_missing' ? 'Base no encontrada' : 'Error'}</div>
    <h2>${e.error === 'db_missing' ? 'No encuentro la base de Engram' : 'No se pudo leer la base'}</h2>
    <p>${esc(e.message || '')}</p><p>Arranca el visor indicando dónde está tu <code>engram.db</code>:</p><pre>node server.mjs --db "ruta/a/engram.db"</pre></div></div>`;
  if (m && m.total === 0 && !m.sessions) return `<div class="pad"><div class="card state"><div class="eyebrow">Base vacía</div>
    <h2>Esta base aún no tiene memorias</h2>
    <p>Estoy leyendo <code>${esc(m.dbPath)}</code>, pero no contiene memorias ni sesiones. Aparecerán aquí solas en cuanto tu agente guarde la primera.</p>
    <p>Si Engram guarda tus datos en otra ruta, o quieres ver el visor con datos de ejemplo:</p>
    <pre>node server.mjs --db "ruta/a/engram.db"</pre><pre>npm run demo</pre></div></div>`;
  return null;
}

// ---------- resumen ----------
function heat(activity) {
  const by = Object.fromEntries(activity.map((a) => [a.d, a.c])), max = Math.max(1, ...activity.map((a) => a.c));
  const WEEKS = 18, today = new Date(); today.setHours(0, 0, 0, 0);
  const start = new Date(today); start.setDate(start.getDate() - ((today.getDay() + 6) % 7) - (WEEKS - 1) * 7);
  let cells = '', months = '', lastM = -1;
  for (let w = 0; w < WEEKS; w++) {
    const first = new Date(start); first.setDate(start.getDate() + w * 7);
    months += `<span>${first.getMonth() !== lastM ? first.toLocaleDateString('es', { month: 'short' }) : ''}</span>`; lastM = first.getMonth();
    for (let d = 0; d < 7; d++) {
      const day = new Date(first); day.setDate(first.getDate() + d);
      if (day > today) { cells += '<i style="visibility:hidden"></i>'; continue; }
      const key = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`, c = by[key] || 0;
      cells += `<i data-l="${c ? Math.ceil((c / max) * 4) : 0}" title="${day.toLocaleDateString('es', { day: 'numeric', month: 'short' })}: ${plural(c, 'memoria', 'memorias')}"></i>`;
    }
  }
  return `<div class="heat">${cells}</div><div class="heat-foot" style="display:grid;grid-template-columns:repeat(${WEEKS},1fr);gap:4px">${months}</div>`;
}
function resumen() {
  const s = D.stats; if (!s) return '';
  const max = Math.max(1, ...s.byType.map((t) => t.c));
  const bars = s.byType.map((t) => `<div class="bar">${tag(t.type)}<div class="tr"><b style="width:${(t.c / max) * 100}%;background:${tinfo(t.type)[1]}"></b></div><span class="c">${t.c}</span></div>`).join('') || '<p class="muted">Sin memorias todavía.</p>';
  const recent = s.recent.map((m) => `<button class="rel" data-mem="${m.id}">${tag(m.type)}<span class="t">${esc(m.title)}</span><span class="k">${fmt(m.created_at)}</span></button>`).join('');
  const L = s.lastSession;
  const term = L ? `<div class="term"><div class="term-h"><i></i><i></i><i></i><span>última sesión · ${esc(L.project)}</span></div><pre><span class="p">$</span> <span class="w">${fmt(L.started_at)} ${hm(L.started_at)}</span>${dur(L.started_at, L.ended_at) ? ' · ' + dur(L.started_at, L.ended_at) : ''}
${L.prompts.map((p) => `<span class="p">&gt;</span> ${esc(p.length > 110 ? p.slice(0, 109) + '…' : p)}`).join('\n')}
<span class="g">✓</span> ${plural(L.saved, 'memoria guardada', 'memorias guardadas')}${L.summary ? '\n<span class="g">✓</span> resumen de sesión escrito' : ''}</pre></div>` : '';
  const scope = st.proj === null ? plural(D.meta.projects.length, 'proyecto', 'proyectos') : `<b>${esc(projName(st.proj))}</b>`;
  const wk = (n) => (n ? `+${n} esta semana` : 'sin cambios esta semana');
  return `<div class="pad">
   <div class="eyebrow">Resumen</div>
   <h1>Lo que tu agente <em>recuerda.</em></h1>
   <p class="lead">${plural(s.memories, 'memoria', 'memorias')} en ${scope}, capturadas en ${plural(s.sessions, 'sesión', 'sesiones')}.${L ? ` La última actividad fue el ${fmt(L.started_at, { day: 'numeric', month: 'long' })}.` : ''}</p>
   <div class="stats">
    <div class="card stat hot"><div class="eyebrow">Memorias</div><div class="v">${s.memories}</div><div class="d ${s.weekMemories ? '' : 'sec'}">${wk(s.weekMemories)}</div></div>
    <div class="card stat"><div class="eyebrow" style="color:var(--text-muted)">Sesiones</div><div class="v">${s.sessions}</div><div class="d ${s.weekSessions ? '' : 'sec'}">${wk(s.weekSessions)}</div></div>
    <div class="card stat"><div class="eyebrow" style="color:var(--text-muted)">Fijadas</div><div class="v">${s.pinned}</div><div class="d sec">siempre en contexto</div></div>
    <div class="card stat"><div class="eyebrow" style="color:var(--text-muted)">Prompts</div><div class="v">${s.prompts}</div><div class="d sec">${plural(s.revisions, 'revisión', 'revisiones')} de memorias</div></div>
   </div>
   <div class="grid2">
    <div class="card"><div class="card-h"><h2>Actividad</h2><span class="mono muted" style="font-size:11px">últimas 18 semanas</span></div><div class="card-b">${heat(s.activity)}</div></div>
    <div class="card"><div class="card-h"><h2>Por tipo</h2></div><div class="card-b"><div class="bars">${bars}</div></div></div>
   </div>
   <div class="grid2">
    <div class="card"><div class="card-h"><h2>Memorias recientes</h2><button class="mono" style="font-size:11px;color:var(--accent)" data-view="memorias">ver todas →</button></div><div class="card-b" style="padding:10px 8px">${recent}</div></div>
    ${term}
   </div></div>`;
}

// ---------- memorias ----------
function versionsOf(d) {
  const E = d.versions.map((v) => ({ label: `Versión ${v.version}`, content: v.content, at: v.created_at }));
  if (!E.length || E[0].content !== d.obs.content) E.unshift({ label: E.length ? 'Actual' : 'Versión 1', content: d.obs.content, at: d.obs.updated_at });
  return E;
}
function detail() {
  const d = D.detail; if (!d) return '<div class="empty">Elige una memoria de la lista.</div>';
  const o = d.obs, E = versionsOf(d), vi = Math.min(st.ver, E.length - 1), cur = E[vi];
  const secs = sections(cur.content);
  const bodyHtml = secs ? secs.map((s) => `<div class="blk">${s.k ? `<div class="eyebrow">${s.k}</div>` : ''}<div class="md">${md(s.t)}</div></div>`).join('') : `<div class="blk"><div class="md">${md(cur.content)}</div></div>`;
  const vers = E.map((v, i) => `<button class="ver ${i === 0 ? 'cur' : ''} ${i === vi ? 'sel' : ''}" data-ver="${i}"><div class="ln"><i></i></div><div><b>${v.label}</b>${i === 0 && E.length > 1 ? ' <span class="mono" style="color:var(--accent);font-size:11px">actual</span>' : ''}<div class="mono muted" style="font-size:11px">${fmt(v.at)} ${hm(v.at)}</div></div></button>`).join('');
  const prev = E[vi + 1];
  const df = prev ? `<div class="diff">${diffLines(prev.content, cur.content).map(([k, l]) => `<div class="${k === '+' ? 'a' : k === '-' ? 'r' : 's'}">${k} ${esc(l)}</div>`).join('')}</div>`
    : `<p class="muted" style="margin:8px 0 0;font-size:13px">${E.length > 1 ? 'Primera versión guardada.' : 'Sin cambios desde que se guardó.'}</p>`;
  const seen = new Set(), rel = [];
  for (const [arr, k] of [[d.relations, null], [d.sameTopic, 'mismo tema'], [d.sameSession, 'misma sesión']])
    for (const r of arr) if (!seen.has(r.id)) { seen.add(r.id); rel.push({ ...r, k: k || (r.relation || 'relacionada').replace(/_/g, ' ') }); }
  const relHtml = rel.slice(0, 12).map((r) => `<button class="rel" data-mem="${r.id}" title="${esc(r.reason || r.title)}">${tag(r.type)}<span class="t">${esc(r.title)}</span><span class="k">${esc(r.k)}</span></button>`).join('') || '<p class="muted" style="margin:6px 10px;font-size:13px">Sin memorias relacionadas.</p>';
  const S = d.session;
  return `<div class="in">
    <div style="display:flex;align-items:center;gap:10px">${tag(o.type)}${o.pinned ? '<span class="pin mono">● fijada</span>' : ''}<span class="mono muted" style="font-size:11px;margin-left:auto">#${o.id} · ${fmt(o.created_at, { day: 'numeric', month: 'long', year: 'numeric' })} ${hm(o.created_at)}</span></div>
    <h1>${esc(o.title)}</h1>
    <div class="metas">${o.project ? `<span class="pill">${esc(o.project)}</span>` : ''}${o.topic_key ? `<span class="pill">tema <code>${esc(o.topic_key)}</code></span>` : ''}<span class="pill">alcance ${esc(o.scope === 'project' ? 'proyecto' : o.scope)}</span>${o.tool_name ? `<span class="pill">${esc(o.tool_name)}</span>` : ''}${o.duplicate_count > 1 ? `<span class="pill">vista ${o.duplicate_count} veces</span>` : ''}</div>
    ${vi > 0 ? `<div class="pill" style="margin-bottom:18px;border-color:var(--border-glow);color:var(--text-primary)">Estás viendo: ${cur.label.toLowerCase()} · ${fmt(cur.at)}</div>` : ''}
    ${bodyHtml}
    <div class="split">
      <div class="card"><div class="card-h"><h2>Historial</h2><span class="mono muted" style="font-size:11px">${plural(E.length, 'versión', 'versiones')}</span></div><div class="card-b" style="padding:10px 10px 14px">${vers}${df}</div></div>
      <div class="card"><div class="card-h"><h2>Relacionadas</h2><button class="mono" style="font-size:11px;color:var(--accent)" data-graph="${o.id}">ver en grafo →</button></div><div class="card-b" style="padding:10px 8px">${relHtml}
        ${S ? `<button class="rel" data-view="sesiones" style="margin-top:6px;border-top:1px solid var(--border-subtle);border-radius:0 0 10px 10px;padding-top:12px"><span class="sec t">Sesión del ${fmt(S.started_at)}${dur(S.started_at, S.ended_at) ? ' · ' + dur(S.started_at, S.ended_at) : ''}</span><span class="k">abrir →</span></button>` : ''}</div></div>
    </div></div>`;
}
function memorias() {
  const L = D.list; if (!L) return '';
  const chips = `<button class="chip ${st.type ? '' : 'on'}" data-type="">todas ${L.total}</button>` + L.types.map((t) => `<button class="chip ${st.type === t.type ? 'on' : ''}" data-type="${esc(t.type)}">${esc(tinfo(t.type)[0].toLowerCase())} ${t.c}</button>`).join('');
  const rows = L.items.map((m) => `<button class="row ${st.sel === m.id ? 'on' : ''}" data-mem="${m.id}">
    <div class="r1">${tag(m.type)}${m.pinned ? '<span class="pin mono">● fijada</span>' : ''}<time>${fmt(m.created_at)}</time></div>
    <div class="ti">${esc(m.title)}</div><div class="ex">${esc(plain(m.excerpt))}</div>
    <div class="r3">${m.project ? `<span>${esc(m.project)}</span>` : ''}${m.topic_key ? `<span>${esc(m.topic_key)}</span>` : ''}${m.revision_count > 1 ? `<span>rev ${m.revision_count}</span>` : ''}</div></button>`).join('')
    || `<div class="empty"><b>Sin resultados</b><br>${st.q ? `Ninguna memoria coincide con “${esc(st.q)}”. Prueba con otro término o quita el filtro.` : 'No hay memorias con este filtro.'}</div>`;
  const more = L.items.length < (st.type ? (L.types.find((t) => t.type === st.type) || { c: 0 }).c : L.total) ? `<div class="more">Mostrando las ${L.items.length} más recientes. Usa la búsqueda para acotar.</div>` : '';
  return `<div class="mem"><div class="mem-list"><div class="filters">${chips}</div><div class="rows">${rows}${more}</div></div><div class="detail">${detail()}</div></div>`;
}

// ---------- sesiones ----------
function sesiones() {
  const SS = D.sessions; if (!SS) return '';
  const body = SS.map((s) => `<div class="sess"><div class="when">${fmt(s.started_at, { weekday: 'short', day: 'numeric', month: 'short' })}<small>${hm(s.started_at)}${dur(s.started_at, s.ended_at) ? ' · ' + dur(s.started_at, s.ended_at) : ''}</small></div><div class="rail"><i></i></div>
    <div class="card"><div class="card-b"><div style="display:flex;gap:8px;align-items:center;margin-bottom:10px"><span class="pill">${esc(s.project)}</span>${s.ended_at ? '' : '<span class="pill" style="color:var(--ok)">abierta</span>'}<span class="mono muted" style="margin-left:auto;font-size:11px" title="${esc(s.id)}">${esc(String(s.id).slice(0, 14))}</span></div>
    ${s.summary ? `<div class="md" style="margin-bottom:12px">${md(s.summary)}</div>` : '<p class="muted" style="margin:0 0 12px">Sin resumen de sesión.</p>'}
    ${s.prompts.map((p) => `<div class="prompt" title="${esc(p.content)}">${esc(p.content)}</div>`).join('')}
    ${s.observations.length ? `<div class="out">${s.observations.map((m) => `<button data-mem="${m.id}">${tag(m.type)}<span class="t">${esc(m.title)}</span></button>`).join('')}</div>` : ''}</div></div></div>`).join('')
    || '<div class="card state" style="margin-top:0"><div class="eyebrow">Sin sesiones</div><p style="margin-top:10px">No hay sesiones registradas para este proyecto.</p></div>';
  return `<div class="pad"><div class="eyebrow">Sesiones</div><h1>Sesión a sesión, <em>qué quedó.</em></h1><p class="lead">Cada sesión con su resumen, lo que le pediste al agente y las memorias que guardó.</p>${body}</div>`;
}

// ---------- grafo ----------
// Simulación de fuerzas animada, sin librerías. Cada nodo ocupa una caja que incluye su etiqueta,
// y las cajas no pueden solaparse: así ni los nodos ni los textos se pisan.
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
const nodeR = (id) => Math.min(26, 9 + (G.deg[id] || 0) * 2.2);
const shortT = (t) => (t.length > 30 ? t.slice(0, 29) + '…' : t);
let dragged = false;

function layoutGraph() {
  const { nodes, edges } = D.graph;
  G.deg = {}; for (const e of edges) { G.deg[e.a] = (G.deg[e.a] || 0) + 1; G.deg[e.b] = (G.deg[e.b] || 0) + 1; }
  if (!nodes.find((n) => n.id === st.gsel)) st.gsel = nodes.length ? nodes.slice().sort((a, b) => (G.deg[b.id] || 0) - (G.deg[a.id] || 0))[0].id : null;
  const sig = nodes.map((n) => n.id).join(',') + '|' + edges.map((e) => e.a + '-' + e.b).join(',');
  if (sig === G.sig) return;
  G.sig = sig;
  G.labels = nodes.length <= 40;
  const old = G.by || {};
  G.N = nodes.map((n, i) => {
    const r = nodeR(n.id), o = old[n.id], a = i * 2.39996, d = 16 * Math.sqrt(i + 0.5);
    return { id: n.id, r, x: o ? o.x : Math.cos(a) * d, y: o ? o.y : Math.sin(a) * d, vx: 0, vy: 0, fx: null, fy: null,
      hw: Math.max(r, G.labels ? shortT(n.title).length * 3.3 : 0) + 12, hh: r + (G.labels ? 17 : 8) };
  });
  G.by = Object.fromEntries(G.N.map((n) => [n.id, n]));
  G.E = edges.map((e) => [G.by[e.a], G.by[e.b]]);
  G.alpha = 1; G.userView = false; G.fresh = true;
  if (REDUCED) while (G.alpha > 0.004) tick();
  G.vb = targetVb();
}

function tick() {
  const N = G.N, a = G.alpha;
  for (let i = 0; i < N.length; i++) for (let j = i + 1; j < N.length; j++) { // repulsión
    const p = N[i], q = N[j]; let dx = q.x - p.x, dy = q.y - p.y, d2 = dx * dx + dy * dy;
    if (d2 < 1) { dx = (i + j) % 2 ? 1 : -1; dy = 0.5; d2 = 1.25; }
    const k = (420 * a) / d2; p.vx -= dx * k; p.vy -= dy * k; q.vx += dx * k; q.vy += dy * k;
  }
  for (const [p, q] of G.E) { // enlaces como muelles
    const dx = q.x - p.x, dy = q.y - p.y, d = Math.sqrt(dx * dx + dy * dy) || 1, l = ((d - 150) / d) * a * 0.25;
    p.vx += dx * l; p.vy += dy * l; q.vx -= dx * l; q.vy -= dy * l;
  }
  for (const p of N) { // gravedad al centro + integración
    p.vx -= p.x * 0.022 * a; p.vy -= p.y * 0.034 * a;
    if (p.fx != null) { p.x = p.fx; p.y = p.fy; p.vx = p.vy = 0; } else { p.vx *= 0.6; p.vy *= 0.6; p.x += p.vx; p.y += p.vy; }
  }
  for (let it = 0; it < 3; it++) for (let i = 0; i < N.length; i++) for (let j = i + 1; j < N.length; j++) { // cajas sin solape
    const p = N[i], q = N[j], dx = q.x - p.x, dy = q.y - p.y, ox = p.hw + q.hw - Math.abs(dx), oy = p.hh + q.hh - Math.abs(dy);
    if (ox <= 0 || oy <= 0) continue;
    const pf = p.fx != null, qf = q.fx != null; if (pf && qf) continue;
    const wp = pf ? 0 : qf ? 1 : 0.5, wq = 1 - wp;
    if (ox < oy) { const s = dx < 0 ? -ox : ox; p.x -= s * wp; q.x += s * wq; } else { const s = dy < 0 ? -oy : oy; p.y -= s * wp; q.y += s * wq; }
  }
  G.alpha += (0 - a) * 0.025;
}

function targetVb() {
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  for (const n of G.N) { x0 = Math.min(x0, n.x - n.hw); x1 = Math.max(x1, n.x + n.hw); y0 = Math.min(y0, n.y - n.r - 12); y1 = Math.max(y1, n.y + n.r + 30); }
  if (!G.N.length) return { x: -350, y: -220, w: 700, h: 440 };
  const w = Math.max(x1 - x0 + 160, 700), h = Math.max(y1 - y0 + 150, 440);
  return { x: (x0 + x1) / 2 - w / 2, y: (y0 + y1) / 2 - h / 2, w, h };
}
function setVb() { const s = $('#gsvg'), v = G.vb; if (s) s.setAttribute('viewBox', `${v.x.toFixed(1)} ${v.y.toFixed(1)} ${v.w.toFixed(1)} ${v.h.toFixed(1)}`); }
function fitView(now) {
  const t = targetVb(), v = G.vb;
  if (now || !v) G.vb = t; else for (const k of ['x', 'y', 'w', 'h']) v[k] += (t[k] - v[k]) * 0.14;
  setVb();
}
function paint() {
  if (!$('#gsvg')) return;
  for (const n of G.N) { const el = G.elN[n.id]; if (el) el.setAttribute('transform', `translate(${n.x.toFixed(1)} ${n.y.toFixed(1)})`); }
  G.elL.forEach((l, i) => { const [p, q] = G.E[i]; l.setAttribute('x1', p.x.toFixed(1)); l.setAttribute('y1', p.y.toFixed(1)); l.setAttribute('x2', q.x.toFixed(1)); l.setAttribute('y2', q.y.toFixed(1)); });
  if (!G.userView) fitView();
}
function startSim() {
  if (G.raf || REDUCED) return;
  const step = () => {
    if (!$('#gsvg') || st.view !== 'grafo') { G.raf = 0; return; }
    tick(); tick(); paint();
    G.raf = G.alpha > 0.004 || G.drag ? requestAnimationFrame(step) : 0;
    if (!G.raf && !G.userView) fitView(true);
  };
  G.raf = requestAnimationFrame(step);
}

function grafo() {
  const g = D.graph; if (!g) return '';
  if (!g.nodes.length) return '<div class="pad"><div class="card state"><div class="eyebrow">Grafo vacío</div><p style="margin-top:10px">No hay memorias que mostrar para este proyecto.</p></div></div>';
  const sel = g.nodes.find((n) => n.id === st.gsel) || g.nodes[0];
  const near = new Set([sel.id]); for (const e of g.edges) { if (e.a === sel.id) near.add(e.b); if (e.b === sel.id) near.add(e.a); }
  const ln = g.edges.map((e) => {
    const hot = e.a === sel.id || e.b === sel.id, p = G.by[e.a], q = G.by[e.b];
    return `<line class="${hot ? 'hot' : ''}" x1="${p.x.toFixed(1)}" y1="${p.y.toFixed(1)}" x2="${q.x.toFixed(1)}" y2="${q.y.toFixed(1)}" stroke="${hot ? '#ea1889' : 'rgba(255,255,255,.13)'}" stroke-width="${hot ? 1.6 : 1}"${hot || e.kind === 'relation' ? '' : ` stroke-dasharray="${e.kind === 'topic' ? '5 4' : '2 5'}"`}><title>${esc(e.label || '')}</title></line>`;
  }).join('');
  const nd = g.nodes.map((m, i) => {
    const p = G.by[m.id], on = m.id === sel.id, c = tinfo(m.type)[1], show = G.labels || near.has(m.id);
    return `<g class="node ${on ? 'on' : ''}" data-gsel="${m.id}" transform="translate(${p.x.toFixed(1)} ${p.y.toFixed(1)})" opacity="${near.has(m.id) ? 1 : 0.6}" style="animation-delay:${Math.min(i * 25, 600)}ms">${on ? `<circle class="halo" r="${p.r + 9}" fill="none" stroke="${c}"/>` : ''}<circle class="c" r="${p.r}" fill="color-mix(in srgb,${c} ${on ? 90 : 35}%,#111113)" stroke="${c}" stroke-width="1.5"><title>${esc(m.title)}</title></circle>${show ? `<text y="${p.r + 16}" text-anchor="middle">${esc(shortT(m.title))}</text>` : ''}</g>`;
  }).join('');
  const types = [...new Set(g.nodes.map((n) => n.type))].slice(0, 8);
  const v = G.vb, rels = g.edges.filter((e) => e.a === sel.id || e.b === sel.id).length;
  return `<div class="graph"><svg id="gsvg" viewBox="${v.x.toFixed(1)} ${v.y.toFixed(1)} ${v.w.toFixed(1)} ${v.h.toFixed(1)}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Grafo de memorias relacionadas">${ln}${nd}</svg>
   <div class="hint"><div class="eyebrow">Grafo</div><div class="sec" style="margin-top:4px">${plural(g.nodes.length, 'memoria', 'memorias')} · arrastra un nodo para moverlo · rueda para acercar</div><div class="mono muted" style="font-size:11px;margin-top:4px">línea continua: relación · discontinua: mismo tema · punteada: misma sesión</div></div>
   <div class="legend">${types.map(tag).join('')}</div>
   <div class="zoom"><button data-zoom="in" aria-label="Acercar">+</button><button data-zoom="out" aria-label="Alejar">−</button><button data-zoom="fit" aria-label="Ajustar a la vista">⤢</button></div>
   <div class="card peek"><div style="display:flex;gap:8px;align-items:center;margin-bottom:10px">${tag(sel.type)}<span class="mono muted" style="font-size:11px;margin-left:auto">${fmt(sel.created_at)}</span></div>
     <div style="font-weight:700;font-size:16px;letter-spacing:-.02em;margin-bottom:6px">${esc(sel.title)}</div>
     <div class="mono muted" style="font-size:11px;margin-bottom:14px">${esc(sel.project || 'sin proyecto')} · ${plural(rels, 'conexión', 'conexiones')}${sel.topic_key ? ' · ' + esc(sel.topic_key) : ''}</div>
     <button class="btn" data-mem="${sel.id}">Abrir memoria</button></div></div>`;
}

function zoom(f, cx = 0.5, cy = 0.5) {
  const v = G.vb, t = targetVb(), w = Math.max(260, Math.min(t.w * 2.5, v.w * f)), h = v.h * (w / v.w);
  v.x += (v.w - w) * cx; v.y += (v.h - h) * cy; v.w = w; v.h = h; G.userView = true; setVb();
}
function svgPt(e) { const m = $('#gsvg').getScreenCTM().inverse(); return { x: e.clientX * m.a + m.e, y: e.clientY * m.d + m.f }; }
function bindGraph() {
  const s = $('#gsvg'); if (!s) return;
  G.elN = {}; s.querySelectorAll('.node').forEach((el) => (G.elN[el.dataset.gsel] = el));
  G.elL = [...s.querySelectorAll('line')];
  if (G.fresh) { s.classList.add('enter'); G.fresh = false; }
  s.addEventListener('wheel', (e) => { e.preventDefault(); const r = s.getBoundingClientRect(); zoom(e.deltaY > 0 ? 1.12 : 0.89, (e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height); }, { passive: false });
  s.addEventListener('pointerdown', (e) => {
    dragged = false;
    const g = e.target.closest('.node'), p = svgPt(e), n = g && G.by[g.dataset.gsel];
    G.drag = n ? { n, dx: n.x - p.x, dy: n.y - p.y, sx: e.clientX, sy: e.clientY } : { sx: e.clientX, sy: e.clientY, vx: G.vb.x, vy: G.vb.y };
  });
  if (G.alpha > 0.004) startSim(); else paint();
}
window.addEventListener('pointermove', (e) => {
  const d = G.drag, s = $('#gsvg'); if (!d || !s) return;
  if (!dragged && Math.hypot(e.clientX - d.sx, e.clientY - d.sy) < 4) return;
  dragged = true; s.classList.add('drag');
  if (d.n) { const p = svgPt(e); d.n.fx = p.x + d.dx; d.n.fy = p.y + d.dy; G.alpha = Math.max(G.alpha, 0.25); G.userView = true; startSim(); if (REDUCED) { tick(); paint(); } }
  else { const r = s.getBoundingClientRect(), k = Math.max(G.vb.w / r.width, G.vb.h / r.height); G.vb.x = d.vx - (e.clientX - d.sx) * k; G.vb.y = d.vy - (e.clientY - d.sy) * k; G.userView = true; setVb(); }
});
window.addEventListener('pointerup', () => {
  const d = G.drag; if (!d) return;
  if (d.n) { d.n.fx = d.n.fy = null; G.alpha = Math.max(G.alpha, 0.1); }
  G.drag = null; const s = $('#gsvg'); if (s) s.classList.remove('drag');
});

// ---------- render y eventos ----------
const VIEWS = { resumen, memorias, sesiones, grafo };
function render(keep) {
  chrome();
  const v = $('#view'), rows = v.querySelector('.rows'), det = v.querySelector('.detail');
  const sc = keep ? { v: v.scrollTop, r: rows ? rows.scrollTop : 0, d: det ? det.scrollTop : 0 } : null;
  v.innerHTML = stateCard() || VIEWS[st.view]();
  if (sc) { v.scrollTop = sc.v; const r = v.querySelector('.rows'), d = v.querySelector('.detail'); if (r) r.scrollTop = sc.r; if (d && keep === 'all') d.scrollTop = sc.d; }
  else v.scrollTop = 0;
  if (st.view === 'grafo') bindGraph();
}
function url() {
  const id = st.view === 'memorias' ? st.sel : st.view === 'grafo' ? st.gsel : null;
  return `#/${st.view}${id != null ? '/' + id : ''}`;
}
function go(push) { if (push && location.hash !== url()) history.pushState(null, '', url()); else history.replaceState(null, '', url()); }
function parse() {
  const [, v, id] = location.hash.split('/');
  if (VIEWS[v]) st.view = v;
  if (id && st.view === 'memorias') { st.sel = Number(id); st.force = true; }
  if (id && st.view === 'grafo') st.gsel = Number(id);
}

document.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-view],[data-proj],[data-type],[data-mem],[data-gsel],[data-graph],[data-ver],[data-zoom]');
  if (!b) return;
  const d = b.dataset;
  if ('zoom' in d) { if (d.zoom === 'fit') { G.userView = false; fitView(true); } else zoom(d.zoom === 'in' ? 0.8 : 1.25); return; }
  if ('ver' in d) { st.ver = Number(d.ver); return render('all'); }
  if ('gsel' in d) { if (dragged) return; st.gsel = Number(d.gsel); go(); return render(true); }
  if ('graph' in d) { st.gsel = Number(d.graph); st.view = 'grafo'; go(true); return refresh(); }
  if ('mem' in d) {
    const same = st.view === 'memorias';
    st.sel = Number(d.mem); st.ver = 0; st.force = true; st.view = 'memorias';
    if (!same) { st.type = ''; st.q = ''; $('#q').value = ''; }
    go(true); return refresh(same);
  }
  if ('type' in d) { st.type = d.type; st.force = false; return refresh(); }
  if ('proj' in d) { const i = Number(d.proj); st.proj = i < 0 ? null : D.meta.projects[i].project; st.force = false; st.type = ''; return refresh(); }
  if ('view' in d) { st.view = d.view; go(true); return refresh(); }
});
let qt = null;
$('#q').addEventListener('input', (e) => {
  clearTimeout(qt);
  qt = setTimeout(() => { st.q = e.target.value.trim(); st.force = false; if (st.view !== 'memorias') { st.view = 'memorias'; go(true); } refresh(); }, 180);
});
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); $('#q').focus(); $('#q').select(); }
  if (e.key === 'Escape' && document.activeElement === $('#q') && $('#q').value) { $('#q').value = ''; st.q = ''; refresh(); }
});
window.addEventListener('popstate', () => { parse(); refresh(); });

// actualización en vivo: el servidor avisa cuando cambia engram.db
try {
  const es = new EventSource('/api/events');
  let t = null;
  es.addEventListener('change', () => { clearTimeout(t); t = setTimeout(() => refresh('all'), 300); });
  es.onerror = () => { if (D.live) { D.live = false; chrome(); } };
  es.onopen = () => { if (!D.live) refresh('all'); };
} catch {}

parse();
refresh().then(() => go());

// ---------- luz del puntero ----------
(() => {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches || matchMedia('(hover: none)').matches) return;
  const glow = document.createElement('div'); glow.id = 'glow'; document.body.appendChild(glow);
  let x = 0, y = 0, queued = false;
  const paintGlow = () => {
    queued = false;
    glow.style.transform = `translate3d(${x}px,${y}px,0)`;
    for (const el of document.querySelectorAll('.card,.term')) { // posición del puntero relativa a cada tarjeta
      const r = el.getBoundingClientRect();
      if (x < r.left - 280 || x > r.right + 280 || y < r.top - 280 || y > r.bottom + 280) { el.style.removeProperty('--mx'); el.style.removeProperty('--my'); continue; }
      el.style.setProperty('--mx', `${x - r.left}px`); el.style.setProperty('--my', `${y - r.top}px`);
    }
  };
  window.addEventListener('pointermove', (e) => { x = e.clientX; y = e.clientY; glow.classList.add('on'); if (!queued) { queued = true; requestAnimationFrame(paintGlow); } }, { passive: true });
  document.addEventListener('pointerleave', () => glow.classList.remove('on'));
  window.addEventListener('blur', () => glow.classList.remove('on'));
})();
