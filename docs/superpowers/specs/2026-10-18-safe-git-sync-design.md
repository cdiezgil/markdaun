# Safe GitHub Sync (multi-device) — Design

- **Date:** 2026-10-18
- **Status:** Approved by the user
- **Incident:** on 2026-10-18 at 23:05 a "MarkDaun sync" orphan commit containing only `.gitignore` was force-pushed to the notes repo, wiping 1 101 files on GitHub (restored manually by merging, no force). Root causes in `src-tauri/src/git/sync.rs`:
  1. `git_connect_inner`: when the vault "has files" (true even with only `.gitignore`/`.markdaun/`), it creates a parentless commit and pushes with `+refs/heads/main` (force), overwriting the remote.
  2. `git_pull_inner`: on divergence it does `reset --hard` to the remote ("remote wins"), silently discarding unsynced local changes.
  3. Every sync commit by connect has no parent, so histories never share ancestry.

## Principle

The user works on the same notes from several MarkDaun installs. **No sync operation may delete or overwrite data on either side without an explicit confirmation.** No force pushes, no hard resets.

## Connect (configure repo + PAT)

1. Fetch the remote first (no local changes yet).
2. Classify:
   - *Local content* = files other than `.git/`, `.gitignore`, `.markdaun/`, `.DS_Store`, empty folders.
   - *Remote content* = files on `origin/main` other than `.gitignore`.
3. Cases:
   - **Remote empty or no `main`** → init/open, commit local (with parent if a local history exists), normal push. No dialog.
   - **Local empty, remote has content** → dialog "El repositorio ya tiene N notas. ¿Descargarlas en esta carpeta?" → *Descargar* (checkout remote into the vault, keeping `.markdaun/`) / *Cancelar* (nothing changes, repo not configured).
   - **Both have content** → dialog "El repositorio ya tiene N notas y esta carpeta tiene M. ¿Sincronizar? Se combinarán ambas; si una nota existe en los dos lados con contenido distinto se conservarán las dos versiones." → *Sincronizar* (merge as in Pull, then push normally) / *Cancelar*.
   - Unrelated histories are merged with `allow-unrelated-histories` semantics (merge commit with both parents) — never replaced.
4. The connect command returns a *preview* (counts, case) first; the actual action requires a second call with the user's choice (`git_connect_preview` → `git_connect_apply(choice)`).

## Pull

- Fetch; up to date → nothing; fast-forward → checkout (without discarding local uncommitted changes: commit them first as a local sync commit, then merge).
- Diverged → real merge (merge commit with both parents). On a content conflict in a file, keep **both versions**: the merged path gets the local content and the remote version is written as `<name> (conflicto YYYY-MM-DD HH-mm).md` (same folder); the UI shows "Hay N conflictos" with links. Binary conflicts: same rule with the original extension.
- Never `reset --hard`.

## Push

- Always commit with the current HEAD as parent; push without `+` (no force).
- If the push is rejected as non-fast-forward → run Pull (merge) and retry once.
- **Deletion guard:** before pushing, if the new tree would remove more than 50 % of the files tracked on `origin/main` (and that is ≥ 10 files), abort and ask the user ("Esta sincronización borraría N de M notas en GitHub. ¿Continuar?"). Confirm → push; cancel → nothing pushed.

## UI

- Sync panel/settings show the dialogs above (design system: ConfirmDialog styles), the conflicts notice, and the deletion-guard confirmation.

## Testing (strict TDD, local bare repos as remotes, no network)

- Regression: reproduce today's incident — remote with 1 000 files, connect from a vault containing only `.gitignore` + `.markdaun/` → preview says "local empty, remote has content", nothing is pushed; apply *Descargar* restores the files locally.
- Connect: remote empty; local empty + remote content (download); both content (merge, no force, both parents present); cancel leaves remote untouched.
- Pull: fast-forward with uncommitted local edits preserved; divergence merges; conflict keeps both versions with the conflict filename.
- Push: has parent; non-fast-forward triggers merge + retry; deletion guard triggers above threshold and not below.
- Existing flaky pull tests (`pull_fast_forward`, `pull_reset_hard_on_divergence`) are replaced by deterministic ones; the "reset hard" test is removed (behaviour no longer exists).
