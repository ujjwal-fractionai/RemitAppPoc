# FLOW — POC: how execution travels

Exact call paths, file → function, in order. Update the relevant section whenever you change one of these paths, and say in [HANDOVER.md](HANDOVER.md) which path you are modifying.

Notation: `file:function()`. All paths are relative to `POC/`.

---

## 1. Page load and passcode (POC)

```
Browser GET /
└─ server.js: createServer handler
   ├─ authed(req)                       cookie remit_session = "<expiry>.<HMAC>" checked with SESSION_KEY (stateless, 12 h)
   │   └─ no/expired → redirect 303 /login  (or /login?e=expired if a stale cookie was sent)
   └─ authed → static file from public/ (path-normalised, CSP + no-store headers via send())

GET /login  → loginPage(res, error)      reads login.html, injects a fixed error message (never user input)
POST /login → handleLogin(req, res)
   ├─ ipOf(req) locked? (fails Map: 5 wrong tries → 15 min) → loginPage("locked") 429
   ├─ passcodeOk(given)  sha256 + timingSafeEqual against APP_PASSCODE
   │   ├─ wrong → count++, 500 ms delay, loginPage("wrong" | "locked")
   │   └─ right → cookie "<now+12h>.<HMAC(expiry)>", Set-Cookie HttpOnly SameSite=Strict, 303 /
GET /logout → clear cookie (no server state to delete), 303 /login        (sidebar "Lock" link)
```

If `APP_PASSCODE` is empty: everything is open, and the server refuses to start unless `HOST` is local.

## 2. Load, upload and board (v2)

```
public/app.js (module, loaded by index.html)
  start: GET /api/config → storeOk = (supabase === "ok")
     ├─ not ok → banner "Supabase is not configured / unreachable", #file disabled, no data calls
     └─ ok → render() + refresh()
  refresh()                                   GET /api/docs → rows (newest first)
     └─ toEntry(row): r = eob.js:analyze(parseEob(row.lines.flat()))     ← re-analysed every load
                      stage = row.stage === "reviewed" ? "reviewed" : eob.js:autoStage(r)
        redraw only if ids/stages/ai_status changed; poll again in 4 s while any ai_status = pending
        network error → banner "Couldn't load documents… Retrying…" and keep polling; 401 → stop ("Locked…")
  render()  by hash: #dashboard (default) · #documents · #documents/list · #doc/<id>[/<claim>] · #rules
     ├─ dashboard.js:renderDashboard()        summarize(all) · attentionItems(not reviewed) · money bar · denial reasons
     ├─ documents.js:renderDocuments(mode)    board: 4 columns by stage · list: table · issueBadges(entry)
     ├─ doc.js:renderDoc(entry, claim)        stored document view (§2a)
     └─ rules.js:renderRules()                re-rendered each visit (§5)
  upload: #file change / drop on Dashboard or Documents → uploadFiles(files)   (one at a time)
     per file: readPdf(browser pdf.js, copy) → Subject ≠ DEMO_MARKER → rejected locally (NOT_DEMO)
               POST /api/docs (raw PDF, x-file-name) → 201 → refresh() (card appears) | 409 → "duplicate skipped" | 4xx/5xx → rejected + reason
     progress card: "Processing i of n …" → "Uploaded k of n · x duplicate skipped · y rejected" + reasons
  Mark reviewed / Reopen (card, list row, document view) → setStage(id, "reviewed" | null) → PATCH → refresh()
```

### 2a. Document view (`doc.js:renderDoc`)
Header: ← Documents · file name · stage badge · Mark reviewed / "Reviewed <date> · Reopen" · Open PDF (`/api/docs/<id>/pdf`, new tab).
Body = v1 breakdown from `entry.r`: payment card, `pipCard`, warnings, bucket `tile`s, AI box (`aiContent(entry)` from `row.ai_status`: pending skeleton / error + Try again → `retryAi` / summary), `pairRow`s, `drawClaims` (+ `lineTable`, `describe`), glossary. `#doc/<id>/<claim>` expands that claim's row and scrolls to it. A link to a document not yet in the list → re-fetch once, then "Document not found".

## 3. Inside `eob.js:analyze(r, today)` (order matters)

```
r.pip = PIP_PAYER regex on r.payer                (PIP_PAYER_WORDS)
for each claim c (document order):
   label C1.., patient label (by member + name)
   billed / allowed / paid (NET) / pr (all PR adjustments incl. deductible + coins columns)
   per line: balance check → warning; denied = $0 and DENY_GROUPS reason not in CONTRACTUAL or BENEFIT_MAX
   nextPayerAmount = Σ adjustments with BENEFIT_MAX reason (119)
   claim checks: Σ line paid == NET; PR == PT RESP (skipped for reversals)
   c.bucket = bucket(c)          REVERSED → NEXT_PAYER → DENIED(4) → PATIENT_RESP / DENIED($0) → PARTIAL → PAID
pairing: each status-22 claim → first free non-22 claim with same ACNT and
         (opposite charge + same procKey) else (same dateKey)  → r.pairs[], c.pair both ways
follow-up: if any NEXT_PAYER and CHECK DATE parsed → due = check date + NEXT_PAYER_FILING_DAYS,
           status open / due soon (≤ DUE_SOON_DAYS) / overdue
c.playbook = DENIAL_PLAYBOOK rows for the claim's denial codes (denialPlaybook; CO row also matches OA/PI)
c.action = nextAction(c, r)     needs bucket, pair, followUp and playbook → must run last
payment checks: Σ paid − Σ PLB == CHECK AMT (r.reconciled); TOTALS row count + paid
```

## 4. AI (server-side queue, v2)

```
server.js
  POST /api/docs success → enqueue(id)      (also: startup re-queues every ai_status = pending; POST /api/docs/:id/ai = Try again)
  pump(): up to 2 runAi(id) at a time
  runAi(id): no GEMINI_API_KEY → ai_status error
             getDoc → analyze(parseEob(lines.flat())) → deidentify → insights(payload)
                 → Gemini generateContent (PROMPT + SCHEMA, temperature 0.2, 45 s timeout)
             → updateDoc { ai: {summary, actions, reversals, watch, model, ms}, ai_status: "done" }
             error/timeout → updateDoc { ai_status: "error", ai_error: message }
browser: polling (§2) picks up the new status; the AI box re-renders from the row.
```
Gemini still receives only `deidentify()` output (no names, IDs, NPIs, dates).

## 5. Rules & settings tab

```
#rules → rules.js:renderRules()   (every visit)
  ├─ constants from eob.js (CONTRACTUAL, DENY_GROUPS, BENEFIT_MAX, PIP_PAYER_WORDS, DE_PIP_MINIMUM,
  │  NEXT_PAYER_FILING_DAYS, DUE_SOON_DAYS, FOLLOW_UP_AFTER_DAYS, STAGES, DEMO_MARKER, DEMO_FOOTER)
  ├─ GET /api/config → model, aiEnabled, passcode, sessionHours, maxFails, lockMinutes, supabase
  └─ Storage card: Supabase status · stored count · Clear demo data → in-page confirm → DELETE /api/docs → refresh()
```

## 6. Tests and demo PDFs

```
npm test (POC) → node --test → eob.test.js   (40 tests)
   ├─ inline synthetic EOB text → parseEob → analyze → assertions
   ├─ for each DEMOS[d] in demo/make-demos.js: eobPages(d).flat() → parseEob → analyze → d.expect
   └─ deidentify() output must not contain names / IDs / dates
node demo/make-demos.js → demos(today) → eobPages(spec) → pdf(pages) → demo/*.pdf and demo/batch-1..3/*.pdf
   (Courier 7pt, Waystar layout, demo stamp: Info /Subject + footer on every page; dates shifted to today)
```
Changing the PDF layout logic? Both the demo generator and the parser must agree; the test suite proves it.

## 7. Document API (server.js → store.js → Supabase)

```
/api/docs…  (passcode gate first; 503 if Supabase not configured)  →  docsApi(req, res, path)
  GET    /api/docs                 store.listDocs()
  POST   /api/docs                 body ≤ 5 MB → sha256 → store.findBySha → 409
                                   → eob.js:readPdf(Node pdf.js, copy) → 422 "Not a readable PDF"
                                   → eob.js:isDemo (Subject + footer on every page) → 422 NOT_DEMO
                                   → store.putPdf(<sha>.pdf) → store.insertDoc{file_name, sha256, pdf_path, lines: pages}
                                     (unique-sha race → 409) → enqueue(id) → 201 row
  PATCH  /api/docs/:id             {stage: "reviewed" | null} else 400 → updateDoc{stage, stage_at}
  POST   /api/docs/:id/ai          ai_status = pending → enqueue → 202
  GET    /api/docs/:id/pdf         getDoc → store.getPdf → application/pdf inline (no CSP header: Chrome's PDF viewer)
  DELETE /api/docs                 store.deleteAllDocs() (rows, then their PDFs) → {deleted}
store.call(): fetch REST with apikey (+ Bearer for legacy JWT keys), 20 s timeout, one retry on network-level "fetch failed"
```
Checks: `node store.check.js` (STORE OK) · `bash api.check.sh` (API OK) · workspace `npm run e2e` (E2E OK).
