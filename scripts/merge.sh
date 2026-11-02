   #!/usr/bin/env bash
   set -e

   echo "=== Guardando trabajo en curso del Programador ==="
   git stash

   echo "=== Rebasando y mergeando PR #7 (Bloque 2 - Editor) ==="
   git checkout agents/2-editor-wysiwyg
   git rebase origin/main
   git push --force-with-lease origin agents/2-editor-wysiwyg
   gh pr merge 7 --repo cdiezgil/markdaun --squash

   echo "=== Rebasando y mergeando PR #8 (Bloque 3 - Grafo) ==="
   git fetch origin
   git checkout agents/3-grafo-documentos
   git rebase origin/main
   git push --force-with-lease origin agents/3-grafo-documentos
   gh pr merge 8 --repo cdiezgil/markdaun --squash

   echo "=== Preparando rama correcta para Bloque 4 (Sync GitHub) ==="
   git fetch origin
   git checkout -b agents/4-sync-github origin/main
   git stash pop

   echo "=== Listo. Trabajo del Programador restaurado en agents/4-sync-github ==="
   git status --short
 
