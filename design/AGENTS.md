# MarkDaun — instrucciones para agentes

Para cualquier trabajo visual de MarkDaun:
1. Lee primero `cdiezgil.md` (manual de marca: MarkDaun es un subproyecto de la marca cdiezgil).
2. Usa solo los tokens de `tokens.json` / `tokens.css`. No inventes colores, fuentes, radios ni espaciados.
3. En CSS usa siempre las variables (`var(--daun)`, `var(--space-4)`…), nunca valores sueltos. El tema oscuro se activa con `data-theme="dark"` o automáticamente por `prefers-color-scheme`.
4. Botón primario = `var(--gold)` con texto `var(--on-gold)`, uno por vista. El texto de acento (enlaces, activo, foco) es `var(--daun)`; nunca uses `--gold` como color de texto.
5. Geist (300/400/500/700) y Geist Mono. Única excepción: `--font-display` (Instrument Serif 400) para el título de la nota. Radios ≤ 8px. Retícula de 8pt.
6. El logotipo y el símbolo usan solo Navy `#0A1122` y Oro `#FFD700`.
7. `tokens.css` se genera: edita `tokens.json` y ejecuta `npm run tokens`.
8. Los iconos de `icons/` se usan tal cual, sin modificarlos.
9. `components/` contiene muestras de referencia y sus pautas.
