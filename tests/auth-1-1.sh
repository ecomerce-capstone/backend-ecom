#!/usr/bin/env bash
# tests/auth-1-1.sh
set -euo pipefail

BASE="http://localhost:4000"
TMPDIR="/tmp/ecom-tests"
mkdir -p "$TMPDIR"

echo "=== 1) REGISTER CUSTOMER (user) -> POST /auth/register"
curl -s -o "$TMPDIR/register_user.json" -w "HTTP:%{http_code}\n" -X POST "$BASE/auth/register" \
  -H "Content-Type: application/json" \
  -d '{
    "fullName":"Test User",
    "email":"testuser+1@example.com",
    "password":"Secret123!"
  }'
echo "Response:"
cat "$TMPDIR/register_user.json" | jq .

echo
echo "=== 2) REGISTER VENDOR -> POST /auth/register/vendor"
curl -s -o "$TMPDIR/register_vendor.json" -w "HTTP:%{http_code}\n" -X POST "$BASE/auth/register/vendor" \
  -H "Content-Type: application/json" \
  -d '{
    "name":"Vendor Demo",
    "email":"vendordemo+1@example.com",
    "password":"VendorPass123!",
    "phone":"081234567890",
    "storeName":"Vendor Demo Store",
    "storeDescription":"Testing vendor store"
  }'
echo "Response:"
cat "$TMPDIR/register_vendor.json" | jq .

echo
echo "=== 3) LOGIN CUSTOMER -> POST /auth/login"
curl -s -o "$TMPDIR/login_user.json" -w "HTTP:%{http_code}\n" -X POST "$BASE/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"email":"testuser+1@example.com","password":"Secret123!"}'
echo "Response:"
cat "$TMPDIR/login_user.json" | jq .

echo
echo "=== 4) LOGIN VENDOR -> POST /auth/login (role=vendor)"
curl -s -o "$TMPDIR/login_vendor.json" -w "HTTP:%{http_code}\n" -X POST "$BASE/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"email":"vendordemo+1@example.com","password":"VendorPass123!","role":"vendor"}'
echo "Response:"
cat "$TMPDIR/login_vendor.json" | jq .

# --- extract token(s) robustly (works with many response shapes) ---
# strategy: search anywhere in JSON for a key named "token"
extract_token() {
  local file="$1"
  # find the first non-null token value anywhere in the JSON
  jq -r '.. | objects | .token? // empty' "$file" | sed -n '1p'
}

USER_TOKEN=$(extract_token "$TMPDIR/login_user.json" || true)
VENDOR_TOKEN=$(extract_token "$TMPDIR/login_vendor.json" || true)

if [ -z "$USER_TOKEN" ] || [ "$USER_TOKEN" = "null" ]; then
  echo "WARNING: could not extract USER token automatically. Check $TMPDIR/login_user.json"
else
  echo "Extracted USER_TOKEN (trimmed): ${USER_TOKEN:0:20}..."
  export USER_TOKEN
fi

if [ -z "$VENDOR_TOKEN" ] || [ "$VENDOR_TOKEN" = "null" ]; then
  echo "WARNING: could not extract VENDOR token automatically. Check $TMPDIR/login_vendor.json"
else
  echo "Extracted VENDOR_TOKEN (trimmed): ${VENDOR_TOKEN:0:20}..."
  export VENDOR_TOKEN
fi

echo
echo "=== 5) CHECK PROTECTED ROUTE /users/me (requires user token) ==="
if [ -n "${USER_TOKEN:-}" ]; then
  curl -s -H "Authorization: Bearer $USER_TOKEN" "$BASE/users/me" | jq .
else
  echo "Skipping /users/me because no USER_TOKEN"
fi

echo
echo "Done. Tmp files in $TMPDIR"
