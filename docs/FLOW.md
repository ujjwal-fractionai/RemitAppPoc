# FLOW — POC: how execution travels

Exact call paths, file → function, in order. Update the relevant section whenever you change one of these paths, and say in [HANDOVER.md](HANDOVER.md) which path you are modifying.

Notation: `file:function()`. All paths are relative to `POC/`.

---

## 1. Page load and passcode (POC)

```
Browser GET /
└─ server.js: createServer handler
   ├─ authed(req)                       cookie remit_session → sessions Map (in memory, 12 h)
   │   └─ no/expired → redirect 303 /login  (or /login?e=expired if a stale cookie was sent)
   └─ authed → static file from public/ (path-normalised, CSP + no-store headers via send())

GET /login  → loginPage(res, error)      reads login.html, injects a fixed error message (never user input)
POST /login → handleLogin(req, res)
   ├─ ipOf(req) locked? (fails Map: 5 wrong tries → 15 min) → loginPage("locked") 429
   ├─ passcodeOk(given)  sha256 + timingSafeEqual against APP_PASSCODE
   │   ├─ wrong → count++, 500 ms delay, loginPage("wrong" | "locked")
   │   └─ right → new random token in sessions, Set-Cookie HttpOnly SameSite=Strict, 303 /
GET /logout → delete session, clear cookie, 303 /login        (sidebar "Lock" link)
```

If `APP_PASSCODE` is empty: everything is open, and the server refuses to start unless `HOST` is local.

## 2. Upload → dashboard (POC, the main path)

```
public/app.js
  #file change  /  #drop drop event
  └─ load(file)                                      busy guard: one upload at a time
     ├─ loader([...3 steps])                         full-screen overlay, appended to <body>
     ├─ pdfjs.getDocument(bytes) → page.getTextContent()   (vendor/pdf.min.mjs + worker)
     │   └─ eob.js:pageLines(items)                  text items → fixed-width rows (by y, then x / char width)
     ├─ steps.next()
     ├─ eob.js:parseEob(lines)                       line-pattern state machine → { header, claims[], plb[], totals, glossary }
     ├─ eob.js:analyze(r, today)                     mutates r, see §3
     ├─ steps.next()
     │   └─ any error above → "Couldn't read this EOB" card; dashboard not shown
     ├─ getInsights(r)                               see §4; never throws out of load()
     │   └─ .then(data) / .catch(error) → ai = { data } | { error }
     ├─ render(r, ai)                                builds the whole dashboard at once
     │   ├─ payment card (kv)
     │   ├─ pipCard(r)                               only if any claim.bucket === NEXT_PAYER
     │   ├─ warnings card                            r.warnings from analyze()
     │   ├─ tile(r, bucket) × 6                      click → filter → drawClaims(r)
     │   ├─ AI card: aiContent(r, ai)                summary/actions or error box + "Try again"
     │   ├─ pairRow(p) per r.pairs                   reversal → correction, patient balance change
     │   ├─ drawClaims(r)                            table rows; click row → lineTable(r, c) → describe(r, code)
     │   └─ glossary card
     └─ finally: steps.close(); busy = false
```

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
c.action = nextAction(c, r)     needs bucket, pair and followUp → must run last
payment checks: Σ paid − Σ PLB == CHECK AMT (r.reconciled); TOTALS row count + paid
```

## 4. AI insights

```
app.js:getInsights(r)
  └─ fetch POST /api/insights  body = eob.js:deidentify(r)   (60 s browser timeout)
     └─ server.js handler: authed? (401 if not) → body ≤ 1 MB → insights(payload)
        └─ fetch Gemini generateContent (PROMPT + SCHEMA, temperature 0.2, 45 s timeout)
           → JSON.parse(parts) → { summary, actions[], reversals, watch[] } + { model, ms }
  errors (HTTP ≠ 200, timeout, no candidates) → message string → aiContent() error box
"Try again" button → getInsights(r) again → replaces #ai only
```

## 5. Rules & settings tab

```
sidebar <a href="#rules"> → hashchange → app.js:showView()
  └─ first visit: renderRules()
     ├─ reads exported constants from eob.js (CONTRACTUAL, DENY_GROUPS, BENEFIT_MAX, PIP_PAYER_WORDS,
     │  DE_PIP_MINIMUM, NEXT_PAYER_FILING_DAYS, DUE_SOON_DAYS, FOLLOW_UP_AFTER_DAYS)
     └─ fetch GET /api/config → { model, aiEnabled, passcode, sessionHours, maxFails, lockMinutes }
```
The dashboard DOM stays in `#view-explainer` (hidden, not destroyed) while the Rules tab is shown.

## 6. Tests and demo PDFs

```
npm test (POC) → node --test → eob.test.js
   ├─ inline synthetic EOB text → parseEob → analyze → assertions
   ├─ for each DEMOS[d] in demo/make-demos.js: eobPages(d).flat() → parseEob → analyze → d.expect
   └─ deidentify() output must not contain names / IDs / dates
node demo/make-demos.js → eobPages(spec) → pdf(pages) → demo/*.pdf   (Courier 7pt, same layout as Waystar)
```
Changing the PDF layout logic? Both the demo generator and the parser must agree; the test suite proves it.
