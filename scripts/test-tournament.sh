#!/usr/bin/env bash
# =============================================================================
# test-tournament.sh — End-to-end tournament test via API
#
# Usage:
#   ./scripts/test-tournament.sh              # Uses localhost defaults
#   SERVER_URL=http://server:3001 ./scripts/test-tournament.sh  # Custom URL
#
# Prerequisites:
#   - Server running on port 3001 (docker compose up OR local dev)
#   - Runtime running on port 8000
#   - Database seeded (3 agents: MA Crossover, Mean Reverter, Buy & Hold)
# =============================================================================

set -euo pipefail

SERVER=${SERVER_URL:-http://localhost:3001}
CYAN='\033[0;36m'
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[0;33m'
NC='\033[0m'

log()  { echo -e "${CYAN}[$(date +%H:%M:%S)]${NC} $*"; }
ok()   { echo -e "${GREEN}  ✓${NC} $*"; }
fail() { echo -e "${RED}  ✗${NC} $*"; exit 1; }
warn() { echo -e "${YELLOW}  !${NC} $*"; }

# -------------------------------------------------------------------
# 1. Health check
# -------------------------------------------------------------------
log "Checking server health..."
curl -sf "$SERVER/health" > /dev/null || fail "Server not reachable at $SERVER"
ok "Server healthy"

# -------------------------------------------------------------------
# 2. List agents
# -------------------------------------------------------------------
log "Fetching agents..."
AGENTS_JSON=$(curl -sf "$SERVER/api/agents")
AGENT_COUNT=$(echo "$AGENTS_JSON" | python3 -c "import sys,json; print(len(json.load(sys.stdin)['data']))")

if [ "$AGENT_COUNT" -lt 2 ]; then
  fail "Need at least 2 agents for a tournament. Found: $AGENT_COUNT. Run seed first."
fi
ok "Found $AGENT_COUNT agents"

# Extract agent IDs and project ID
AGENT_IDS=$(echo "$AGENTS_JSON" | python3 -c "
import sys, json
data = json.load(sys.stdin)['data']
for a in data:
    print(a['id'], a['name'])
")
echo "$AGENT_IDS"

PROJECT_ID=$(echo "$AGENTS_JSON" | python3 -c "import sys,json; print(json.load(sys.stdin)['data'][0]['projectId'])")
AGENT_ID_LIST=$(echo "$AGENTS_JSON" | python3 -c "
import sys, json
data = json.load(sys.stdin)['data']
ids = [a['id'] for a in data[:3]]  # Take up to 3 agents
print(json.dumps(ids))
")
ok "Project: $PROJECT_ID"

# -------------------------------------------------------------------
# 3. Create tournament
# -------------------------------------------------------------------
log "Creating tournament..."
TOURNAMENT_JSON=$(curl -sf -X POST "$SERVER/api/tournaments" \
  -H "Content-Type: application/json" \
  -d "{
    \"projectId\": \"$PROJECT_ID\",
    \"name\": \"Test Tournament $(date +%H%M%S)\",
    \"agentIds\": $AGENT_ID_LIST,
    \"config\": {
      \"symbols\": [\"AAPL\", \"MSFT\"],
      \"startDate\": \"2022-01-01\",
      \"endDate\": \"2023-01-01\",
      \"timeframe\": \"1Day\",
      \"initialCapital\": 100000,
      \"slippageBps\": 5,
      \"feePerShare\": 0.01,
      \"seed\": 42,
      \"checkpointInterval\": 50
    }
  }")

TOURNAMENT_ID=$(echo "$TOURNAMENT_JSON" | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['id'])")
ok "Tournament created: $TOURNAMENT_ID"

# -------------------------------------------------------------------
# 4. Verify tournament in pending state
# -------------------------------------------------------------------
STATUS=$(curl -sf "$SERVER/api/tournaments/$TOURNAMENT_ID" | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['status'])")
[ "$STATUS" = "pending" ] && ok "Status: pending" || fail "Expected pending, got: $STATUS"

# -------------------------------------------------------------------
# 5. Start tournament
# -------------------------------------------------------------------
log "Starting tournament..."
START_RESP=$(curl -sf -X POST "$SERVER/api/tournaments/$TOURNAMENT_ID/start")
ok "Tournament started"

# -------------------------------------------------------------------
# 6. Poll until complete (timeout 120s)
# -------------------------------------------------------------------
log "Waiting for tournament to complete (timeout: 120s)..."
TIMEOUT=120
ELAPSED=0
while [ $ELAPSED -lt $TIMEOUT ]; do
  POLL=$(curl -sf "$SERVER/api/tournaments/$TOURNAMENT_ID")
  STATUS=$(echo "$POLL" | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['status'])")
  COMPLETED=$(echo "$POLL" | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['completedCount'])")
  TOTAL=$(echo "$POLL" | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['agentCount'])")

  if [ "$STATUS" = "completed" ] || [ "$STATUS" = "partially_failed" ]; then
    break
  elif [ "$STATUS" = "failed" ] || [ "$STATUS" = "cancelled" ]; then
    fail "Tournament ended with status: $STATUS"
  fi

  echo -ne "\r  Progress: $COMPLETED/$TOTAL agents complete ($ELAPSED/${TIMEOUT}s)"
  sleep 3
  ELAPSED=$((ELAPSED + 3))
done
echo ""

if [ "$STATUS" = "completed" ]; then
  ok "Tournament completed successfully"
elif [ "$STATUS" = "partially_failed" ]; then
  warn "Tournament partially failed (some agents succeeded)"
else
  fail "Tournament timed out after ${TIMEOUT}s. Status: $STATUS"
fi

# -------------------------------------------------------------------
# 7. Check leaderboard
# -------------------------------------------------------------------
log "Fetching leaderboard..."
LEADERBOARD=$(curl -sf "$SERVER/api/tournaments/$TOURNAMENT_ID/leaderboard")
LB_COUNT=$(echo "$LEADERBOARD" | python3 -c "import sys,json; print(len(json.load(sys.stdin)['data']))")

if [ "$LB_COUNT" -gt 0 ]; then
  ok "Leaderboard has $LB_COUNT entries"
  echo "$LEADERBOARD" | python3 -c "
import sys, json
data = json.load(sys.stdin)['data']
print()
print('  Rank  Agent                 Return       Sharpe    Max DD')
print('  ----  --------------------  -----------  --------  --------')
for e in data:
    ret = float(e.get('totalReturn', 0)) * 100
    sharpe = float(e.get('sharpeRatio', 0))
    dd = float(e.get('maxDrawdown', 0)) * 100
    print(f\"  {e['rank']:>4}  {e['agentName']:<20}  {ret:>9.2f}%  {sharpe:>8.4f}  {dd:>7.2f}%\")
print()
"
else
  warn "No leaderboard entries (runs may have failed)"
fi

# -------------------------------------------------------------------
# 8. Check comparison data
# -------------------------------------------------------------------
log "Fetching comparison data..."
COMPARISON=$(curl -sf "$SERVER/api/tournaments/$TOURNAMENT_ID/comparison")
COMP_COUNT=$(echo "$COMPARISON" | python3 -c "
import sys, json
data = json.load(sys.stdin)['data']
for c in data:
    print(f\"  {c['agentName']}: {len(c['snapshots'])} snapshots\")
print(len(data))
" | tail -1)
ok "Comparison data for $COMP_COUNT agents"

# -------------------------------------------------------------------
# 9. Test agent isolation
# -------------------------------------------------------------------
log "Testing agent isolation..."
FIRST_AGENT=$(echo "$AGENTS_JSON" | python3 -c "import sys,json; print(json.load(sys.stdin)['data'][0]['id'])")
SECOND_AGENT=$(echo "$AGENTS_JSON" | python3 -c "import sys,json; print(json.load(sys.stdin)['data'][1]['id'])")

# Agent A accessing Agent B's data should return 403
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" \
  "$SERVER/api/agents/$SECOND_AGENT?agentContext=$FIRST_AGENT")

if [ "$HTTP_CODE" = "403" ]; then
  ok "Isolation enforced: Agent cross-access returns 403"
else
  warn "Isolation check returned $HTTP_CODE (expected 403)"
fi

# Agent A accessing own data should succeed
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" \
  "$SERVER/api/agents/$FIRST_AGENT?agentContext=$FIRST_AGENT")

if [ "$HTTP_CODE" = "200" ]; then
  ok "Self-access allowed: own data returns 200"
else
  warn "Self-access returned $HTTP_CODE (expected 200)"
fi

# -------------------------------------------------------------------
# 10. Summary
# -------------------------------------------------------------------
echo ""
log "========================================="
log " Tournament Test Complete!"
log " ID: $TOURNAMENT_ID"
log " Status: $STATUS"
log " Leaderboard: $LB_COUNT entries"
log " UI: http://localhost:5173/tournaments/$TOURNAMENT_ID"
log "========================================="
