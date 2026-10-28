#!/usr/bin/env bash
# api.check.sh — checks the v2 document API against a running server + the real Supabase project.
# Demo files only (never real EOBs from RemitApp/pdfs/). Clears all demo documents before and after.
# Run:  APP_PASSCODE=check-pass-123456 PORT=3440 node server.js &   then   bash api.check.sh   → prints API OK
set -euo pipefail
B=${B:-http://127.0.0.1:3440}
P=${P:-check-pass-123456}
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
J=$T/jar
code() { curl -s -o "$T/out" -w '%{http_code}' -b "$J" "$@"; }
expect() { [ "$1" = "$2" ] || { echo "FAIL: $3: got $1, want $2"; cat "$T/out"; echo; exit 1; }; }
up() { code -X POST -H "content-type: application/pdf" -H "x-file-name: $(basename "$1")" --data-binary "@$1" "$B/api/docs"; }

expect "$(curl -s -o "$T/out" -w '%{http_code}' "$B/api/docs")" 401 "list without a session"
curl -s -o /dev/null -c "$J" -d "passcode=$P" "$B/login"
expect "$(code -X DELETE "$B/api/docs")" 200 "clear demo data"

F=demo/batch-1/b1-01-clean-all-paid.pdf
expect "$(up $F)" 201 "upload a demo EOB"
ID=$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1])).id)' "$T/out")
expect "$(up $F)" 409 "same file again"

LC_ALL=C sed 's/REMIT-DEMO-SYNTHETIC/XXXXXXXXXXXXXXXXXXXX/' "$F" > "$T/stripped.pdf"
expect "$(up "$T/stripped.pdf")" 422 "PDF without the demo stamp"
echo "not a pdf" > "$T/text.pdf"
expect "$(up "$T/text.pdf")" 422 "text file named .pdf"

expect "$(code -X PATCH -H 'content-type: application/json' -d '{"stage":"reviewed"}' "$B/api/docs/$ID")" 200 "mark reviewed"
grep -q '"stage":"reviewed"' "$T/out" || { echo "FAIL: stage not saved"; exit 1; }
expect "$(code -X PATCH -H 'content-type: application/json' -d '{"stage":"done"}' "$B/api/docs/$ID")" 400 "invalid stage"
expect "$(code -X PATCH -H 'content-type: application/json' -d '{"stage":null}' "$B/api/docs/$ID")" 200 "reopen"

expect "$(code "$B/api/docs/$ID/pdf")" 200 "open the PDF"
head -c 4 "$T/out" | grep -q '%PDF' || { echo "FAIL: PDF body"; exit 1; }
expect "$(code "$B/api/docs")" 200 "list"

# A malformed URL must be a 400, not a crash that signs everyone out.
expect "$(code "$B/%E0")" 400 "malformed URL"
expect "$(code "$B/api/docs")" 200 "server still running after a malformed URL"

# A row left 'pending' with nothing queued (Supabase blip during the AI's error write, insert retried after a dropped
# connection, startup re-queue skipped) must be picked up again by the next list call, never stuck on "AI…".
STUCK=$(node --input-type=module -e '
  import { randomBytes } from "node:crypto";
  import { insertDoc } from "./store.js";
  import { demos, eobPages } from "./demo/make-demos.js";
  const row = await insertDoc({ file_name: "stuck.pdf", sha256: randomBytes(32).toString("hex"), pdf_path: "none.pdf", lines: eobPages(demos(new Date())[1]) });
  console.log(row.id);')
for i in $(seq 1 30); do
  code "$B/api/docs" > /dev/null
  S=$(node -e 'const r=JSON.parse(require("fs").readFileSync(process.argv[1])).find(r=>r.id===process.argv[2]); console.log(r.ai_status)' "$T/out" "$STUCK")
  [ "$S" != "pending" ] && break; sleep 2
done
[ "$S" != "pending" ] || { echo "FAIL: stuck pending row was never picked up"; exit 1; }

expect "$(code -X DELETE "$B/api/docs")" 200 "clear demo data"
grep -q '"deleted":2' "$T/out" || { echo "FAIL: deleted count"; cat "$T/out"; exit 1; }
echo "API OK"
