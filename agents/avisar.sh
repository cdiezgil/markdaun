#!/bin/bash
# Envía un aviso a otro agente del pool escribiendo en su panel de tmux.
#
# Uso:  avisar.sh <rol-destino> "<mensaje>"
#       roles: coordinador | analista | programador | cyber | qa
#
# El aviso se entrega como mensaje "follow-up" de pi (Alt+Enter): si el agente
# está trabajando, se encola y lo lee al terminar; si está libre, lo procesa ya.
# El panel destino se localiza por la opción de panel @rol que fija start_agents.sh.
set -euo pipefail

destino="${1:?Uso: avisar.sh <rol-destino> \"<mensaje>\"}"
mensaje="${2:?Falta el mensaje}"
emisor="${POOL_ROL:-humano}"
sesion="${POOL_TMUX_SESSION:-{{SESSION_NAME}}}"
log_dir="${POOL_DIR:-$(cd "$(dirname "$0")/.." && pwd)}/.pool"

if [ "$destino" = "$emisor" ]; then
    echo "[-] No te avises a ti mismo ($emisor)" >&2
    exit 1
fi

pane=$(tmux list-panes -s -t "$sesion" -F '#{pane_id} #{@rol}' 2>/dev/null \
    | awk -v r="$destino" '$2 == r { print $1; exit }')
if [ -z "$pane" ]; then
    echo "[-] No hay panel con rol '$destino' en la sesión tmux '$sesion'" >&2
    exit 1
fi

# Una sola línea: un salto de línea enviaría el mensaje a medias
texto="[AVISO $emisor -> $destino] $(printf '%s' "$mensaje" | tr '\n\r' '  ')"

tmux send-keys -t "$pane" -l "$texto"
tmux send-keys -t "$pane" M-Enter

mkdir -p "$log_dir"
printf '%s\t%s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$texto" >> "$log_dir/avisos.log"
echo "[+] Aviso enviado a $destino ($pane)"
