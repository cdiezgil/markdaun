#!/bin/bash
# Arranca el pool de agentes de MarkDaun en tmux (Azure AI Foundry).
SESSION_NAME="pool-markdaun"
POOL_DIR="$(cd "$(dirname "$0")/.." && pwd)"
AGENTS_DIR="$POOL_DIR/agents"

# Asegurar que az esté en el PATH
export PATH="$HOME/.azure-cli-env/bin:$PATH"

# ── Configuración del proyecto ────────────────────────────────────────────────
export GITHUB_REPO="${GITHUB_REPO:-cdiezgil/markdaun}"
export AGENTS_LABEL="${AGENTS_LABEL:-agentes}"

# ── Comprobaciones previas ────────────────────────────────────────────────────
command -v gh  >/dev/null || { echo "[-] Falta 'gh' (GitHub CLI). brew install gh && gh auth login"; exit 1; }
gh auth status >/dev/null 2>&1 || { echo "[-] 'gh' no está autenticado. Ejecuta: gh auth login"; exit 1; }
command -v az  >/dev/null || { echo "[-] Falta Azure CLI ('az'). brew install azure-cli && az login"; exit 1; }

# ── Modelo por rol (Azure AI Foundry) ─────────────────────────────────────────
modelo_de_rol() {
    case "$1" in
        analista)    echo "azure-foundry/claude-sonnet-4-6|high" ;;
        programador) echo "azure-foundry/claude-sonnet-4-6|high" ;;
        cyber)       echo "azure-foundry/claude-sonnet-4-6|high" ;;
        qa)          echo "azure-foundry/claude-sonnet-4-6|medium" ;;
        coordinador) echo "azure-foundry/claude-sonnet-4-6|medium" ;;
        *)           echo "azure-foundry/claude-sonnet-4-6|medium" ;;
    esac
}

# ── Lanzador de paneles ───────────────────────────────────────────────────────
lanzar() {
    local panel="$1" rol="$2"
    local cfg modelo thinking
    cfg="$(modelo_de_rol "$rol")"
    modelo="${cfg%%|*}"
    thinking="${cfg##*|}"
    tmux set-option -p -t "$panel" @rol "$rol"
    tmux select-pane -t "$panel" -T "$rol"
    tmux send-keys -t "$panel" \
        "cd '$POOL_DIR' && \
        export GITHUB_REPO='$GITHUB_REPO' \
        AGENTS_LABEL='$AGENTS_LABEL' \
        POOL_DIR='$POOL_DIR' \
        POOL_ROL='$rol' \
        POOL_TMUX_SESSION='$SESSION_NAME' \
        PATH='$HOME/.azure-cli-env/bin:$AGENTS_DIR':\"\$PATH\" && \
        pi --model '$modelo' --thinking '$thinking' \
           --append-system-prompt '$AGENTS_DIR/_github_issues.md' \
           --append-system-prompt '$AGENTS_DIR/_github.md' \
           --append-system-prompt '$AGENTS_DIR/_avisos.md' \
           --append-system-prompt '$AGENTS_DIR/$rol.md'" C-m
}

# ── Sesión tmux ───────────────────────────────────────────────────────────────
if tmux has-session -t "$SESSION_NAME" 2>/dev/null; then
    echo "[+] Conectando a la sesión existente: '$SESSION_NAME'..."
    sleep 1
    tmux attach-session -t "$SESSION_NAME"
    exit 0
fi

echo "[+] Creando pool de agentes MarkDaun en tmux (Azure AI Foundry)..."
echo "    Repo: $GITHUB_REPO"
echo ""

tmux new-session -d -s "$SESSION_NAME" -n "MarkDaun-Agents"
tmux rename-window -t "$SESSION_NAME:0" "Multi-Agent-Core"
lanzar "$SESSION_NAME:0" coordinador

tmux split-window -v -t "$SESSION_NAME:0"
lanzar "$SESSION_NAME:0.1" analista

tmux split-window -v -t "$SESSION_NAME:0.1"
lanzar "$SESSION_NAME:0.2" programador

tmux split-window -v -t "$SESSION_NAME:0.2"
tmux split-window -h -t "$SESSION_NAME:0.3"

lanzar "$SESSION_NAME:0.3" cyber
lanzar "$SESSION_NAME:0.4" qa

tmux select-layout -t "$SESSION_NAME:0" tiled
tmux select-layout -t "$SESSION_NAME:0" main-horizontal

tmux set-option -w -t "$SESSION_NAME:0" pane-border-status top
tmux set-option -w -t "$SESSION_NAME:0" pane-border-format " #{@rol} "

tmux attach-session -t "$SESSION_NAME"
