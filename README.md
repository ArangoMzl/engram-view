# Engram View

Visor web local, de solo lectura, para la memoria de [Engram](https://engram.gentlemanprogramming.com/).
Lee directamente `engram.db` y muestra las memorias, sesiones y relaciones de forma interactiva.

No es un proyecto oficial de Engram.

## Requisitos

- Node.js 22.13 o superior (usa `node:sqlite`; no hay dependencias que instalar).
- Una base de Engram en `~/.engram/engram.db`, o cualquier otra ruta.

## Uso

```bash
npm start                              # abre el visor sobre ~/.engram/engram.db
npm run demo                           # datos de demostración
npm run app                            # ventana propia, servidor en segundo plano
node server.mjs --db "ruta/engram.db"  # otra base
```

Opciones de `server.mjs`: `--db <ruta>`, `--port <n>` (7438 por defecto), `--no-open`, `--demo`,
`--app` (se apaga solo al cerrar la ventana). También respeta `ENGRAM_DB` y `ENGRAM_DATA_DIR`.

## Vistas

- **Resumen:** totales, actividad por día, reparto por tipo y última sesión.
- **Memorias:** búsqueda de texto completo, filtros por proyecto y tipo, detalle con historial de versiones y diff.
- **Sesiones:** línea de tiempo con el resumen, los prompts y las memorias de cada sesión.
- **Grafo:** memorias conectadas por relación, tema y sesión; animado, con arrastre y zoom.

El visor se actualiza solo cuando Engram guarda algo nuevo.

## Solo lectura

La base se abre en modo de solo lectura y el servidor rechaza cualquier petición que no sea `GET`.
Engram mantiene índices de búsqueda, versiones y una cola de sincronización, así que cualquier
edición debe hacerse a través del propio Engram, nunca escribiendo en el archivo.

## Estructura

- `server.mjs` — servidor HTTP y API JSON.
- `launch.mjs` — lanzador en modo aplicación (para un acceso directo).
- `seed.mjs` — genera la base de demostración.
- `public/` — interfaz (HTML, CSS y JavaScript sin compilación).
- `design/` — maqueta estática original.
