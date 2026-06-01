#!/usr/bin/env bash
# End-to-end smoke test for the student-tracker backend.
# Runs every CRUD verb, every custom function, and an upload round-trip.
set -uo pipefail

API="${API:-http://localhost:4000}"
PASS=0
FAIL=0
declare -a FAILS

step() { printf "\n\033[1;36m▶ %s\033[0m\n" "$*"; }
ok()   { printf "  \033[32m✓\033[0m %s\n" "$*"; PASS=$((PASS+1)); }
bad()  { printf "  \033[31m✗\033[0m %s — %s\n" "$1" "$2"; FAIL=$((FAIL+1)); FAILS+=("$1: $2"); }

call() {                       # call METHOD PATH BODY [HEADER]
  local method="$1" path="$2" body="${3:-}" extra="${4:-}"
  local args=(-s -X "$method" "$API$path" -H "Content-Type: application/json")
  [[ -n "$TOKEN" ]] && args+=(-H "Authorization: Bearer $TOKEN")
  [[ -n "$extra" ]] && args+=(-H "$extra")
  [[ -n "$body" ]] && args+=(--data "$body")
  curl "${args[@]}"
}

assert_field() {               # assert_field LABEL JSON KEY
  local label="$1" json="$2" key="$3"
  local v
  v=$(printf '%s' "$json" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{const o=JSON.parse(s);console.log(o['$key']??'')}catch(e){console.log('')}})")
  if [[ -n "$v" && "$v" != "null" && "$v" != "undefined" ]]; then ok "$label ($key=$v)"; else bad "$label" "missing $key in $json"; fi
}

assert_status() {
  local label="$1" want="$2" got="$3"
  if [[ "$got" == "$want" ]]; then ok "$label ($want)"; else bad "$label" "want $want got $got"; fi
}

extract() { node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{const o=JSON.parse(s);console.log(o['$1']??'')}catch(e){}}"; }

TOKEN=""

# ─────────────────────────────────────────────────────────────
step "Health"
H=$(curl -s -o /dev/null -w "%{http_code}" "$API/health")
assert_status "GET /health" 200 "$H"

step "Register (first user → super_admin)"
ts=$(date +%s)
EMAIL="admin+${ts}@example.com"
REG=$(call POST /api/auth/register "{\"email\":\"$EMAIL\",\"password\":\"Password123!\",\"full_name\":\"Admin User\"}")
assert_field "register returns token" "$REG" "token"
TOKEN=$(echo "$REG" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const o=JSON.parse(s);console.log(o.token)})")
USER_ID=$(echo "$REG" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const o=JSON.parse(s);console.log(o.user.id)})")

step "Login + me"
LOGIN=$(call POST /api/auth/login "{\"email\":\"$EMAIL\",\"password\":\"Password123!\"}")
assert_field "login returns token" "$LOGIN" "token"
TOKEN=$(echo "$LOGIN" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const o=JSON.parse(s);console.log(o.token)})")
ME=$(call GET /api/auth/me)
assert_field "me returns user" "$ME" "email"

step "Register second user with role + mentor users"
for r in junior_mentor senior_mentor finance_admin broker_admin academic_head; do
  R=$(call POST /api/auth/register "{\"email\":\"${r}+${ts}@example.com\",\"password\":\"Password123!\",\"full_name\":\"${r} User\",\"app_role\":\"${r}\"}")
  if echo "$R" | grep -q '"token"'; then ok "register $r"; else bad "register $r" "$R"; fi
done

step "Entity CRUD: Student"
CREATE=$(call POST /api/entities/Student '{"student_code":"S-TEST-1","full_name":"Alice T","email":"alice@example.com","status":"active","primary_mentor_id":"abc","primary_mentor_name":"Mentor X"}')
assert_field "create student" "$CREATE" "id"
SID=$(echo "$CREATE" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const o=JSON.parse(s);console.log(o.id)})")

LIST=$(call GET /api/entities/Student)
if echo "$LIST" | grep -q "$SID"; then ok "list returns created student"; else bad "list student" "$LIST"; fi

FILTERED=$(call POST /api/entities/Student/filter '{"query":{"status":"active"},"limit":50}')
if echo "$FILTERED" | grep -q "$SID"; then ok "filter status=active"; else bad "filter" "$FILTERED"; fi

GET=$(call GET "/api/entities/Student/$SID")
assert_field "get by id" "$GET" "full_name"

UPD=$(call PATCH "/api/entities/Student/$SID" '{"student_level":"LEVEL_2"}')
assert_field "update student" "$UPD" "student_level"

BULK=$(call POST /api/entities/Student/bulk '[{"student_code":"S-BULK-1","full_name":"Bulk One","status":"active"},{"student_code":"S-BULK-2","full_name":"Bulk Two","status":"active"}]')
if [[ "$(echo "$BULK" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{console.log(JSON.parse(s).length)})")" == "2" ]]; then ok "bulkCreate 2 students"; else bad "bulkCreate" "$BULK"; fi

DEL=$(call DELETE "/api/entities/Student/$SID")
if echo "$DEL" | grep -q '"ok":true'; then ok "delete student"; else bad "delete" "$DEL"; fi

step "Entity CRUD: FundingTransaction (DEPOSIT)"
FT=$(call POST /api/entities/FundingTransaction "{\"type\":\"DEPOSIT\",\"status\":\"APPROVED\",\"student_id\":\"stu-1\",\"student_name\":\"Alice T\",\"primary_mentor_id\":\"$USER_ID\",\"primary_mentor_name\":\"Admin User\",\"initiating_mentor_id\":\"$USER_ID\",\"amount_usd\":5000,\"payment_method\":\"crypto\",\"requested_by_id\":\"$USER_ID\",\"requested_at\":\"$(date -u +%Y-%m-%dT%H:%M:%S.000Z)\"}")
assert_field "create funding tx" "$FT" "id"

step "Entity CRUD: Ticket + TicketMessage + Notification"
TK=$(call POST /api/entities/Ticket "{\"ticket_number\":\"TKT-00001\",\"title\":\"Need help\",\"description\":\"desc\",\"category\":\"academic\",\"priority\":\"medium\",\"status\":\"open\",\"created_by_id\":\"$USER_ID\",\"created_by_name\":\"Admin\",\"assigned_to_role\":\"academic_head\"}")
TID=$(echo "$TK" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const o=JSON.parse(s);console.log(o.id)})")
assert_field "create ticket" "$TK" "ticket_number"
TM=$(call POST /api/entities/TicketMessage "{\"ticket_id\":\"$TID\",\"sender_id\":\"$USER_ID\",\"sender_name\":\"Admin\",\"sender_role\":\"super_admin\",\"message\":\"Hello\",\"message_type\":\"user_message\"}")
assert_field "create ticket message" "$TM" "id"
NF=$(call POST /api/entities/Notification "{\"user_id\":\"$USER_ID\",\"title\":\"Hi\",\"message\":\"Welcome\",\"type\":\"general\"}")
assert_field "create notification" "$NF" "id"

step "Functions: getAllUsers"
GAU=$(call POST /api/functions/getAllUsers '{}')
if echo "$GAU" | grep -q '"users"'; then ok "getAllUsers returns array"; else bad "getAllUsers" "$GAU"; fi

step "Functions: updateUser"
UU=$(call POST /api/functions/updateUser "{\"userId\":\"$USER_ID\",\"userData\":{\"commission_rate\":5}}")
assert_field "updateUser sets commission_rate" "$UU" "user"

step "Functions: getReportsData"
GRD=$(call POST /api/functions/getReportsData '{"startDate":"2020-01-01","endDate":"2030-12-31"}')
if echo "$GRD" | grep -q '"rows"'; then ok "getReportsData rows"; else bad "getReportsData" "$GRD"; fi

step "Functions: getMentorCommissions"
GMC=$(call POST /api/functions/getMentorCommissions '{"startDate":"2020-01-01","endDate":"2030-12-31"}')
if echo "$GMC" | grep -q '"rows"'; then ok "getMentorCommissions rows"; else bad "getMentorCommissions" "$GMC"; fi

step "Functions: generateQuarterlyLedgers"
GQL=$(call POST /api/functions/generateQuarterlyLedgers '{}')
if echo "$GQL" | grep -q '"success":true'; then ok "generateQuarterlyLedgers"; else bad "generateQuarterlyLedgers" "$GQL"; fi

step "Functions: autoCloseResolvedTickets + checkTicketEscalation"
ACR=$(call POST /api/functions/autoCloseResolvedTickets '{}')
if echo "$ACR" | grep -q '"closed"'; then ok "autoCloseResolvedTickets"; else bad "autoCloseResolvedTickets" "$ACR"; fi
CTE=$(call POST /api/functions/checkTicketEscalation '{}')
if echo "$CTE" | grep -q '"escalated"'; then ok "checkTicketEscalation"; else bad "checkTicketEscalation" "$CTE"; fi

step "Functions: sendTicketNotification"
STN=$(call POST /api/functions/sendTicketNotification "{\"title\":\"X\",\"message\":\"Y\",\"type\":\"general\",\"assignedToRole\":\"academic_head\"}")
if echo "$STN" | grep -q '"success":true'; then ok "sendTicketNotification"; else bad "sendTicketNotification" "$STN"; fi

step "Functions: processWithdrawal"
PW=$(call POST /api/functions/processWithdrawal '{}')
if echo "$PW" | grep -q '"success":true'; then ok "processWithdrawal"; else bad "processWithdrawal" "$PW"; fi

step "Integrations: SendEmail / SendSMS / GenerateImage / ExtractDataFromUploadedFile / InvokeLLM"
SE=$(call POST /api/integrations/SendEmail '{"to":"x@example.com","subject":"hi","body":"yo"}')
if echo "$SE" | grep -q '"ok":true'; then ok "SendEmail (stub)"; else bad "SendEmail" "$SE"; fi
SS=$(call POST /api/integrations/SendSMS '{"to":"+1234567890","message":"hi"}')
if echo "$SS" | grep -q '"ok":true'; then ok "SendSMS (stub)"; else bad "SendSMS" "$SS"; fi
GI=$(call POST /api/integrations/GenerateImage '{}')
if echo "$GI" | grep -q '"stub":true'; then ok "GenerateImage (stub)"; else bad "GenerateImage" "$GI"; fi
EX=$(call POST /api/integrations/ExtractDataFromUploadedFile '{"file_url":"http://example.com/x.pdf"}')
if echo "$EX" | grep -q '"stub":true'; then ok "ExtractDataFromUploadedFile (stub)"; else bad "ExtractData" "$EX"; fi
ILM=$(call POST /api/integrations/InvokeLLM '{"prompt":"hello"}')
if echo "$ILM" | grep -q '"output"'; then ok "InvokeLLM (stub)"; else bad "InvokeLLM" "$ILM"; fi

step "Integrations: UploadFile round-trip"
TMPFILE=$(mktemp /tmp/upload-XXXXX.txt)
echo "the quick brown fox" > "$TMPFILE"
UP=$(curl -s -X POST "$API/api/integrations/UploadFile" -H "Authorization: Bearer $TOKEN" -F "file=@${TMPFILE}")
URL=$(echo "$UP" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const o=JSON.parse(s);console.log(o.file_url||'')})")
if [[ -n "$URL" ]]; then ok "UploadFile returned $URL"; else bad "UploadFile" "$UP"; fi
DL=$(curl -s "$URL")
if [[ "$DL" == "the quick brown fox" ]]; then ok "downloaded file matches"; else bad "download" "got: $DL"; fi

step "Auth: change-password + relogin"
CP=$(call POST /api/auth/change-password '{"current_password":"Password123!","new_password":"NewPassword456!"}')
if echo "$CP" | grep -q '"ok":true'; then ok "change-password"; else bad "change-password" "$CP"; fi
RL=$(call POST /api/auth/login "{\"email\":\"$EMAIL\",\"password\":\"NewPassword456!\"}")
assert_field "relogin with new password" "$RL" "token"

step "Auth: bad password rejected"
BAD=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$API/api/auth/login" -H "Content-Type: application/json" --data "{\"email\":\"$EMAIL\",\"password\":\"wrong\"}")
assert_status "login wrong password" 401 "$BAD"

step "Auth: protected route without token"
NA=$(curl -s -o /dev/null -w "%{http_code}" "$API/api/auth/me")
assert_status "/me without token" 401 "$NA"

echo
printf "\n\033[1m═══ Results: %d passed, %d failed ═══\033[0m\n" "$PASS" "$FAIL"
if (( FAIL > 0 )); then
  printf "\033[31mFailures:\033[0m\n"
  printf "  - %s\n" "${FAILS[@]}"
  exit 1
fi
