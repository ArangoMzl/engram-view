// Crea una base de demostración con el mismo esquema que usa Engram (solo las tablas que lee el visor).
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

const ts = (daysAgo, hh, mm) => {
  const d = new Date(); d.setUTCDate(d.getUTCDate() - daysAgo); d.setUTCHours(hh, mm, 0, 0);
  return d.toISOString().slice(0, 19).replace('T', ' ');
};
const body = (what, why, where, learned) => `**What**: ${what}\n\n**Why**: ${why}\n\n**Where**: ${where}\n\n**Learned**: ${learned}`;

// [id, type, project, session, díasAtrás, hh, mm, fijada, tema, título, what, why, where, learned]
const MEM = [
  [1, 'bugfix', 'tienda-api', 's5', 1, 21, 40, 1, 'orders/performance', 'N+1 en el listado de pedidos',
    'El endpoint `GET /orders` lanzaba una consulta por pedido para traer el cliente. Se añadió carga anticipada en `OrderRepository.findAll`.',
    'El panel de administración tardaba 1,8 s en cargar 200 pedidos; con la carga anticipada baja a 140 ms.',
    '`src/orders/order.repository.ts`, `src/orders/orders.controller.ts`',
    'Revisar siempre las relaciones al paginar. El log de consultas en desarrollo lo habría detectado antes.'],
  [2, 'decision', 'tienda-api', 's5', 1, 22, 15, 1, 'orm/migration', 'Migrar de TypeORM a Prisma por módulos',
    'Se migra el acceso a datos a Prisma, módulo por módulo, empezando por pedidos.',
    'Tipado más estricto en las consultas y migraciones más predecibles. Los N+1 recientes salieron de relaciones perezosas implícitas.',
    '`src/orders/`, `prisma/schema.prisma`', 'Mantener ambos ORM en paralelo es viable si comparten el pool de conexiones.'],
  [3, 'discovery', 'portal-web', 's4', 2, 18, 52, 0, 'build/node26', 'El build falla en Node 26 por sharp',
    '`sharp@0.32` no publica binarios para Node 26 en Windows. Subir a `0.34` lo resuelve sin tocar código.',
    'El build pasaba en CI (Node 22) pero no en local.', '`package.json`, `pnpm-lock.yaml`',
    'Fijar la versión de Node en `.nvmrc` y en CI para que coincidan.'],
  [4, 'config', 'tienda-api', 's2', 4, 10, 40, 1, 'db/migrations', 'Convención de nombres para migraciones',
    'Formato `AAAAMMDD_verbo_objeto`. Una migración por cambio de esquema; nunca se edita una ya aplicada.',
    'Había migraciones con nombres genéricos que nadie sabía qué hacían.', '`migrations/`, `docs/db.md`',
    'La convención se valida con un hook de pre-commit.'],
  [5, 'bugfix', 'tienda-api', 's2', 4, 11, 55, 0, 'db/pool', 'El pool de conexiones se agotaba de noche',
    'El worker de facturas abría transacciones que no cerraba al fallar. Se envolvió en `try/finally`.',
    'El servicio dejaba de responder cada madrugada hasta reiniciarlo.', '`src/billing/invoice.worker.ts`',
    'Añadir una alerta cuando el pool supera el 80 % de uso.'],
  [6, 'architecture', 'portal-web', 's4', 2, 19, 20, 0, 'catalog/rendering', 'El catálogo se renderiza en servidor',
    'El listado del catálogo pasa a server components; los filtros siguen siendo componentes de cliente.',
    'Reducir el JavaScript enviado al cliente: de 310 KB a 120 KB en la página de catálogo.',
    '`app/catalog/page.tsx`, `app/catalog/filters.tsx`', 'El estado de los filtros vive en la URL para que el servidor pueda leerlo.'],
  [7, 'pattern', 'tienda-api', 's3', 3, 16, 5, 0, 'errors/result', 'Los servicios devuelven Result, no lanzan',
    'Los servicios de dominio devuelven `Result<T, DomainError>`; solo los controladores traducen a HTTP.',
    'Los errores de negocio se mezclaban con los 500 reales en los logs.', '`src/shared/result.ts`, `src/*/*.service.ts`',
    'Empezar por los servicios nuevos; no vale la pena reescribir los viejos de golpe.'],
  [8, 'architecture', 'tienda-api', 's3', 3, 17, 30, 0, 'modules/boundaries', 'Cada módulo expone solo su fachada',
    'Los módulos se importan entre sí únicamente a través de `index.ts`. Lo demás es privado.',
    'Pedidos importaba repositorios internos de clientes y eso bloqueaba la migración del ORM.',
    '`src/*/index.ts`, `.eslintrc.cjs`', 'Una regla de ESLint con `no-restricted-imports` basta para hacerlo cumplir.'],
  [9, 'discovery', 'tienda-api', 's5', 1, 21, 5, 0, 'orders/performance', 'Falta un índice en orders.customer_id',
    'La tabla `orders` no tiene índice sobre `customer_id`; el plan de ejecución hace un recorrido completo.',
    'Apareció al analizar el N+1 del listado.', '`migrations/20261109_add_orders_customer_idx.sql`',
    'Ejecutar `EXPLAIN` en las consultas del panel antes de cada release.'],
  [10, 'decision', 'portal-web', 's1', 6, 12, 10, 0, 'state/url', 'El estado de filtros vive en la URL',
    'Los filtros y la paginación se guardan en parámetros de la URL, no en un store global.',
    'Los enlaces compartidos deben reproducir la misma vista.', '`app/catalog/use-filters.ts`',
    'Usar `replace` en lugar de `push` para no ensuciar el historial.'],
  [11, 'config', 'portal-web', 's1', 6, 12, 48, 0, 'build/node26', 'Versión de Node fijada en .nvmrc y CI',
    'Se fija Node 22 LTS en `.nvmrc` y en el workflow de CI.', 'Evitar diferencias entre la máquina local y el pipeline.',
    '`.nvmrc`, `.github/workflows/ci.yml`', 'Revisar la versión al cambiar de máquina.'],
  [12, 'pattern', 'tienda-api', 's2', 4, 12, 20, 0, 'db/transactions', 'Transacciones siempre con helper withTx',
    'Toda transacción pasa por `withTx(fn)`, que garantiza el commit o rollback.',
    'Las transacciones manuales sin cerrar causaron el agotamiento del pool.', '`src/shared/db/with-tx.ts`',
    'Prohibir `queryRunner.startTransaction` fuera del helper.'],
];
// [id, proyecto, díasAtrás, hh, mm, duraciónMin, resumen, prompts]
const SES = [
  ['s5', 'tienda-api', 1, 20, 58, 102, 'Diagnóstico del listado de pedidos lento. Se corrigió el N+1, se detectó un índice faltante y se decidió migrar el ORM.',
    ['por qué tarda tanto GET /orders con 200 pedidos?', 'compara prisma con lo que tenemos ahora', 'guarda la decisión y el plan de migración']],
  ['s4', 'portal-web', 2, 18, 30, 55, 'El build fallaba solo en local. Además se rediseñó el renderizado del catálogo.',
    ['el build no pasa en mi máquina pero sí en CI', 'pasemos el catálogo a server components']],
  ['s3', 'tienda-api', 3, 15, 40, 125, 'Limpieza de fronteras entre módulos y patrón de errores para los servicios.',
    ['pedidos importa cosas internas de clientes, ordenemos eso', 'cómo separamos errores de negocio de los 500?']],
  ['s2', 'tienda-api', 4, 10, 5, 130, 'Estabilización del worker de facturas y convenciones de base de datos.',
    ['el worker de facturas cuelga el servicio cada noche', 'definamos cómo nombrar las migraciones']],
  ['s1', 'portal-web', 6, 11, 50, 72, 'Estado de filtros en la URL y versión de Node unificada.',
    ['los filtros se pierden al compartir el enlace']],
];
const REL = [[1, 2, 'related'], [1, 5, 'related'], [2, 4, 'related'], [2, 8, 'related'], [3, 11, 'related'], [6, 10, 'related'], [7, 8, 'related'], [5, 12, 'related']];
// versiones anteriores: [memoria, versión, díasAntes, contenido]
const VER = [
  [1, 1, 2, body('El endpoint `GET /orders` es lento con muchos pedidos.', 'El panel de administración tarda casi 2 s.', '`src/orders/orders.controller.ts`', 'Pendiente de diagnosticar.')],
  [1, 2, 1, body('El endpoint `GET /orders` lanzaba una consulta por pedido para traer el cliente.', 'El panel de administración tardaba 1,8 s en cargar 200 pedidos.', '`src/orders/order.repository.ts`', 'Revisar siempre las relaciones al paginar.')],
  [4, 1, 1, body('Formato `AAAAMMDD_descripcion`.', 'Había migraciones con nombres genéricos.', '`migrations/`', 'Acordarlo con el equipo.')],
  [6, 1, 1, body('El listado del catálogo pasa a server components.', 'Reducir el JavaScript enviado al cliente.', '`app/catalog/page.tsx`', 'Medir el tamaño del bundle antes y después.')],
];

export function createDemo(file) {
  for (const f of [file, file + '-wal', file + '-shm']) fs.rmSync(f, { force: true });
  const db = new DatabaseSync(file);
  db.exec(`
    CREATE TABLE sessions (id TEXT PRIMARY KEY, project TEXT NOT NULL, ownership_mode TEXT, directory TEXT NOT NULL,
      started_at TEXT NOT NULL DEFAULT (datetime('now')), ended_at TEXT, summary TEXT);
    CREATE TABLE observations (id INTEGER PRIMARY KEY AUTOINCREMENT, sync_id TEXT, session_id TEXT NOT NULL, type TEXT NOT NULL,
      title TEXT NOT NULL, content TEXT NOT NULL, tool_name TEXT, project TEXT, scope TEXT NOT NULL DEFAULT 'project', topic_key TEXT,
      normalized_hash TEXT, revision_count INTEGER NOT NULL DEFAULT 1, duplicate_count INTEGER NOT NULL DEFAULT 1, last_seen_at TEXT,
      pinned BOOLEAN NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      deleted_at TEXT);
    CREATE TABLE observation_versions (id INTEGER PRIMARY KEY AUTOINCREMENT, observation_id INTEGER NOT NULL, title TEXT,
      content TEXT NOT NULL, version INTEGER NOT NULL, created_at DATETIME DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE user_prompts (id INTEGER PRIMARY KEY AUTOINCREMENT, sync_id TEXT, session_id TEXT NOT NULL, content TEXT NOT NULL,
      project TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE memory_relations (id INTEGER PRIMARY KEY AUTOINCREMENT, sync_id TEXT NOT NULL UNIQUE, source_id TEXT, target_id TEXT,
      relation TEXT NOT NULL DEFAULT 'pending', reason TEXT, confidence REAL, judgment_status TEXT NOT NULL DEFAULT 'pending', superseded_at TEXT);
    CREATE VIRTUAL TABLE observations_fts USING fts5(title, content, tool_name, type, project, topic_key,
      tokenize='trigram', content='observations', content_rowid='id');
  `);
  const insS = db.prepare('INSERT INTO sessions (id, project, directory, started_at, ended_at, summary) VALUES (?,?,?,?,?,?)');
  const insP = db.prepare('INSERT INTO user_prompts (session_id, content, project, created_at) VALUES (?,?,?,?)');
  for (const [id, p, d, h, m, dur, sum, prompts] of SES) {
    insS.run(id, p, `C:/dev/${p}`, ts(d, h, m), ts(d, h + Math.floor((m + dur) / 60), (m + dur) % 60), sum);
    prompts.forEach((c, i) => insP.run(id, c, p, ts(d, h, m + 2 + i * 9)));
  }
  const revs = Object.fromEntries(MEM.map(m => [m[0], 1 + VER.filter(v => v[0] === m[0]).length]));
  const insO = db.prepare(`INSERT INTO observations (id, sync_id, session_id, type, title, content, tool_name, project, topic_key, revision_count, pinned, created_at, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const insF = db.prepare('INSERT INTO observations_fts (rowid, title, content, tool_name, type, project, topic_key) VALUES (?,?,?,?,?,?,?)');
  const insV = db.prepare('INSERT INTO observation_versions (observation_id, title, content, version, created_at) VALUES (?,?,?,?,?)');
  for (const [id, t, p, s, d, h, mi, pin, topic, title, what, why, where, learned] of MEM) {
    const c = body(what, why, where, learned), at = ts(d, h, mi);
    insO.run(id, `obs-${id}`, s, t, title, c, 'mem_save', p, topic, revs[id], pin, ts(d + revs[id] - 1, h, mi), at);
    insF.run(id, title, c, 'mem_save', t, p, topic);
    for (const [, v, before, vc] of VER.filter(v => v[0] === id)) insV.run(id, title, vc, v, ts(d + before, h, mi));
    if (revs[id] > 1) insV.run(id, title, c, revs[id], at);
  }
  const insR = db.prepare(`INSERT INTO memory_relations (sync_id, source_id, target_id, relation, judgment_status) VALUES (?,?,?,?,'judged')`);
  REL.forEach(([a, b, r], i) => insR.run(`rel-${i}`, `obs-${a}`, `obs-${b}`, r));
  db.close();
}
