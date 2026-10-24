# MarkDaun — Renderizado de Imágenes (.gif, .jpg, .jpeg) dentro de las Notas

> **Fecha:** 2026-10-24  
> **Estado:** Aprobado  
> **Objetivo:** Permitir el renderizado y visualización fluida de imágenes (especialmente formatos `.gif` animados y `.jpeg`/`.jpg`) dentro del editor de notas Markdown, solucionando el problema de enlaces rotos (icono de interrogación) y garantizando la portabilidad del vault al guardar.

---

## 1. Problema Actual

Al abrir o escribir notas que referencian imágenes locales (por ejemplo `![Terrina...](//Users/carlosdiez/Documents/markdaun/.../0001_completo.jpg)` o `![alt](media/recipes/0001.jpg)`), el editor muestra un icono nativo de imagen rota con una interrogación.

Las causas raíz identificadas son:
1. **Asset Protocol deshabilitado en Tauri 2:** En `src-tauri/tauri.conf.json`, `app.security.assetProtocol` no está configurado (por defecto `enable: false`). Cualquier petición a `convertFileSrc()` (`asset://localhost/...` en macOS o `http://asset.localhost/...` en Windows) es rechazada con un error 403 Forbidden por Tauri.
2. **Mutilación de rutas con doble barra (`//`):** `new URL('//Users/carlosdiez/...', 'file:///dir/').pathname` interpreta `//Users` como el nombre de host de la URL, produciendo `/carlosdiez/...` y perdiendo el prefijo del directorio del sistema de archivos.
3. **Manejo de espacios y codificación URL:** Rutas con espacios o caracteres codificados (`%20`, acentos UTF-8 como `gelée`) no se decodificaban adecuadamente antes de pasarse al sistema de archivos a través del protocolo de assets.
4. **Falta de normalización relativa en el guardado:** Las rutas dentro del vault deben guardarse de forma relativa a la nota actual para que el repositorio sea portable entre dispositivos y en GitHub Sync.

---

## 2. Decisiones Técnicas

### 2.1 Backend / Tauri (`tauri.conf.json`)
- Habilitar `app.security.assetProtocol` con `enable: true`.
- Definir el `scope` para abarcar las rutas estándar del usuario donde pueden ubicarse los vaults:
  ```json
  "security": {
    "assetProtocol": {
      "enable": true,
      "scope": [
        "$HOME/**",
        "$DOCUMENT/**",
        "$DESKTOP/**",
        "$DOWNLOAD/**"
      ]
    },
    "csp": null
  }
  ```
- No se requiere ningún plugin adicional: Tauri 2 gestiona el protocolo `asset:` de forma nativa en streaming con el motor de renderizado del sistema (WebKit en macOS, WebView2 en Windows).

### 2.2 Resolución de Rutas en Carga (`resolveImageSrc` y `processImagesOnLoad`)
- **URLs remotas:** (`https://`, `http://`, `data:`) se devuelven sin modificar.
- **Normalización de barras iniciales:** Rutas que comiencen por `//+` se normalizan a barra simple `/` antes de resolverlas.
- **Decodificación de caracteres:** Se aplica `decodeURI` para manejar caracteres escapados (`%20`, tildes).
- **Rutas absolutas:** Si la ruta comienza con `/` (o letra de unidad Windows), se envía directamente a `convertAssetSrc()`.
- **Rutas relativas:** Si la ruta es relativa (`media/recipes/0001.jpg`, `./...`, `../...`), se combina con el directorio de la nota (`noteDir`) y se pasa a `convertAssetSrc()`.

### 2.3 Persistencia en Guardado (`processImagesOnSave`)
- Al guardar la nota en disco (`.md`), se buscan referencias a imágenes locales (`asset://...`, `http://asset.localhost/...` o rutas absolutas locales).
- Si la ruta física de la imagen se encuentra dentro del vault, se calcula su ruta relativa respecto a la nota actual (ejemplo: `media/recipes/0001_completo.jpg`).
- Esto asegura que el fichero en disco sea estándar, portable y compatible con GitHub Sync.

### 2.4 Renderizado en TipTap y Estilos (`editor.css`)
- Uso de la extensión nativa `@tiptap/extension-image`.
- Los ficheros `.gif` se renderizan en elementos `<img>` estándar que reproducen automáticamente su animación en bucle mediante el motor del navegador, con aceleración por hardware y mínimo consumo.
- Estilos en `editor.css`:
  - `max-width: 100%`, `height: auto`, `border-radius: var(--radius-sm)`, `display: block`, `margin: var(--space-3) auto`.
  - Respeta `--measure` de la columna de edición.

---

## 3. Plan de Pruebas

1. **Pruebas unitarias (`src/store/editorStore.resolveImageSrc.test.ts`):**
   - Resolución de rutas con doble barra `//Users/...`.
   - Resolución de rutas absolutas `/Users/...`.
   - Resolución de rutas relativas con subdirectorios `media/recipes/foto.jpg`.
   - Manejo de espacios y escapes `%20` y caracteres acentuados.
   - Formatos soportados: `.gif`, `.jpg`, `.jpeg`, `.png`, `.webp`, `.svg`.
   - Conversión a ruta relativa al guardar en `processImagesOnSave`.
2. **Pruebas de integración del Editor (`EditorCanvas.test.tsx`, `markdownTyping.test.tsx`):**
   - Escribir `![alt](ruta.jpg)` o `![alt](anim.gif)` genera el nodo de imagen.
   - Drag & drop de archivos `.gif` y `.jpg` genera el nodo de imagen.
3. **Verificación de regresión:**
   - Ejecución de `cargo test` para validar el backend.
   - Ejecución de `npm test` para validar el frontend.
