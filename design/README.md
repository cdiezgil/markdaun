# MarkDaun — sistema de diseño

**El editor de Markdown donde tus notas echan raíces.** MarkDaun forma parte del ecosistema **cdiezgil** y hereda su identidad: Azul Marino, Oro, Gris Técnico, Geist, retícula de 8pt y texturas de la casa.

| Fichero | Contenido |
|---|---|
| [`cdiezgil.md`](cdiezgil.md) | **Manual de marca** (vinculante): arquitectura de marca, principios, color, tipografía, símbolo, logotipo, sello, texturas, forma, movimiento y voz. Léelo completo antes de cualquier trabajo visual. |
| `tokens.json` | Fuente canónica de todos los tokens. |
| `tokens.css` | Variables CSS **generadas** desde `tokens.json` con `npm run tokens`, que también copia el resultado a `public/tokens.css`. No se editan a mano. |
| `components/` | Muestras de referencia (Button, Editor, Wikilink, Loader, Seal) con sus pautas y `bundle.css`. |
| `icons/` | Símbolo, iconos de app, logotipo, sello y bandeja (SVG). |
| `mockups/` | Maquetas históricas de la identidad anterior (Papel/Humus); solo como referencia de layout. |

## Temas

- **Técnico** (claro): fondo blanco y texto Azul Marino `#0A1122`.
- **Marino** (oscuro): fondo `#0A1122` y superficies `#1A2235`.

El tema se activa con `data-theme="light|dark"` en `<html>` o, si no se fija, con `prefers-color-scheme`.

## Cómo cargar las fuentes

```html
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Geist:wght@300;400;500;700&family=Geist+Mono:wght@400;500&family=Instrument+Serif&display=swap">
```

## Cambiar un token

1. Edita `tokens.json`.
2. Ejecuta `npm run tokens`.
3. Ejecuta `npx vitest run src/styles`: los tests comprueban que el CSS está regenerado y que los contrastes siguen siendo ≥4,5:1.
