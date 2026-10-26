 #!/usr/bin/env bash
 set -e

 echo "=== Mergeando PR #9 — Bloque 4: Sync GitHub ==="
 gh pr merge 9 --repo cdiezgil/markdaun --squash
 echo "✅ PR #9 mergeada"
 sleep 5

 echo "=== Mergeando PR #11 — Bloque 5: Second Brain ==="
 gh pr merge 11 --repo cdiezgil/markdaun --squash
 echo "✅ PR #11 mergeada"
 sleep 5

 echo "=== Mergeando PR #12 — CI/CD: GitHub Actions ==="
 gh pr merge 12 --repo cdiezgil/markdaun --squash
 echo "✅ PR #12 mergeada"

 echo ""
 echo "🎉 Todas las PRs integradas. Vuelve al HEAD de main:"
 echo "   git checkout main && git pull origin main"
 EOF
 chmod +x /Users/cdiez-gil/Projects/MarkDaun/scripts/merge-final.sh
 echo "Script listo en scripts/merge-final.sh"
