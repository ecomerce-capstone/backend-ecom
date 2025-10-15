#!/usr/bin/env bash
# tests/forgot-and-reset.sh
set -euo pipefail

BASE="http://localhost:4000"
EMAIL="testuser+1@example.com"
TMP="/tmp/ecom-tests"

mkdir -p "$TMP"

echo "Requesting forgot-password for $EMAIL"
curl -s -o "$TMP/forgot_resp.json" -w "HTTP:%{http_code}\n" -X POST "$BASE/auth/forgot-password" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL\"}"
echo "Response:"
cat "$TMP/forgot_resp.json" | jq .

echo
echo "NOW: get the token either from Mailtrap inbox (check the reset-email) or use dev debug mode (see instructions)."
echo "If you have a token, run:"
echo "curl -X POST $BASE/auth/reset-password -H 'Content-Type: application/json' -d '{\"token\":\"<TOKEN>\",\"password\":\"NewSecret123!\"}' | jq ."
