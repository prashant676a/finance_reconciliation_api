#!/usr/bin/env bash
set -euo pipefail

# Requires the API to be running. This creates records and reconciles all orders.
base_url="${BASE_URL:-http://localhost:3000}"
run_id="demo-$(node -e 'console.log(require("node:crypto").randomUUID())')"
last_body=""

step() {
  printf '\n%s\n' "$1"
  if [[ -t 0 && "${DEMO_AUTO:-0}" != "1" ]]; then
    read -r -p 'Press Enter to send the request... ' _
  fi
}

request_api() {
  local method="$1" path="$2" expected_status="$3" body="${4:-}"
  local args=(--silent --show-error --max-time 15 --request "$method")
  if [[ -n "$body" ]]; then
    args+=(--header 'Content-Type: application/json' --data "$body")
  fi
  local response status
  response=$(curl "${args[@]}" --write-out $'\n%{http_code}' "$base_url$path")
  status="${response##*$'\n'}"
  last_body="${response%$'\n'*}"
  printf '%s' "$last_body" | node -e 'let text=""; process.stdin.on("data", chunk => text += chunk); process.stdin.on("end", () => console.log(JSON.stringify(JSON.parse(text), null, 2)));'
  printf 'HTTP %s (expected %s)\n' "$status" "$expected_status"
  [[ "$status" == "$expected_status" ]]
}

printf 'Rehearsal prefix: %s\nAPI: %s\n' "$run_id" "$base_url"

step '1. Check the HTTP server.'
request_api GET /health 200

step '2. Create three orders, each expecting 10,000 paisa.'
for name in matched short missing; do
  request_api POST /api/orders 201 "{\"orderRef\":\"$run_id-$name\",\"customerName\":\"Demo Customer\",\"expectedAmountPaisa\":10000}"
done

step '3. Record a full payment and a partial payment.'
request_api POST /api/settlements 201 "{\"settlementRef\":\"$run_id-full\",\"orderRef\":\"$run_id-matched\",\"settledAmountPaisa\":10000}"
request_api POST /api/settlements 201 "{\"settlementRef\":\"$run_id-partial\",\"orderRef\":\"$run_id-short\",\"settledAmountPaisa\":9500}"

step '4. Reconcile and inspect the order statuses and exceptions.'
request_api POST /api/reconciliations/run 200
request_api GET /api/orders 200
request_api GET '/api/exceptions?status=OPEN' 200
missing_id=$(printf '%s' "$last_body" | node -e 'let text=""; process.stdin.on("data", chunk => text += chunk); process.stdin.on("end", () => { const row=JSON.parse(text).data.find(row => row.order_ref === process.argv[1]); if (!row) process.exit(1); console.log(row.id); });' "$run_id-missing")

step '5. Rerun reconciliation: the same orders still have only one exception each.'
request_api POST /api/reconciliations/run 200
request_api GET '/api/exceptions?status=OPEN' 200

step '6. Receive the remaining 500 paisa; the short order should now match.'
request_api POST /api/settlements 201 "{\"settlementRef\":\"$run_id-topup\",\"orderRef\":\"$run_id-short\",\"settledAmountPaisa\":500}"
request_api POST /api/reconciliations/run 200
request_api GET '/api/exceptions?status=RESOLVED' 200

step '7. Record a manual review decision. This does not manufacture a payment.'
request_api PATCH "/api/exceptions/$missing_id/resolve" 200 '{"resolutionNote":"Reviewed: remaining difference accepted for this demo","resolvedBy":"Demo Reviewer"}'
request_api GET /api/reports/summary 200

step '8. Show a settlement that arrived before its order.'
request_api POST /api/settlements 201 "{\"settlementRef\":\"$run_id-early\",\"orderRef\":\"$run_id-late-order\",\"settledAmountPaisa\":10000}"
request_api GET /api/settlements/unmatched 200

step '9. Show validation and duplicate protection.'
request_api POST /api/orders 400 "{\"orderRef\":\"$run_id-invalid\",\"customerName\":\"Demo Customer\",\"expectedAmountPaisa\":-1}"
request_api POST /api/orders 409 "{\"orderRef\":\"$run_id-matched\",\"customerName\":\"Demo Customer\",\"expectedAmountPaisa\":10000}"

printf '\nDemo complete. Find its records by prefix: %s\n' "$run_id"
