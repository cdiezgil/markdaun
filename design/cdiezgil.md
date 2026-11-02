# MarkDaun × cdiezgil — Manual de marca

> Adaptación de la marca personal **cdiezgil** (repositorio `cdiezgil/imagen-marca`) a MarkDaun. Este documento es vinculante para todo trabajo visual y de texto de la app. Los valores exactos viven en `tokens.json`; aquí se explica qué significan y cómo se usan.

---

## 1. Arquitectura de marca

cdiezgil es una **marca monolítica** (*branded house*): todos sus proyectos heredan la misma paleta, la misma tipografía, la misma retícula y las mismas texturas. MarkDaun es un subproyecto más, al mismo nivel que GalopApp y Onzia:

- **MarkDaun tiene símbolo propio** (la hoja, §5) y su propio logotipo.
- **cdiezgil firma como sello de autoría**: `by { cdiezgil }` en la barra de estado, en la ventana *Acerca de* y en el splash. Nunca en la cabecera junto al logotipo de MarkDaun.

### 1.1 Qué es MarkDaun dentro del ecosistema

El denominador común de cdiezgil es **convertir información compleja en interfaces claras, elegantes y accionables**. En GalopApp son datos hípicos; en Onzia, datos de fútbol fantasy; en MarkDaun son **tus propias notas**: un editor WYSIWYG sobre Markdown limpio, un grafo de vínculos y un segundo cerebro con IA.

*Mark* viene de Markdown y *Daun* significa **hoja** en malayo e indonesio. La hoja sigue siendo la unidad de la marca: pequeña, autónoma y unida por nervios a algo mayor.

---

## 2. Principios

1. **El texto manda.** La interfaz es Azul Marino y gris; el color aparece solo cuando significa algo (acción principal, enlace, foco, estado). Aplica la regla 60-30-10 de cdiezgil: 60 % fondos, 30 % Azul Marino (texto, iconos, estructura) y 10 % Oro como máximo.
2. **Precisión de ingeniero.** Retícula de 8pt, filetes de 1px, radios de 8px como máximo, iconos lineales. Todo debe parecer dibujado por un ingeniero de datos, no por un ilustrador.
3. **Un único acento: el Oro.** El Oro marca *la* acción principal de cada vista. Si un usuario de GalopApp o de Onzia ve un botón Oro en MarkDaun, sabe sin pensar que es lo que tiene que pulsar.
4. **Plano y limpio.** Sin degradados, brillos ni relieves. La única sombra (`shadow-pop`) es para lo que flota; nunca en botones, tarjetas ni logotipos.
5. **Las texturas son lenguaje, no decoración.** Cada textura tiene un uso reservado (§6).

---

## 3. Color

### 3.1 Paleta de marca

| Color | HEX | Papel en MarkDaun |
|---|---|---|
| **Azul Marino Oscuro** | `#0A1122` | Lienzo del tema oscuro, texto del tema claro, fondo del icono. Sustituye al negro. |
| **Azul Marino claro** | `#1A2235` | Superficies elevadas del tema oscuro (popovers, tarjetas, bloques de código). |
| **Oro cdiezgil** | `#FFD700` | Acción principal (botón primario) en ambos temas; acento de texto en el tema oscuro. |
| **Gris Técnico** | `#E5E5E5` | Filetes del tema claro, texto `by` del sello, soporte neutro. |

### 3.2 Temas

Cada token sale de la paleta de marca (§3.1), de Blanco o de una mezcla de ambos («Navy al 72 %» quiere decir Navy al 72 % sobre blanco). La tabla completa está en `tokens.json`.

| Tema | Activación | Fondo | Superficie / lateral | Texto | Texto secundario | Acento de texto |
|---|---|---|---|---|---|---|
| **Técnico** (claro) | Ajustes → Apariencia → Claro, o Sistema con el SO en claro | Blanco `#FFFFFF` | Blanco / Gris Técnico al 40 % `#F5F5F5` | Navy `#0A1122` | Navy al 72 % `#4F5460` | Oro oscurecido `#7A5E00` |
| **Marino** (oscuro) | Ajustes → Apariencia → Oscuro, o Sistema con el SO en oscuro | Navy `#0A1122` | Navy claro `#1A2235` / mitad entre los dos Navy `#121A2C` | Blanco `#FFFFFF` | Blanco al 70 % `#B6B8BD` | Oro `#FFD700` |

El selector de tema guarda la elección (`localStorage`, clave `markdaun:theme`) y pone `data-theme` en `<html>`. Con «Sistema», el atributo se quita y manda `prefers-color-scheme`.

### 3.3 Excepciones de accesibilidad (aprobadas el 2026-11-02)

Solo hay tres desviaciones de la paleta, y existen únicamente para que el texto llegue a 4,5:1:

| Excepción | Valor | Por qué |
|---|---|---|
| Oro oscurecido para texto en claro (`daun`) | `#7A5E00` | El Oro puro sobre blanco da 1,4:1. Los *rellenos* siguen siendo Oro puro con texto Navy (13,4:1). |
| Rojo coral oscurecido (`danger`, `amber`) | `#C83B3E` en claro, `#F05555` en oscuro | Es el coral de la marca (`#EF4444`): oscurecido con Navy al 17 % en claro (sobre blanco solo daba 3,8:1) y aclarado con Blanco al 9 % en oscuro (sobre Navy claro solo daba 4,2:1). |
| Verde esmeralda oscurecido (`success`) en claro | `#0E7E60` | Es el esmeralda de la marca (`#10B981`), que sobre blanco solo daba 2,5:1. En oscuro se usa puro. |

### 3.4 Roles (tokens)

| Rol | Tokens | Regla |
|---|---|---|
| Fondo | `bg`, `surface`, `surface-sunken` | Lienzo, flotantes, paneles laterales. |
| Separadores | `line`, `line-strong` | Filetes de 1px; `line-strong` para bordes de controles (≥3:1). |
| Texto | `ink`, `ink-muted` | `ink-muted` también colorea la sintaxis Markdown (`#`, `**`, `>`). |
| Acento de texto | `daun`, `daun-strong`, `on-daun` | Enlaces, estado activo, foco, selección activa en listas. |
| Acción principal | `gold`, `gold-strong`, `on-gold` | Botón primario. **Uno por vista.** El texto sobre Oro es siempre Azul Marino. |
| Tinte de Oro | `sap`, `on-sap` | Chips de `#etiqueta`, indicador de novedad. |
| Resaltado | `mark`, `selection` | `==resaltado==`, búsqueda, selección. |
| Estados | `amber`, `danger`, `success` | Coral para errores, borrar y avisos (enlace roto, sin guardar). El aviso se distingue del error por la forma (subrayado discontinuo, punto), no por otro tono. Esmeralda para sincronizado o validado. **Solo en texto e indicadores pequeños**, nunca en fondos ni logotipos. |
| Fijo | `navy` | Fondo del icono y del splash; no cambia con el tema. |

> Los nombres `daun` y `sap` vienen de la identidad anterior (la hoja verde y la savia lima). Se mantienen como nombres de **rol** para no reescribir todo el código; sus valores ahora son de la paleta cdiezgil.

Todos los textos cumplen ≥4,5:1 en todos los fondos de su tema; `src/test/contrast.test.ts` lo comprueba.

---

## 4. Tipografía: el estándar Geist

**Geist** es la familia de la marca. **Geist Mono** es su variante monoespaciada y la usan el editor y el código.

> **Excepción aprobada (2026-11-02): títulos de nota en Instrument Serif.** El H1 de cada nota (en el editor) y el título de nota en la tarjeta del grafo usan `--font-display` = Instrument Serif 400. Da carácter editorial al documento, y Carlos la aprobó aunque se sale del estándar Geist. No se extiende a nada más: el logotipo, las cabeceras de vista, los botones y los H2 y H3 de las notas siguen en Geist.

| Peso | Uso |
|---|---|
| **Light 300** | Cuerpo de la vista de lectura (interlineado ≥1,6) y cifras y tablas con números tabulares (`data`). |
| **Regular 400** | Interfaz general, menús, texto secundario, editor. |
| **Medium 500** | Etiquetas de controles y pestañas (concesión de legibilidad a 13px). |
| **Bold 700** | Títulos (H1, cabeceras de vista, título de nota), botón primario, logotipo. |

No se usa el peso 600: donde antes había 600, ahora va 700.

Escala (detalle en `tokens.json`): `reading-h1` 40/46 Instrument Serif 400 (la excepción), `display-xl` 56/64, `display-l` 40/48, `display-m` 28/32, `title` 20/28, `heading` 15/24, `body` 14/20, `label` 13/16, `caption` 12/16, `reading` 17/28 Light, `editor` 15/26 mono, `code` 13/20 mono. H2 y H3 de nota en Geist Bold.

Carga:

```html
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Geist:wght@300;400;500;700&family=Geist+Mono:wght@400;500&family=Instrument+Serif&display=swap">
```

---

## 5. Símbolo, logotipo y sello

### 5.1 El símbolo: la hoja técnica

Una hoja **facetada** (polígono de 8 vértices, sin curvas), en coherencia con la geometría de Onzia y GalopApp. El significado está en los recortes de espacio negativo:

- **El nervio central es una flecha ↓**, el guiño al logotipo histórico de Markdown.
- **Dos nervios laterales terminan en nodos**: las notas enlazadas del grafo y del segundo cerebro.
- **Solo dos colores: Navy `#0A1122` y Oro `#FFD700`.** Nada de blanco, gris ni negro en el símbolo. Los recortes son agujeros reales del trazado (sin máscaras), así que dejan ver el fondo.
- **Los nodos son Oro**: un punto dentro de un anillo recortado.

Construcción sobre un lienzo de 1024: hoja de 160 a 864 en vertical y de 254 a 770 en horizontal. Nervio central de 44 de grosor, de 260 a 716, con flecha de 72 de ala. Nervios laterales de 30. Nodos de radio 22 dentro de un recorte de radio 36. Terminaciones rectas (`square`), nunca redondeadas.

### 5.2 Ficheros (`design/icons/`)

| Fichero | Uso |
|---|---|
| `app-icon.svg` | Icono principal: hoja Oro sobre Azul Marino. Dock, instalador, tienda. Fuente de `src-tauri/icons/`. |
| `app-icon-light.svg` | Hoja Azul Marino sobre Oro. Para contextos claros (documentación impresa). |
| `mark.svg` | Símbolo sin fondo: hoja Azul Marino con nodos Oro. Favicon, marca de agua. Sobre fondo Marino, la hoja pasa a Oro (token `--logo`). Nunca blanco, nunca degradados. |
| `tray.svg` | Versión simplificada (solo la flecha), en Azul Marino; macOS la usa como plantilla. |
| `logo.svg` | Logotipo horizontal: símbolo + «MarkDaun» en Azul Marino. |
| `seal.svg` | Sello de ecosistema `by { cdiezgil }` sobre Azul Marino. |

Para regenerar los iconos de la app: rasteriza `app-icon.svg` a PNG de 1024 px y ejecuta `npx tauri icon <png>`. `tray.png` es `tray.svg` a 44 px de alto (40 px de altura útil).

### 5.3 Logotipo

«MarkDaun» en **Geist Bold**, una sola palabra, tracking −0,02em, en `ink`. El símbolo va a la izquierda, con altura igual a 1,6 veces la altura de las mayúsculas y separado por 0,5 veces esa altura. Por debajo de 20px se usa solo el símbolo. Ya no hay itálica en «Daun».

### 5.4 Sello `by { cdiezgil }`

Firma de autoría del ecosistema, con la jerarquía tipográfica del manual de cdiezgil:

- `by` en Geist Light, en Gris Técnico (o `ink-muted` sobre claro);
- `{ }` en Geist Regular, en Oro (en el tema claro, Oro profundo `daun`), con un espacio entre llave y nombre;
- `cdiezgil` en Geist Bold, en blanco (o `ink` sobre claro).

Va en la barra de estado, en *Acerca de* y en el splash; nunca en la cabecera. Componente de referencia: `components/Seal/`.

### 5.5 Zona de respeto y usos incorrectos

Deja alrededor del símbolo y del logotipo un margen libre de, como mínimo, el 12,5 % de su lado. No hagas nada de esto:

- rotar, deformar ni contornear el símbolo;
- añadirle sombras, brillos o degradados;
- usar cualquier color que no sea Navy u Oro;
- colocar el sello `by { cdiezgil }` en la cabecera junto al logotipo.

---

## 6. Texturas de la casa

| Textura | Token / clase | Uso reservado en MarkDaun |
|---|---|---|
| **Trama de puntos** (ingeniería) | `--texture-dots` / `.bg-dots`, celda de 16px | Fondo del grafo, de Ajustes y de las pantallas vacías. |
| **Líneas diagonales** (procesamiento) | `--texture-diagonal` / `.bg-diagonal` | Barras de progreso indeterminado: indexación, sincronización y transcripción. Componente `components/Loader/`. |
| **Metal cepillado** (exclusividad) | `--texture-metal` / `.bg-metal` | Solo el splash y *Acerca de*. Encima, texto blanco u Oro. Jamás en listas ni en el editor. |

---

## 7. Espacio, forma, iconos y movimiento

- **Retícula de 8pt.** Layout, márgenes y separaciones son múltiplos de 8 (`space-2`, `space-4`, `space-6`, `space-8`, `space-12`, `space-16`). Los medios pasos de 4px (`space-1`, `space-3`) se reservan para el interior de controles densos.
- **Radios contenidos:** `radius-sm` 4px (chips), `radius-md` 6px (botones e inputs), `radius-lg` 8px (flotantes y tarjetas). `radius-pill` solo para contadores.
- **Iconos:** Lucide lineal, `stroke-width` 1.5, cuadrícula de 20px, en `ink-muted` en reposo y `daun` cuando están activos. Sin iconos rellenos ni de estilo *cartoon*.
- **Movimiento:** `--ease` `cubic-bezier(.2,.7,.2,1)`. 160ms (`--dur-panel`) para paneles y hover; 240ms (`--dur-palette`) para la paleta de comandos y los diálogos. Nada rebota.

---

## 8. Voz

La voz de cdiezgil es **cercana, didáctica, transparente y analítica**. En MarkDaun eso significa:

- **Tú a tú**, en segunda persona, con frases cortas.
- **Explicar el porqué** cuando algo no sale como esperabas: «No se ha subido nada: borraría 820 de 1 101 notas en GitHub. ¿Continuar?», no «Error de sincronización».
- **Sin humo:** nada de exclamaciones de marketing ni de «¡fácil!». Rigor sin jerga lanzada sin contexto.
- **La metáfora vegetal, con mesura:** «hoja», «huérfana» o «echa raíces» se pueden usar en estados vacíos y en el onboarding, nunca en errores.

| Evitamos | Decimos |
|---|---|
| «¡Nota creada con éxito!» | «Nota creada» |
| «Error 403» | «GitHub rechaza el token. Revisa que tenga permiso de escritura en el repositorio.» |
| «¡Prueba ya el Segundo Cerebro!» | «Pregunta a tus notas: busco las más relevantes y te respondo citándolas.» |
| «Nada por aquí 😢» | «Aún no hay notas. Escribe la primera hoja.» |

---

## 9. Qué cambió respecto a la identidad anterior

| Antes (Papel/Humus) | Ahora (Técnico/Marino) |
|---|---|
| Verde `daun` `#2E6A4F` y lima `sap` | Oro `#FFD700` y Oro oscurecido `#7A5E00` (solo texto en claro); `sap` es ahora un tinte de Oro |
| Fondos papel cálido `#F7F5EF` / humus `#111816` | Blanco / Azul Marino `#0A1122` |
| Instrument Serif para display y logotipo | Geist (300/400/500/700) y Geist Mono; Instrument Serif solo para títulos de nota (excepción) |
| Radios de 6/10/16 | Radios de 4/6/8 |
| Retícula de 4px | Retícula de 8pt con medios pasos internos |
| Hoja curva lima | Hoja facetada en Navy y Oro, sin otros colores |
| Sin firma | Sello `by { cdiezgil }` |
| Botón primario verde con texto blanco | Botón primario Oro con texto Azul Marino (`gold` / `on-gold`) |
