# CONVENCIONES DEL POOL: GITHUB ISSUES (gestor de tareas)

Este bloque es común a todos los agentes del pool. Tu rol concreto se define más abajo.
La fuente de verdad de **qué hay que hacer y en qué estado está** son las **GitHub Issues** del repo `$GITHUB_REPO`. El código y las PRs viven en el mismo repo (ver `_github.md`).

## Plataforma

| Pieza | Herramienta |
|---|---|
| Tickets / work items | **GitHub Issues**, repo `$GITHUB_REPO` |
| Acceso | CLI **`gh`** (ya autenticada). No uses la web ni la API REST directamente. |

Variables de entorno disponibles: `GITHUB_REPO` (ej. `cdiezgil/markdaun`) y `AGENTS_LABEL` (la label de scope, `agentes`). Pasa siempre `--repo "$GITHUB_REPO"` a todos los comandos `gh issue` y `gh pr`.

## Regla de oro: ámbito de los agentes

Convivimos en el repo real del proyecto. **Un agente solo toca issues que lleven la label `$AGENTS_LABEL` (`agentes`).** Si una issue no la lleva, para ti **no existe**: no la leas, no la muevas, no la comentes.

*   Toda issue que cree un agente lleva **siempre** `agentes` desde el `create`.
*   El humano puede ver nuestras issues y el tablero e intervenir cuando quiera. Por eso somos **visibles** pero **acotados**.

## Modelo de estado: una sola capa (solo labels)

GitHub Issues no tiene workflow nativo más allá de `open`/`closed`. El pipeline completo se gestiona con labels `estado:*`. **Una issue tiene exactamente una label `estado:*` en todo momento.** Transicionar = quitar la actual y poner la nueva en la **misma** llamada:

```bash
gh issue edit <n> --repo "$GITHUB_REPO" --add-label "estado:en-desarrollo" --remove-label "estado:listo-desarrollo"
```

| Label `estado:*` | GitHub Issue | Quién trabaja |
|---|---|---|
| `estado:refinamiento` | open | Coordinador + humano |
| `estado:asignado-analista` | open | Analista |
| `estado:listo-desarrollo` | open | (cola) |
| `estado:en-desarrollo` | open | Programador |
| `estado:en-validacion` | open | QA y Cyber |
| — | **closed** | El humano (cierra al mergear la PR) |

Los agentes **nunca cierran** una issue. El cierre lo hace el humano al integrar la PR.

### Retrocesos

*   **QA/Cyber FAILED** → label `estado:en-desarrollo` (quita `estado:en-validacion`). La issue sigue open.
*   **dev-blocked** → label `estado:asignado-analista` (quita `estado:en-desarrollo`). La issue sigue open.
*   **needs-human** → añade label `needs-human`, asigna la issue al humano y comenta. No cierres la issue.

**Fin del pool:** cuando QA y Cyber dan PASSED sobre el mismo SHA, la issue queda en `estado:en-validacion` con la PR abierta. Los agentes no hacen merge ni cierran la issue.

## Señales (labels sin prefijo `estado:`)

`analysis-ready`, `analysis-blocked`, `dev-ready`, `dev-blocked`, `needs-human`. Son aditivas (no sustituyen a `estado:*`). Los veredictos de validación son **comentarios** en la issue (`QA Validation: PASSED @ <sha>`, `Cyber Validation: PASSED @ <sha>`), no labels.

## Cross-referencias

*   Una issue se cita como `#<n>` (ej. `#42`). Es también el número que va en la rama y el título de la PR (ver `_github.md`).
*   **Una issue = una PR.** Si el trabajo abarca varios cambios independientes, se divide en issues separadas.
*   Cada issue lleva en su cuerpo la sección `## Ruta de Impacto Técnico` con la rama base del repo.

## Chuleta `gh issue`

```bash
# Listar MIS issues por estado (siempre acotado a $AGENTS_LABEL)
gh issue list --repo "$GITHUB_REPO" --label "$AGENTS_LABEL" --label "estado:en-validacion" --json number,title,labels,url

# Leer una issue (cuerpo + labels + comentarios)
gh issue view <n> --repo "$GITHUB_REPO" --json number,title,body,labels,assignees,url
gh issue view <n> --repo "$GITHUB_REPO" --comments --json comments

# Crear una issue (SIEMPRE con la label de scope)
gh issue create --repo "$GITHUB_REPO" \
  --title "<título>" --body-file /tmp/desc.md \
  --label "agentes,estado:refinamiento"

# Editar body (el cuerpo es el documento vivo: edítalo con fichero)
gh issue view <n> --repo "$GITHUB_REPO" --json body -q .body > /tmp/body-<n>.md
# ... edita /tmp/body-<n>.md ...
gh issue edit <n> --repo "$GITHUB_REPO" --body-file /tmp/body-<n>.md

# Gestionar labels (transicionar estado)
gh issue edit <n> --repo "$GITHUB_REPO" --add-label "dev-ready"
gh issue edit <n> --repo "$GITHUB_REPO" --add-label "estado:en-validacion" --remove-label "estado:en-desarrollo"

# Comentar (registro de eventos: señales, veredictos, bloqueos)
gh issue comment <n> --repo "$GITHUB_REPO" --body "QA Validation: PASSED @ <sha>"

# Asignar al humano (handoff)
gh issue edit <n> --repo "$GITHUB_REPO" --assignee "<github-username>"

# Los agentes nunca hacen esto:
# gh issue close <n>   ← solo el humano, al mergear la PR
```

> **Labels:** `--add-label` añade (no reemplaza) y `--remove-label` quita. Para transicionar el estado pasa **ambas** flags en la misma llamada.
> **Permisos:** los agentes **no** cierran issues. El cierre final lo hace el humano.

## Reglas comunes

1.  El **cuerpo** de la issue es el **documento vivo** (Alcance + especificación). Los **comentarios** son el **registro de eventos** (señales, veredictos, bloqueos). No los mezcles.
2.  Al editar el cuerpo, descárgalo primero (`gh issue view --json body -q .body`), modifica solo tus secciones y súbelo entero con `--body-file`. Nunca lo reescribas de memoria.
3.  Todo trabajo arranca de la Regla de Oro: si la issue no lleva `agentes`, no es tuya.
4.  Nunca escribas tokens ni secretos en issues, comentarios o PRs.
