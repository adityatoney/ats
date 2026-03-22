#!/usr/bin/env bash
#
# rebuild.sh — Install deps, rebuild Docker images, and restart services.
#
# Usage:
#   ./scripts/rebuild.sh              # rebuild all changed services
#   ./scripts/rebuild.sh runtime      # rebuild only runtime
#   ./scripts/rebuild.sh server       # rebuild only server (includes migrate)
#   ./scripts/rebuild.sh web          # rebuild only web
#   ./scripts/rebuild.sh runtime web  # rebuild runtime + web
#   ./scripts/rebuild.sh --no-deps    # skip dependency install
#   ./scripts/rebuild.sh --logs       # tail logs after starting

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

# --- Parse flags ---
INSTALL_DEPS=true
TAIL_LOGS=false
SERVICES=()

for arg in "$@"; do
    case "$arg" in
        --no-deps)  INSTALL_DEPS=false ;;
        --logs)     TAIL_LOGS=true ;;
        runtime|server|web|migrate|postgres)
            SERVICES+=("$arg")
            ;;
        *)
            echo "Unknown argument: $arg"
            echo "Usage: $0 [runtime|server|web ...] [--no-deps] [--logs]"
            exit 1
            ;;
    esac
done

# --- Detect what changed (if no services specified) ---
if [ ${#SERVICES[@]} -eq 0 ]; then
    echo "==> Detecting changed packages..."
    CHANGED_FILES=$(git diff --name-only HEAD 2>/dev/null || true)
    if [ -z "$CHANGED_FILES" ]; then
        CHANGED_FILES=$(git diff --name-only HEAD~1 HEAD 2>/dev/null || true)
    fi

    if echo "$CHANGED_FILES" | grep -q "packages/runtime/"; then
        SERVICES+=("runtime")
    fi
    if echo "$CHANGED_FILES" | grep -q "packages/server/\|packages/db/\|packages/shared/"; then
        SERVICES+=("server" "migrate")
    fi
    if echo "$CHANGED_FILES" | grep -q "packages/web/"; then
        SERVICES+=("web")
    fi

    # If nothing detected or root files changed, rebuild everything
    if [ ${#SERVICES[@]} -eq 0 ]; then
        echo "    No specific package changes detected, rebuilding all."
        SERVICES=("server" "migrate" "runtime" "web")
    else
        echo "    Will rebuild: ${SERVICES[*]}"
    fi
fi

# Server changes also require migrate rebuild (shared Dockerfile)
if [[ " ${SERVICES[*]} " == *" server "* ]] && [[ " ${SERVICES[*]} " != *" migrate "* ]]; then
    SERVICES+=("migrate")
fi

# --- Step 1: Install dependencies ---
if [ "$INSTALL_DEPS" = true ]; then
    # Node dependencies (if server/web/shared changed)
    if [[ " ${SERVICES[*]} " == *" server "* ]] || [[ " ${SERVICES[*]} " == *" web "* ]]; then
        echo ""
        echo "==> Installing Node.js dependencies..."
        pnpm install --frozen-lockfile 2>/dev/null || pnpm install
    fi

    # Python dependencies (if runtime changed)
    if [[ " ${SERVICES[*]} " == *" runtime "* ]]; then
        echo ""
        echo "==> Installing Python dependencies..."
        (cd packages/runtime && uv sync --all-extras)
    fi
fi

# --- Step 2: Run tests ---
echo ""
echo "==> Running tests..."
TESTS_OK=true

if [[ " ${SERVICES[*]} " == *" runtime "* ]]; then
    echo "    Python tests..."
    if (cd packages/runtime && uv run pytest tests/ -q 2>&1 | tail -3); then
        echo "    Python tests passed."
    else
        echo "    WARNING: Python tests failed!"
        TESTS_OK=false
    fi
fi

if [[ " ${SERVICES[*]} " == *" server "* ]]; then
    echo "    TypeScript tests..."
    if npx turbo run test --filter=@aegis/server 2>&1 | tail -3; then
        echo "    TypeScript tests passed."
    else
        echo "    WARNING: TypeScript tests failed!"
        TESTS_OK=false
    fi
fi

if [ "$TESTS_OK" = false ]; then
    echo ""
    read -p "Tests failed. Continue with rebuild? [y/N] " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo "Aborted."
        exit 1
    fi
fi

# --- Step 3: Build Docker images ---
echo ""
echo "==> Building Docker images: ${SERVICES[*]}..."
docker compose build "${SERVICES[@]}"

# --- Step 4: Restart services ---
echo ""
echo "==> Restarting services..."
docker compose up -d "${SERVICES[@]}"

# --- Step 5: Wait for health checks ---
echo ""
echo "==> Waiting for services to be healthy..."
TIMEOUT=60
ELAPSED=0
while [ $ELAPSED -lt $TIMEOUT ]; do
    ALL_HEALTHY=true

    if [[ " ${SERVICES[*]} " == *" server "* ]]; then
        if ! docker inspect aegis-server --format='{{.State.Health.Status}}' 2>/dev/null | grep -q "healthy"; then
            ALL_HEALTHY=false
        fi
    fi

    if [[ " ${SERVICES[*]} " == *" runtime "* ]]; then
        if ! docker inspect aegis-runtime --format='{{.State.Health.Status}}' 2>/dev/null | grep -q "healthy"; then
            ALL_HEALTHY=false
        fi
    fi

    if [ "$ALL_HEALTHY" = true ]; then
        break
    fi

    sleep 2
    ELAPSED=$((ELAPSED + 2))
    printf "."
done
echo ""

if [ "$ALL_HEALTHY" = true ]; then
    echo "==> All services healthy!"
else
    echo "==> WARNING: Some services may not be healthy yet (timed out after ${TIMEOUT}s)"
    docker compose ps
fi

# --- Step 6: Summary ---
echo ""
echo "==> Done! Services status:"
docker compose ps --format "table {{.Name}}\t{{.Status}}\t{{.Ports}}"

# --- Optional: tail logs ---
if [ "$TAIL_LOGS" = true ]; then
    echo ""
    echo "==> Tailing logs (Ctrl+C to stop)..."
    docker compose logs -f "${SERVICES[@]}"
fi
