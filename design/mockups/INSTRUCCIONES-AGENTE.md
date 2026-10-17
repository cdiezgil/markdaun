# Tarea: ajustar la UI de MarkDaun al design system

Fuente de verdad: `design-system/README.md`, `design-system/tokens.css`, `design-system/tokens.json`.
Referencia visual: `mockups/editor.html`, `mockups/brain.html`, `mockups/grafo.html` (ábrelos en el navegador).
No cambies funcionalidad. Solo estilos, estructura visual y markup de presentación.

## Reglas globales (obligatorias)
- Importa `tokens.css` una sola vez en la raíz. Usa SIEMPRE variables CSS (`var(--daun)`, `var(--space-4)`…). Prohibido escribir hex, px de radio o font-family sueltos en componentes.
- Carga las fuentes con el <link> de Google Fonts del README.
- `body { font-family: var(--font-sans); color: var(--ink); background: var(--bg); }`. Ningún elemento de interfaz puede heredar una serif. Busca y elimina cualquier `font-family: serif`, `Times` o Instrument Serif fuera de títulos.
- Instrument Serif (`--font-display`) SOLO en: H1 del documento, títulos de tarjetas de nota y logotipo. Siempre `font-weight: 400`. Nunca negrita.
- Pesos permitidos: 400, 500, 600. Iconos: Lucide, `stroke-width={1.5}`, 16–18px, color `--ink-muted`; `--daun` solo si están activos.
- El verde (`--daun`) significa "activo / enlace / acción principal". Si un elemento no es nada de eso, no puede ser verde.
- Separa paneles con `1px solid var(--line)`. La única sombra es `--shadow-pop`, y solo para elementos flotantes.
- Elimina el marco/padding exterior de la ventana: la app ocupa todo el viewport.
- Scrollbars finos: 8px, thumb `--line-strong`, track transparente.
- Respeta tema oscuro: todo debe verse bien con `data-theme="dark"`.

## Estructura común
- Barra superior 48px, fondo `--surface-sunken`, borde inferior `--line`: símbolo + logotipo "Mark*Daun*" (Instrument Serif 19px, "Daun" en itálica), pestañas Notas / Grafo / Brain como control segmentado (activa: fondo `--bg`, borde interior `--line`, icono `--daun`; inactivas: `--ink-muted`), y a la derecha un campo "Buscar o ejecutar… ⌘K" de 280px.
- Barra lateral 264px, fondo `--surface-sunken`:
  - Cabecera: etiqueta "BÓVEDA" (12px, 500, mayúsculas, tracking 0.04em, `--ink-muted`) + botones icono Nueva nota / Nueva carpeta.
  - Árbol: Geist 14px, `--ink`, altura de fila 32px, radio `--radius-md`. Ocultar extensión `.md`. Iconos `--ink-muted`.
  - Nota activa: fondo `--bg`, texto e icono `--daun`, peso 500.
  - Pie: "N notas · N carpetas" (12px, `--ink-muted`) + botón Ajustes, separado por borde superior `--line`.
- Barra de estado 30px, `--surface-sunken`, 12px `--ink-muted`; punto verde de 6px antes de "Guardado".

## Editor
- Barra de formato: misma anchura y alineación que la columna de texto (`max-width: var(--measure)`, centrada), botones fantasma de 32px, separadores verticales de 1px `--line` entre grupos (títulos | estilo | bloques | inserción). Ningún icono en verde salvo el formato activo en el cursor.
- Columna del documento centrada, `max-width: var(--measure)`, `padding-top: var(--space-12)`.
- Encima del título: ruta y hora en `caption` `--ink-muted`.
- H1: estilo `reading-h1` (Instrument Serif 400, 40/46). H2/H3 en Geist 600.
- Cuerpo: estilo `editor` (Geist Mono 15/26).
- Bloque de código: `--surface-sunken`, `--radius-md`, padding 16×20, estilo `code`.
- Cita: borde izquierdo 2px `--line-strong`, texto `--ink-muted`.
- [[wikilinks]]: `--daun`, 500, subrayado 1px; rotos: `--amber` discontinuo. #etiquetas: chip `--sap`/`--on-sap`, `--radius-sm`.
- Al final de la nota: sección "Enlazada desde" con contador pill y chips de backlink (fondo `--surface`, borde `--line`, radio `--radius-md`).
- El nombre de archivo de una nota nueva se toma del H1 (no timestamps).

## Brain
- Elimina la columna intermedia de conversaciones: cuando la vista es Brain, la barra lateral muestra botón primario "Nueva conversación" (ancho completo), buscador y lista agrupada por día (título 14px + hora 12px `--ink-muted`).
- Hilo centrado, `max-width: 720px`, gap 28px entre mensajes.
- Mensaje del usuario: alineado a la derecha, fondo `--daun`, texto `--on-daun`, radio 16px con la esquina inferior derecha a 6px, máx. 70% de ancho.
- Respuesta del asistente: SIN burbuja. Etiqueta "Brain" con icono hoja (12px `--ink-muted`), y el contenido Markdown RENDERIZADO con los estilos de lectura (Geist 15/26). Nunca mostrar `**`, `>` o ``` crudos.
- Contenido de notas citadas: tarjeta `--surface`, borde `--line`, `--radius-lg`.
- Debajo de cada respuesta, una fila: "Fuentes" + chips de nota (icono archivo `--daun`, borde `--line`, radio 8px) y a la derecha botón fantasma "Guardar como nota".
- Compositor flotante: `--surface`, borde `--line`, `--radius-lg`, `--shadow-pop`, ancho 720px centrado, margen inferior 24px. Textarea sin borde. Fila inferior: chip de contexto "@ Toda la bóveda" (pill) y botón Enviar circular de 36px `--daun` con flecha arriba blanca, DENTRO del compositor. Debajo, nota en `caption`: "Brain responde a partir de tus notas y cita siempre sus fuentes."

## Grafo
- Fondo `--bg` con rejilla de puntos `--line` cada 24px.
- Nodos: círculos `--daun` sin tarjeta ni borde izquierdo; diámetro 12–28px según número de backlinks. Etiqueta debajo (12px `--ink`, fondo `--bg`).
- Nota abierta: anillo de 5px `--sap` y etiqueta 600 13px.
- Huérfanas: círculo hueco con borde 2px `--amber` y etiqueta `--amber`.
- Aristas: 1px `--line-strong` al 45% de opacidad; las de la nota abierta, 1.5px `--daun` al 100%.
- Carpetas: halo muy sutil (`--daun` al 5%) con etiqueta en mayúsculas 11px `--ink-muted`. Eliminar el contenedor gris "root".
- Layout de fuerzas (d3-force o equivalente), sin solapamientos.
- Arriba izquierda, panel flotante (`--surface`, `--radius-lg`, `--shadow-pop`): buscador + chips de filtro Enlaces / Etiquetas / Huérfanas (activo: fondo `--mark`, borde `--daun`).
- Arriba derecha, tarjeta de la nota seleccionada (300px): ruta, título en Instrument Serif 28px, extracto en mono `--ink-muted`, contadores, botones "Abrir nota" (primario) y "Preguntar" (secundario, abre Brain).
- Abajo derecha, una sola cápsula de zoom: − / 100% / + / Ajustar. Sustituye los controles por defecto de React Flow.
- Abajo izquierda, leyenda (Nota, Huérfana, Abierta). Mantén la atribución "React Flow" salvo que haya licencia Pro, en 12px `--ink-muted`.

## Criterios de aceptación
- Cero fuentes serif del sistema en la UI (revisar con DevTools > Computed).
- Cero valores de color/radio/fuente literales en componentes (grep de `#` y `px` en radios).
- Contraste ≥ 4.5:1 en texto en ambos temas.
- Las tres pantallas coinciden visualmente con los mockups de referencia.
- Funcionalidad intacta.
