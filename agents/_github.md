# CONVENCIONES DEL POOL: GITHUB (código y Pull Requests)

Este bloque es común a todos los agentes. El **qué/estado** vive en GitHub Issues (`_github_issues.md`); aquí vive el **código y las PRs**, en el mismo repo `$GITHUB_REPO`.

## Plataforma y reparto de herramientas

| Operación | Herramienta |
|---|---|
| Clonar, ramas, commit, push, checkout, diff | **git** (credenciales en el llavero del SO) |
| Crear / leer / comentar una **PR** | **`gh pr`** CLI |
| Revisar de verdad (tests/lint/build de una PR) | **git** en local (ver QA/Cyber) |

Variable de entorno: `GITHUB_REPO` (ej. `cdiezgil/markdaun`). Pasa siempre `--repo "$GITHUB_REPO"` a los comandos `gh pr`.

## Identidad

Los agentes operan con las credenciales personales de `cdiezgil`. **El humano nunca hace push:** por tanto, toda rama, commit, push o PR con esa identidad es obra de un agente.

## Ramas

*   Convención propia, identificable y separada de la del equipo:
    **`agents/<n>-<slug>`** (ej. `agents/42-editor-sync-github`).
*   Nunca empujes a `main`, `develop` ni ramas del equipo. Solo a tu rama `agents/*`.

## Rama base (detectar, no asumir)

```bash
git ls-remote --heads origin develop | grep -q develop && BASE=develop \
  || { git ls-remote --heads origin master | grep -q master && BASE=master || BASE=main; }
```

## El flujo MUERE en una PR validada: NUNCA se mergea

Ningún agente hace merge. El pipeline termina con la **PR abierta** y los dos veredictos (QA + Cyber) PASSED sobre el **mismo SHA de cabeza**. A partir de ahí la pelota es del **humano**. Prohibido `git merge`/`push` a la rama base y prohibido cerrar/mergear la PR.

## Frescura: trabaja SIEMPRE sobre lo último

```bash
cd <repo-local>
git fetch origin
git switch "$BASE" && git pull --ff-only
```

## Chuleta git

```bash
# Programador: crear rama de trabajo
git fetch origin
git switch -c "agents/<n>-<slug>" "origin/$BASE"
# ...commits...
git push -u origin "agents/<n>-<slug>"

# QA / Cyber: traer la rama de la PR
gh pr checkout <pr-number> --repo "$GITHUB_REPO"
# o equivalente git:
git fetch origin "agents/<n>-<slug>"
git switch --detach FETCH_HEAD
git log -1 --format=%H                        # SHA de cabeza que estás validando
git diff "origin/$BASE"...FETCH_HEAD          # el cambio real de la PR
```

## Chuleta `gh pr`

```bash
# Crear PR (programador)
gh pr create --repo "$GITHUB_REPO" \
  --base "$BASE" \
  --head "agents/<n>-<slug>" \
  --title "#<n>: <título>" \
  --body "Refs #<n>"

# Listar PRs abiertas
gh pr list --repo "$GITHUB_REPO" --state open \
  --json number,title,headRefName,baseRefName,url,headRefOid

# Ver una PR y fijar SHA de cabeza
gh pr view <pr-number> --repo "$GITHUB_REPO" \
  --json number,state,headRefName,headRefOid,baseRefName,url
# headRefOid = SHA de cabeza

# Ficheros cambiados en la PR
gh pr diff <pr-number> --repo "$GITHUB_REPO" --name-only

# Comentar en la PR (opcional; el veredicto formal va en la issue)
gh pr comment <pr-number> --repo "$GITHUB_REPO" --body "<texto>"

# Los agentes NUNCA hacen esto:
# gh pr merge <pr-number>   ← solo el humano
```

## Reglas comunes

1.  **git para el código, `gh pr` solo para la PR.** No uses la API REST directamente si `gh` lo resuelve.
2.  Todo análisis de una PR se refiere a su **SHA de cabeza actual** (`headRefOid`). Si cambia, los veredictos previos caducan.
3.  El **veredicto formal** (QA/Cyber) se escribe como comentario en la **issue de GitHub** (`_github_issues.md`). El comentario en la PR es opcional.
4.  No se mergea, no se toca la rama base, no se cierra la PR ni la issue. Nunca escribas tokens/secretos en código, commits, PRs o comentarios.
