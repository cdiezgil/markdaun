# MarkDaun

**El editor de Markdown donde tus notas echan raíces.**

MarkDaun une un editor de Markdown sereno con un segundo cerebro al estilo de Karpathy: notas que se enlazan, crecen y se ordenan solas. La identidad parte del nombre: *Mark* (de Markdown) y *Daun*, que en malayo e indonesio significa **hoja**. Una hoja es la unidad perfecta para una nota: pequeña, autónoma y conectada por nervios a algo mayor. Y su nervio central apunta hacia abajo, como la flecha ↓ del logotipo histórico de Markdown.

## Principios

1. **Papel antes que interfaz.** El texto es el protagonista. La interfaz usa `ink-muted`, filetes `line` de 1px y casi ningún color; el verde aparece solo donde hay significado (enlaces, acción principal, foco).
2. **Orgánico pero preciso.** Calidez vegetal en la paleta y la serif de display; rigor técnico en la mono del editor y en una retícula de 4px.
3. **Un solo acento vivo.** `sap` (savia, lima) es el color que la gente recuerda del icono. En la interfaz se usa con moderación: etiquetas, novedad, momentos de marca. Nunca como color de texto.
4. **Líneas, no sombras.** Los paneles se separan con `line`. La única sombra, `shadow-pop`, es para lo que flota.

## Icono

El icono es una hoja lima (`sap` oscuro, #C6E86B) sobre un cuadrado redondeado de humus (`humus`, #14201B), con radio `radius-icon` (230/1024). El nervio central es una **flecha ↓** —el guiño a Markdown— y dos nervios laterales terminan en **nodos**: las notas enlazadas del segundo cerebro. Las tres ideas (hoja, Markdown, grafo) en una sola silueta legible a 16px.

Construcción sobre lienzo de 1024: hoja de 200 a 868 en vertical, rabillo de 36 de grosor; nervio y flecha de 46; nervios laterales de 30; nodos de radio 27. Los nervios son recortes (color del fondo), no trazos añadidos.

Variantes (grupo **Icono** y **Marca** en Assets):
- `app-icon.svg` — principal. App store, dock, escritorio. Funciona en fondos claros y oscuros.
- `app-icon-light.svg` — hoja `daun` (#2E6A4F) sobre papel (#F7F5EF). Solo para contextos donde el icono oscuro choca (p. ej. documentación impresa).
- `mark.svg` — símbolo monocromo sin fondo, en `ink` (#1A2420). Favicon, marca de agua, sellos. Puede reteñirse a un solo color sólido; nunca degradados.

Zona de respeto: un 12,5% del lado del icono alrededor. No rotar, no contornear, no añadir sombra, no cambiar los colores fuera de estas tres variantes.

## Logotipo

El logotipo es tipográfico: **Mark***Daun* — "Mark" en Instrument Serif regular y "Daun" en Instrument Serif itálica, mismo cuerpo, sin espacio, color `ink`. El símbolo va a la izquierda, alto igual a la altura de las mayúsculas × 1,4, separado por 0,35× esa altura. En tamaños inferiores a 20px se usa solo el símbolo.

## Color

Dos temas: **Papel** (claro) y **Humus** (oscuro). Todos los textos cumplen ≥4.5:1 en todos los fondos de su tema.

| Rol | Token | Regla |
|---|---|---|
| Fondo | `bg`, `surface`, `surface-sunken` | Lienzo, flotantes, lateral. Nunca blanco puro ni negro puro. |
| Texto | `ink`, `ink-muted` | `ink-muted` también colorea la sintaxis Markdown (`#`, `**`, `>`), para que el contenido destaque sobre el marcado. |
| Marca | `daun`, `daun-strong`, `on-daun` | Enlaces `[[wiki]]`, botón principal, selección activa en lateral. |
| Acento | `sap`, `on-sap` | Chips de `#etiqueta`, punto de nota nueva, splash. |
| Resaltado | `mark`, `selection` | `==resaltado==`, búsqueda, selección. |
| Estados | `amber`, `danger` | Ámbar para enlace roto/nota huérfana; rojo solo para borrar. Se distinguen por luminosidad, no solo por tono. |

Proporción orientativa en pantalla: 85% neutros, 10% `daun`, 4% `sap`, 1% estados.

## Tipografía

Tres familias, todas libres en Google Fonts:

- **Instrument Serif** (`display`) — elegancia editorial. Títulos grandes, H1 renderizado, logotipo. Nunca por debajo de 24px.
- **Geist** (`sans`) — la interfaz: menús, paneles, botones, y el cuerpo de la vista de lectura.
- **Geist Mono** (`mono`) — el editor. La mono alinea la sintaxis Markdown y da ritmo de escritura constante; sigue la tradición de los editores de escritura enfocada.

Reglas: cuerpo del editor 15/26 con medida `measure` (88ch). Interfaz a 13–14px. Pesos solo 400, 500 y 600. Itálica de Instrument Serif para un único acento por pantalla.

## Espacio y forma

Retícula de 4px (`space-1` … `space-16`). Interfaz densa (`space-2`/`space-3`), lienzo generoso (`space-12` arriba, `space-8` laterales mínimos). Radios suaves y contenidos: `radius-sm` en chips, `radius-md` en botones, `radius-lg` en flotantes; `radius-pill` solo para contadores.

## Iconografía de interfaz

Iconos lineales de 1.5px de trazo en cuadrícula de 20px, terminaciones redondeadas (coherentes con los nervios del símbolo), en `ink-muted`; `daun` cuando están activos. Recomendado: Lucide, ajustando `stroke-width` a 1.5.

## Movimiento

Discreto y vegetal: 160ms `cubic-bezier(.2,.7,.2,1)` para paneles; 240ms para la paleta de comandos. Nada rebota.

## Voz

Calmada, concreta, en segunda persona. Metáforas vegetales con mesura ("tus notas echan raíces", "esta nota está huérfana"), nunca en mensajes de error. Ejemplos: "Nueva nota", "Enlazado desde 4 notas", "Nada por aquí todavía. Escribe la primera hoja."

## Cómo cargar las fuentes

```html
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600&family=Geist+Mono:wght@400;500&family=Instrument+Serif:ital@0;1&display=swap">
```
