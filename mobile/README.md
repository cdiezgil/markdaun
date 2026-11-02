# MarkDaun móvil (PWA)

Lee tu bóveda de MarkDaun desde el móvil y dicta notas de voz que acaban en `Entrada/`. Es una PWA (Vite + React + TypeScript) alojada en <https://cdiezgil.github.io/markdaun/>. No hay servidor: el navegador habla directamente con la API de GitHub.

## Instalar

**Android (Chrome):** abre la dirección, menú ⋮ → *Añadir a pantalla de inicio* / *Instalar app*.

**iPhone (Safari):** abre la dirección, *Compartir* → *Añadir a pantalla de inicio*. El dictado requiere iOS 14.3 o superior.

## Crear el token de GitHub

La app necesita un token *fine-grained* limitado a tu repositorio de notas.

1. GitHub → *Settings* → *Developer settings* → *Personal access tokens* → *Fine-grained tokens* → *Generate new token*.
2. Pon un nombre (p. ej. `MarkDaun móvil`) y una caducidad.
3. *Repository access* → *Only select repositories* → elige solo el repositorio de la bóveda.
4. *Permissions* → *Repository permissions* → *Contents*: **Read and write**. No hace falta nada más.
5. *Generate token*, cópialo y pégalo en el asistente de la app.

El token se guarda en el navegador de este dispositivo y solo se envía a `api.github.com`. La app únicamente crea ficheros nuevos en `Entrada/`; nunca sobrescribe ni borra. Si lo pierdes o sospechas de él, revócalo en GitHub.

> No publiques otro sitio de GitHub Pages bajo `cdiezgil` sin mover antes la app a su propio dominio: el almacenamiento del navegador es por origen.

## Desarrollo

```sh
cd mobile
npm install
npm run dev            # servidor de desarrollo
npm test               # tests unitarios (Vitest)
npm run test:coverage  # con cobertura
npm run test:e2e       # compila y ejecuta Playwright
npm run build          # tsc + build de producción
```

El despliegue lo hace `.github/workflows/mobile-pages.yml` (tests unitarios y e2e antes de publicar).

## Transcripción en el escritorio

Las grabaciones llegan a `Entrada/` como audio; el escritorio las transcribe al sincronizar o al arrancar. Si el modelo de Whisper no está descargado, se descarga automáticamente la primera vez (~800 MB para `large-v3-turbo`). Si tienes dos escritorios conectados al mismo repositorio, ambos pueden transcribir la misma grabación: el segundo genera una copia `(conflicto …)` y se conservan las dos.
