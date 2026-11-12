# Engram View

Visor web local, de solo lectura, para la memoria de [Engram](https://engram.gentlemanprogramming.com/).
Lee directamente `engram.db` y muestra las memorias, sesiones y relaciones de forma interactiva.

No es un proyecto oficial de Engram.

## Instalación (aplicación de escritorio)

Descarga `Engram View-Setup-<versión>.exe` desde [Releases](https://github.com/ArangoMzl/engram-view/releases)
y ejecútalo. El instalador crea el acceso directo en el escritorio y en el menú Inicio, y no necesita
Node.js. También hay una versión portable (`Engram View-<versión>-portable.exe`) que no se instala.

La app abre su propia ventana en el monitor donde está el ratón, usa un puerto libre (no choca con otras
instancias) y, si ya está abierta, al lanzarla de nuevo trae al frente la ventana existente.
Lee la base de Engram en `~/.engram/engram.db` (o la indicada en `ENGRAM_DB` / `ENGRAM_DATA_DIR`).

Windows SmartScreen puede avisar porque el ejecutable no está firmado: *Más información → Ejecutar de todas formas*.

## Desarrollo

Requisitos: Node.js 22.13 o superior (usa `node:sqlite`).

```bash
npm install                            # Electron y electron-builder (solo para la app de escritorio)
npm run desktop                        # app de escritorio en modo desarrollo
npm run dist                           # genera instalador y portable en dist/
npm start                              # solo servidor; abre el visor en el navegador
npm run demo                           # servidor con datos de demostración
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
- `electron/main.mjs` — aplicación de escritorio (ventana propia + servidor interno).
- `seed.mjs` — genera la base de demostración.
- `public/` — interfaz (HTML, CSS y JavaScript sin compilación).
- `design/` — maqueta estática original.
