#!/usr/bin/env bash
# Debug: trace where an item's quantity comes from (e.g. admin shows 0, client view shows 2).
# Requires dev server running: npm run dev
# Usage:
#   ./scripts/debug-meal-plan-quantity.sh
#   ./scripts/debug-meal-plan-quantity.sh 2026-03-15
#   ./scripts/debug-meal-plan-quantity.sh 2026-03-15 tuna
set -e
BASE="${MEAL_PLAN_DEBUG_URL:-http://localhost:3000}"
DATE="${1:-2026-03-09}"
ITEM="${2:-tuna}"
URL="${BASE}/api/debug/meal-plan?date=${DATE}&item=${ITEM}"
echo "GET $URL"
echo "---"
curl -s "$URL" | jq .
