# POC v2 — Multi-document Tracking Board Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the single-EOB POC into a demo of the tracking tool: upload many synthetic EOBs, store them in Supabase, auto-triage each onto a 4-column board, show a cross-document Dashboard with "Needs attention", open any document (and its PDF), and mark documents reviewed.

**Architecture:** Browser (plain ES modules) ↔ zero-dependency Node server (passcode-gated) ↔ Supabase REST (Postgres table + private Storage bucket). The server extracts text from each uploaded PDF with the bundled pdf.js, enforces the demo stamp, stores PDF + lines, and runs Gemini in a background queue. The browser re-runs the pure rules in `eob.js` on stored lines at every load (so deadlines and rules are always current).

**Tech Stack:** Node 24 (stdlib `http`, `crypto`, `fetch`), bundled pdf.js 4.10.38 (`public/vendor`), Supabase PostgREST + Storage REST (no supabase-js), Gemini REST, `node:test`. E2E checks: `playwright-core` driving installed Chrome, workspace root only.

**Spec:** `POC/docs/superpowers/specs/2026-10-27-poc-tracking-board-design.md` (read it first; this plan argues from it).

## Global Constraints

- **Ponytail mode for every task**: invoke `ponytail:ponytail` before writing code (CLAUDE.md §4, D31). Shortest working change; mark deliberate shortcuts `// ponytail: <limit>, <upgrade path>`.
- POC server keeps **zero npm dependencies**; no CDN scripts; CSP stays as in `server.js` (`connect-src 'self'` etc.). The browser never calls Supabase or Gemini directly.
- Money in **integer cents**; AI never computes money, buckets, stages or deadlines (D15, D17).
- Gemini receives **only** `eob.js:deidentify(r)` output.
- Rule values are **named exported constants** in `public/eob.js`, shown on the Rules tab (D23).
- Demo stamp: PDF Info `/Subject (REMIT-DEMO-SYNTHETIC)`; footer on every page exactly `SYNTHETIC DEMO DATA - NOT A REAL EOB`. Anything without both is rejected (browser: Subject only, fast fail; server: Subject **and** footer on every page → 422).
- Columns, exact labels: `Doesn't add up` · `Action needed` · `Ready to post` · `✓ Reviewed`. Only manual action: **Mark reviewed** / **Reopen**. No drag and drop.
- Stored `stage`: `'reviewed'` or `null` (null = automatic column).
- Every file starts with a header comment: job, who calls it, what it must never do. Comment the flow of non-obvious logic.
- `POC/` is its own git repo: commit there after each task. POC docs live in `POC/docs/` (committed with the code).
- `.env.example` gets `SUPABASE_URL=https://vzocbrfhfwnschrgqxds.supabase.co` and `SUPABASE_SECRET_KEY=`; never print or log either value.
- Supabase headers: always `apikey: <key>`; add `Authorization: Bearer <key>` only if the key starts with `eyJ`.
- Real EOB PDFs (`RemitApp/pdfs/`) are **never** uploaded during testing.

## Review Focus

1. **One bad file in a multi-file upload** (corrupt PDF, non-PDF, or real EOB) → that file is listed as rejected with its reason; the remaining files still upload. _Test: Task 7 Step 4._
2. **Supabase not configured or unreachable** → server still starts; `/api/config` reports it; UI shows a banner and the upload button explains why it's disabled; nothing crashes. _Test: Task 4 Step 6 + Task 7 Step 4._
3. **AI never finishes** (Gemini key missing, Gemini error, server restarted mid-queue) → row ends `ai_status='error'` with a message, or is re-queued on startup; never stuck "AI…" forever. _Test: Task 5 Step 5._
4. **Same file twice** (in one batch, or again later) → second copy reported "already uploaded" (409), no duplicate card. _Test: Task 5 Step 4 + Task 7 Step 4._
5. **Session expires mid-session** (server restart signs everyone out) → API calls return 401 and the UI shows "Locked. Reload and enter the passcode" instead of silently failing. _Test: Task 7 Step 4._

---

### Task 1: Demo stamp, relative demo dates, PDF reader shared by browser and server

**Files:**
- Modify: `POC/public/eob.js` (constants, skip footer in `parseEob`, new `readPdf`)
- Modify: `POC/demo/make-demos.js` (Info dict + footer in `pdf()`, dates relative to a base date, export `demos(base)`)
- Modify: `POC/eob.test.js`

**Interfaces:**
- Produces (eob.js): `export const DEMO_MARKER = "REMIT-DEMO-SYNTHETIC"`, `export const DEMO_FOOTER = "SYNTHETIC DEMO DATA - NOT A REAL EOB"`, `export async function readPdf(pdfjs, bytes: Uint8Array) -> { pages: string[][], subject: string }` (pages = `pageLines` per page; subject = `getMetadata().info.Subject ?? ""`), `export const isDemo = ({ pages, subject }) => boolean` (subject === DEMO_MARKER and every page has a line whose trimmed text === DEMO_FOOTER).
- Produces (make-demos.js): `export function demos(base: Date) -> Spec[]` (replaces `DEMOS`), `export function eobPages(spec) -> string[][]`, `export function pdf(pages) -> string` (now exported), plus CLI writing files. Spec dates: `checkDaysAgo` (number) instead of `checkDate`/`prodDate` strings; `line()` takes `[fromDaysBeforeCheck, toDaysBeforeCheck]` instead of the `"MMDD MMDDYY"` string. `eobPages` formats: check date `MM/DD/YYYY`, production date = check − 1 day, service from `MMDD`, to `MMDDYY`.

- [ ] **Step 1: Write failing tests** in `eob.test.js`:
  - Replace `DEMOS` usage with `const BASE = new Date(2026, 9, 21); const DEMOS = demos(BASE);` (every existing assertion must still hold: the PIP demo gets `checkDaysAgo: 78` → check date 08/04/2026, due 11/02/2026).
  - `test("footer line is ignored by the parser")`: lines of the synthetic-eob demo plus `"        " + DEMO_FOOTER` appended → `parseEob` glossary's last entry does not contain `"SYNTHETIC"`, warnings unchanged (`[]`).
  - `test("generated demo PDFs carry the stamp; plain PDFs don't")`: import `./public/vendor/pdf.min.mjs` in Node with `GlobalWorkerOptions.workerSrc = pathToFileURL("public/vendor/pdf.worker.min.mjs").href`; `readPdf(pdfjs, latin1Bytes(pdf(eobPages(DEMOS[0]))))` → `subject === DEMO_MARKER`, every page contains the footer, `isDemo(...) === true`; same PDF with the footer line removed from one page → `isDemo === false`; a PDF from `pdf(pages)` with Subject stripped (string replace) → `false`.
- [ ] **Step 2: Run** `cd POC && npm test` → new tests FAIL (`readPdf` / `demos` not defined).
- [ ] **Step 3: Implement.** `parseEob`: skip lines whose trimmed text === `DEMO_FOOTER` (same place as the `Page N` skip). `pdf()`: add object `<< /Subject (REMIT-DEMO-SYNTHETIC) /Producer (REMIT demo generator) >>` and `/Info n 0 R` in the trailer; `eobPages` adds the footer line on every page (before `Page N`). Convert the 6 existing specs to relative dates keeping today's rendered dates when `base = 2026-10-21`. CLI (`node demo/make-demos.js`) uses `new Date()` as base.
- [ ] **Step 4: Run** `npm test` → all PASS (10 existing + 2 new). Run `node demo/make-demos.js` → 6 PDFs rewritten.
- [ ] **Step 5: Commit** `git commit -am "Demo stamp, relative demo dates, shared readPdf"`

---

### Task 2: Pure rules for stages, attention items and dashboard totals

**Files:**
- Modify: `POC/public/eob.js`
- Modify: `POC/eob.test.js`

**Interfaces:**
- Consumes: `analyze(r, today)` output (claims with `bucket`, `paid`, `pr`, `billed`, `nextPayerAmount`, `pair`, `lines[].denied`, `lines[].adjs`; `r.pairs`, `r.reconciled`, `r.warnings`, `r.difference`, `r.followUp`, `r.glossary`).
- Produces:
  - `export const STAGES = { mismatch: "Doesn't add up", action: "Action needed", ready: "Ready to post", reviewed: "✓ Reviewed" }`
  - `export function autoStage(r) -> "mismatch" | "action" | "ready"` — spec §9 rules, in order.
  - `export const ATTENTION_ORDER = ["mismatch", "denied", "next_payer", "refund", "unmatched", "denied_line"]`
  - `export function attentionItems(r) -> Item[]`, `Item = { type, claim: string|null, patient: string|null, name: string|null, text: string, amount: number|null, status: "open"|"due soon"|"overdue"|null, due: Date|null }` — one per row of spec §10's table. `next_payer` items are one per patient group (amount Σ `nextPayerAmount`, `status`/`due` from `r.followUp`). `refund` = pair with `patientChange < 0`, amount `-patientChange`, `claim` = correction label. `denied` text: `"<codes> · fix and resubmit or appeal"` (codes from the claim's non-PR, non-CO-45 adjustments + remarks).
  - `export function summarize(list: { r, stage }[]) -> { documents, claims, payerPaid, billPatients, denied, nextPayer, writeOff, reviewed, nearestDue: { due, daysLeft, status } | null, denialReasons: { code, text, count }[] }` — exact definitions in spec §10a (status-22 claims excluded from money; `writeOff` = Σ CO adjustments on non-denied lines; `denialReasons` counts each CO/OA/PI non-contractual code on denied lines, text from `r.glossary[reason]`, sorted by count desc).

- [ ] **Step 1: Write failing tests** (dates from `BASE`):
  - autoStage: pip demo → `"action"`; denials demo → `"action"`; deductible demo → `"ready"`; reversals demo → `"action"`; mismatch demo → `"mismatch"`; the inline `LINES` fixture → `"action"`.
  - attentionItems(pip demo): exactly one item `{ type: "next_payer", amount: 28050, status: "due soon" }`, `due` formats to `"11/02/2026"` via `mdy`.
  - attentionItems(denials demo): 4 `denied` (C1, C2, C3, C5) + 1 `denied_line` (C4, amount 6000); first denied item text contains `"CO-50"`.
  - attentionItems(reversals demo): 2 `refund` items, amounts 4500 (C1→C4) and 12000 (C2→C5), + 1 `unmatched` (C3).
  - attentionItems(mismatch demo): 1 `mismatch`, amount 1000 (`Math.abs(r.difference)`).
  - summarize([denials demo]) → `{ payerPaid: 4640, billPatients: 2000, denied: 32500, writeOff: 8360, nextPayer: 0 }` and `denialReasons[0].count === 1`.
  - summarize: reviewed count = number of entries with `stage === "reviewed"`; reversal claims excluded (reversals demo `payerPaid === 5344`, `billPatients === 3000`).
- [ ] **Step 2: Run** `npm test` → FAIL (functions not exported).
- [ ] **Step 3: Implement** the four exports in `eob.js` with header comments pointing to spec §9/§10/§10a.
- [ ] **Step 4: Run** `npm test` → PASS.
- [ ] **Step 5: Commit** `git commit -am "autoStage, attentionItems, summarize"`

---

### Task 3: Twenty demo EOBs in three batches

**Files:**
- Modify: `POC/demo/make-demos.js` (`demos(base)` also returns batch specs with `dir: "batch-1" | "batch-2" | "batch-3"`; add `253: "Sequestration - reduction in federal payment."` to `CODES`)
- Create (generated): `POC/demo/batch-1/*.pdf` (10), `batch-2/*.pdf` (5), `batch-3/*.pdf` (5)
- Modify: `POC/eob.test.js` (assert every spec's `expect.stage`)

**Interfaces:**
- Consumes: Task 1 spec shape; Task 2 `autoStage`.
- Produces: every spec has `expect: { buckets, reconciled, pairs, stage }` (+ optional `pip`, `nextPayer`).

Scenarios (file names fixed; fake people unique per document; amounts the implementer's choice, all lines must balance):

| Batch | File | Payer | Scenario | stage |
|---|---|---|---|---|
| 1 | `b1-01-clean-all-paid.pdf` | TEST UNITED HEALTH PLAN | 4 claims, CO-45 only | ready |
| 1 | `b1-02-deductible-january.pdf` | TEST BLUE PLAN | 3 all-deductible + 2 partial | ready |
| 1 | `b1-03-copays.pdf` | TEST HEALTH PLAN OF DELAWARE | 5 claims with PR-3 | ready |
| 1 | `b1-04-denials-medical-necessity.pdf` | TEST HEALTH PLAN OF DELAWARE | CO-50 ×2, CO-197 ×1, 2 paid | action |
| 1 | `b1-05-pip-due-soon.pdf` | TEST AUTO INSURANCE CO - PIP | checkDaysAgo 80, 2 NEXT_PAYER + 1 paid | action |
| 1 | `b1-06-reversal-refund.pdf` | TEST NATIONAL HEALTH INSURANCE CO | 2 matched pairs, patient balance down | action |
| 1 | `b1-07-medicare-sequestration.pdf` | TEST MEDICARE PART B | 4 claims with CO-45 + CO-253, PR-2 | ready |
| 1 | `b1-08-coinsurance.pdf` | TEST BLUE PLAN | 4 claims PR-2 20% | ready |
| 1 | `b1-09-check-mismatch.pdf` | TEST HEALTH PLAN OF DELAWARE | checkDelta 1000 | mismatch |
| 1 | `b1-10-paper-check-bundled.pdf` | TEST UNITED HEALTH PLAN | CHECK #, L6 interest −125, PARTIAL with CO-97 line | action |
| 2 | `b2-01-pip-open.pdf` | TEST AUTO INSURANCE CO - PIP | checkDaysAgo 20, PIP exhausted for a new patient | action |
| 2 | `b2-02-timely-filing-denials.pdf` | TEST UNITED HEALTH PLAN | CO-29 ×3 (large billed) | action |
| 2 | `b2-03-clean-two-pages.pdf` | TEST BLUE PLAN | 12 claims → 2 pages | ready |
| 2 | `b2-04-unmatched-reversal.pdf` | TEST NATIONAL HEALTH INSURANCE CO | 1 reversal without correction + 2 paid | action |
| 2 | `b2-05-deductible-and-copay.pdf` | TEST HEALTH PLAN OF DELAWARE | mix PR-1 / PR-3 | ready |
| 3 | `b3-01-pip-overdue.pdf` | TEST AUTO INSURANCE CO - PIP | checkDaysAgo 100 | action |
| 3 | `b3-02-missing-info.pdf` | TEST BLUE PLAN | CO-16 + MA130 ×2 | action |
| 3 | `b3-03-clean.pdf` | TEST MEDICARE PART B | 3 claims CO-45 + CO-253 | ready |
| 3 | `b3-04-reversal-balance-up.pdf` | TEST NATIONAL HEALTH INSURANCE CO | pair where patient owes more after correction | ready |
| 3 | `b3-05-fees-and-paid.pdf` | TEST UNITED HEALTH PLAN | AH fee 384, all paid | ready |

Batch-1 therefore lands as Doesn't add up 1 · Action needed 4 · Ready to post 5 (Task 7 asserts this).

- [ ] **Step 1: Write the failing test**: the existing per-demo test also asserts `autoStage(r) === d.expect.stage`; add `test("20 batch demos: 10 + 5 + 5, unique file names, all stamped")` (counts by `dir`, unique `file`, `isDemo(readPdf(...))` for one per batch).
- [ ] **Step 2: Run** `npm test` → FAIL (batch specs missing).
- [ ] **Step 3: Implement** the 20 specs + CLI writing `demo/<dir>/<file>`; `POC/.gitignore` already allows `!demo/*.pdf` → change to `!demo/**/*.pdf`.
- [ ] **Step 4: Run** `npm test` → PASS (all demos). `node demo/make-demos.js` → 26 files written.
- [ ] **Step 5: Commit** `git add -A demo eob.test.js .gitignore && git commit -m "20 synthetic demo EOBs in three batches"`

---

### Task 4: Supabase schema and server-side store

**Files:**
- Create: `POC/supabase/schema.sql` (exact SQL from spec §8, with `stage` check `stage = 'reviewed' or stage is null`)
- Create: `POC/store.js`
- Modify: `POC/.env.example`, `POC/server.js` (`/api/config` adds `supabase`)

**Interfaces:**
- Produces (store.js, all async, throw `Error` with a non-secret message on failure):
  - `export const configured: boolean`
  - `export function ping() -> "ok" | "not configured" | "unreachable"`
  - `export function listDocs() -> Row[]` (order `uploaded_at.desc`), `getDoc(id) -> Row|null`, `findBySha(sha256) -> Row|null`
  - `export function insertDoc({ file_name, sha256, pdf_path, lines }) -> Row`
  - `export function updateDoc(id, patch) -> Row`
  - `export function deleteAllDocs() -> number` (rows deleted; also deletes their storage objects)
  - `export function putPdf(path, bytes: Buffer)`, `getPdf(path) -> Buffer`
  - `Row` = the `documents` columns.
- REST: PostgREST `/rest/v1/documents` (`Prefer: return=representation`; delete-all filter `id=not.is.null`); Storage `/storage/v1/object/eob-pdfs/<path>` (POST with `x-upsert: true`; GET; DELETE `/storage/v1/object/eob-pdfs` body `{ prefixes: [...] }`).

- [ ] **Step 1: Owner step (blocking):** write `schema.sql` and the `.env.example` lines first, then ask the owner to copy `SUPABASE_URL` / `SUPABASE_SECRET_KEY` into `POC/.env` and run `POC/supabase/schema.sql` in the Supabase SQL Editor. Wait for confirmation; Step 5 proves it worked.
- [ ] **Step 2: Write the failing check** `POC/store.check.js` (manual integration script, not part of `npm test` because it needs the network): insert a row with a random sha, `putPdf` 10 bytes, `getPdf` equals, `findBySha` finds it, `updateDoc({ stage: "reviewed" })`, `deleteAllDocs() >= 1`. Prints `STORE OK`.
- [ ] **Step 3: Run** `node store.check.js` → FAIL (`store.js` missing).
- [ ] **Step 4: Implement** `store.js` (fetch + header rule from Global Constraints; loads env like `server.js`). `/api/config` adds `supabase: await ping()`.
- [ ] **Step 5: Run** `node store.check.js` → `STORE OK`.
- [ ] **Step 6: Run** with `SUPABASE_URL= node server.js` → starts; `curl -s -b <cookie> /api/config` shows `"supabase":"not configured"`.
- [ ] **Step 7: Commit** `git add supabase store.js store.check.js .env.example server.js && git commit -m "Supabase schema and REST store"`

---

### Task 5: Document API and background AI queue

**Files:**
- Modify: `POC/server.js`
- Modify: `POC/eob.test.js` only if pure helpers are added

**Interfaces:**
- Consumes: `store.js` (Task 4); `readPdf`, `isDemo`, `parseEob`, `analyze`, `deidentify` (eob.js); bundled pdf.js loaded once at startup with `workerSrc` = file URL of `public/vendor/pdf.worker.min.mjs`.
- Produces (all behind the passcode gate; 503 `{error:"Supabase is not configured"}` when `!configured`):
  - `GET /api/docs` → `200 Row[]`
  - `POST /api/docs` — body = raw PDF (≤ 5 MB), header `x-file-name` (URI-encoded) → `201 Row` | `409 { error: "Already uploaded", id }` | `422 { error: "This looks like a real EOB. The demo only stores synthetic demo files." }` | `422 { error: "Not a readable PDF" }`
  - `PATCH /api/docs/:id` body `{ stage: "reviewed" | null }` → `200 Row` (sets `stage_at` = now, or null) | `400` for any other value
  - `POST /api/docs/:id/ai` → `202` (resets `ai_status='pending'`, enqueues)
  - `GET /api/docs/:id/pdf` → `200 application/pdf`, `content-disposition: inline; filename="<file_name>"`
  - `DELETE /api/docs` → `200 { deleted: n }`
  - **Removed:** `POST /api/insights` (AI is server-side now).
- AI queue: `enqueue(id)`, max 2 concurrent; each job: `getDoc` → `analyze(parseEob(lines))` → `deidentify` → existing `insights(payload)` → `updateDoc({ ai, ai_status: "done", ai_error: null })`; on throw `updateDoc({ ai_status: "error", ai_error: message })`; missing `GEMINI_API_KEY` → immediate error "GEMINI_API_KEY is not set in .env". On startup: `listDocs()` → enqueue every `ai_status === "pending"`.

- [ ] **Step 1: Write the failing check** `POC/api.check.sh` (curl script; needs a running server with `APP_PASSCODE=check-pass-123456`, logs in, uses `demo/b1-01-clean-all-paid.pdf`): expects `201` then `409` for the same file (never use real PDFs from `RemitApp/pdfs/`), `422` for a stamp-stripped copy made with `sed 's/REMIT-DEMO-SYNTHETIC/XXXXXXXXXXXXXXXXXXXX/'` into a temp file, `422` for a text file renamed `.pdf`, `PATCH reviewed → 200`, `PATCH "done" → 400`, `GET /pdf` → `200` + `%PDF`, unauthenticated `GET /api/docs` → `401`, `DELETE` → `{"deleted":1}`. Prints `API OK`.
- [ ] **Step 2: Run** it → FAIL (routes missing).
- [ ] **Step 3: Implement** routes + queue in `server.js` (route by `URL.pathname` + method; keep `send()`/CSP; log only ids, counts, timings).
- [ ] **Step 4: Run** `bash api.check.sh` → `API OK`.
- [ ] **Step 5: AI states.** Upload one demo, poll `GET /api/docs` until `ai_status === "done"` (≤ 60 s) and `ai.summary` is non-empty. Restart the server with `GEMINI_API_KEY=` → `POST /api/docs/:id/ai` → row becomes `ai_status: "error"` with the message above (never stays pending). Upload, kill the server within 1 s, restart with key → row reaches `done` (startup re-queue).
- [ ] **Step 6: Commit** `git add server.js api.check.sh && git commit -m "Document API, demo guard, background AI queue"`

---

### Task 6: Front-end shell: modules, routes, data loading, document view

**Files:**
- Create: `POC/public/ui.js` — move from `app.js`: `h`, `$`, `sum`, `pill`, `badge`, `card`, `kv`, `toneStyle`, `BUCKETS`, `fmtDates`
- Create: `POC/public/doc.js` — move from `app.js`: `render` (renamed `renderDoc(entry)`), `tile`, `followUpPill`, `pipCard`, `pairRow`, `drawClaims`, `describe`, `lineTable`, `aiContent`
- Create: `POC/public/rules.js` — move `renderRules` from `app.js`
- Modify: `POC/public/app.js` — becomes the shell (routing, data, upload); remove `load`, `loader`, `getInsights`
- Modify: `POC/public/index.html` — sidebar (Dashboard, Documents + count, Rules & settings, Lock), view containers `#view-dashboard`, `#view-documents`, `#view-doc`, `#view-rules`, a `#banner` slot, styles for new components

**Interfaces:**
- Produces (app.js, exported for the view modules):
  - `state = { docs: Entry[] }`, `Entry = { row: Row, r: AnalyzedEob, stage: "mismatch"|"action"|"ready"|"reviewed" }` where `r = analyze(parseEob(row.lines))` and `stage = row.stage === "reviewed" ? "reviewed" : autoStage(r)`
  - `refresh() -> Promise<void>` (GET `/api/docs`, rebuild `state.docs`, re-render current view; if any `ai_status === "pending"` schedule another refresh in 4 s, one timer at a time)
  - `setStage(id, stage: "reviewed"|null)`, `retryAi(id)`, `go(hash)`
  - `api(path, opts) -> json` — throws `Error` with the server's `error`; on 401 shows the banner "Locked. Reload and enter the passcode."
- Routes: `#dashboard` (default), `#documents`, `#documents/list`, `#doc/<id>`, `#doc/<id>/<claimLabel>`, `#rules`.
- Document view (`doc.js:renderDoc(entry)`, uses `entry.r` and `entry.row`): header row = ← Back, file name, stage badge (STAGES label), **Mark reviewed** or (reviewed) "Reviewed <date> · Reopen", **Open PDF** (`<a href="/api/docs/<id>/pdf" target="_blank" rel="noopener">`); then today's breakdown unchanged; AI box from `row.ai_status` (pending → skeleton "AI is reading this EOB…", error → message + **Try again** = `retryAi(id)`, done → existing content). With `<claimLabel>` in the route: expand that claim's detail row and `scrollIntoView`.

- [ ] **Step 1: Write the failing e2e check** `RemitApp/tools/e2e-board.mjs` (workspace root; add `"playwright-core": "1.50.1"` to root `package.json` devDependencies; launches Chrome `channel: "chrome"`; logs in with `E2E_PASSCODE`; first `DELETE /api/docs` via the page's fetch). Part A (this task): upload `demo/b1-04-…pdf` through `POST /api/docs` from the page context, `go("#doc/<id>")`, expect the claims table, "Open PDF" link responds `200 application/pdf`, AI box reaches summary or error (≤ 60 s), **Mark reviewed** then reload → still reviewed; **Reopen** → back; no console errors.
- [ ] **Step 2: Run** `node tools/e2e-board.mjs` → FAIL (no document view route).
- [ ] **Step 3: Implement** the module split (pure move first, then the shell), routes and document view.
- [ ] **Step 4: Run** e2e Part A → PASS; `cd POC && npm test` → PASS.
- [ ] **Step 5: Commit** `git add public && git commit -m "Shell, routes, stored document view"`

---

### Task 7: Multi-file upload, Documents board + list

**Files:**
- Create: `POC/public/documents.js` — `renderDocuments(mode: "board"|"list")`
- Modify: `POC/public/app.js` — `uploadFiles(files: File[])` + progress card; drop target on Dashboard and Documents views
- Modify: `POC/public/index.html` — board/list/progress styles (tokens and look from `POC/docs/superpowers/mockups/board-v2.html`)

**Interfaces:**
- Consumes: `state`, `refresh`, `setStage`, `go`, `api` (Task 6); `STAGES`, `attentionItems`, `readPdf`, `DEMO_MARKER` (eob.js).
- `uploadFiles(files)`: sequential; per file: `readPdf` (browser pdf.js) → `subject !== DEMO_MARKER` → reject locally with the 422 message; else `POST /api/docs` (raw body, `x-file-name`). Progress card text: `"Processing i of n · x duplicate skipped · y rejected"`, then a summary that lists each rejected file name + reason; `refresh()` after each success so cards appear one by one.
- Board: 4 columns in STAGES order with count chips; card = payer, check amount (`usd`), file name · claims count, issue badges derived from `attentionItems(r)` + patient-bill count (`claims with pr > 0`), "AI…" chip while pending, **Mark reviewed** button (reviewed cards: "Reviewed <date> · Reopen"); click elsewhere → `#doc/<id>`. Buttons stop propagation.
- List: table columns Payer · File · Check date · Check amount · Claims · Issues · Stage · action button · Uploaded; newest first.
- Upload disabled with a tooltip when `/api/config` says Supabase isn't `"ok"`; banner "Supabase is not configured: see POC/supabase/schema.sql and .env".

- [ ] **Step 1: Extend e2e** (Part B): `DELETE` all; upload all 10 `demo/batch-1` files through the real file input (`setInputFiles` with 10 paths) → 10 cards; column counts: `Doesn't add up` 1, `Action needed` 4, `Ready to post` 5; click **Mark reviewed** on `b1-01` card → moves to `✓ Reviewed`, persists after reload; List view shows 10 rows; then upload `batch-2` → 15 cards.
- [ ] **Step 2: Review Focus cases** in the same script: one upload of `[b2-01, b2-01 copy, garbage.pdf (text), stamp-stripped copy]` → progress lists 1 duplicate + 2 rejected with reasons, the rest still processed; start a fresh server process (sessions cleared) → clicking **Mark reviewed** shows the "Locked…" banner; run once against a server started with `SUPABASE_URL=` → banner + disabled upload, no console errors.
- [ ] **Step 3: Run** → FAIL.
- [ ] **Step 4: Implement** upload, progress card, board, list.
- [ ] **Step 5: Run** e2e Parts A+B → PASS; screenshot board at 1440 px and 390 px (no horizontal page scroll; board scrolls horizontally inside its card on mobile).
- [ ] **Step 6: Commit** `git add public && git commit -m "Multi-upload, Documents board and list, Mark reviewed"`

---

### Task 8: Dashboard

**Files:**
- Create: `POC/public/dashboard.js` — `renderDashboard()`
- Modify: `POC/public/index.html` (KPI / table / bar styles)

**Interfaces:**
- Consumes: `state`, `go` (Task 6); `summarize`, `attentionItems`, `ATTENTION_ORDER`, `STAGES`, `mdy`, `usd` (eob.js); `pill`, `card`, `h` (ui.js).
- KPI cards (labels exact): `Documents` (sub: "<claims> claims") · `Payer paid` · `Bill patients` · `Denied` · `Bill next payer` (sub: nearest due status pill) · `Reviewed` (value "x / y").
- Needs attention: items from all entries with `stage !== "reviewed"`, each row also carries the document; sort: `status` overdue → due soon → others, then `ATTENTION_ORDER`, then amount desc. Tabs: All · Denials (`denied`, `denied_line`) · PIP (`next_payer`) · Refunds (`refund`) · Mismatch (`mismatch`, `unmatched`). Row click → `#doc/<id>/<claim>` (or `#doc/<id>` when `claim` is null). Patient column shows `name` (demo data).
- "Where the money went": one stacked bar (flex widths ∝ amounts, 2 px gaps) payer paid / patients owe / denied / next payer / contractual write-off, colors `--paid`, `--owes`, `--denied`, `--next`, `#c9d2dd`; legend with amounts. Top denial reasons: up to 5 `{code · text · count}`.
- Empty state: "No EOBs yet. Upload demo files from POC/demo/batch-1."

- [ ] **Step 1: Extend e2e** (Part C): after batch-1 upload, Dashboard KPIs equal `summarize()` computed in Node over the same 10 specs (`demos(new Date())` from `make-demos.js`) — compare `Payer paid` and `Denied` text; Needs attention contains a PIP row with "due soon"; clicking it lands on `#doc/<id>/<claim>` with that claim's detail row visible; after marking the PIP document reviewed, its row disappears.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** `dashboard.js`.
- [ ] **Step 4: Run** e2e A+B+C → PASS; screenshot dashboard 1440 px and 390 px.
- [ ] **Step 5: Commit** `git add public && git commit -m "Dashboard: totals, needs attention, money breakdown"`

---

### Task 9: Rules tab additions, docs, final verification

**Files:**
- Modify: `POC/public/rules.js` — "Storage" card: Supabase status (from `/api/config`), stored document count, **Clear demo data** button → in-page confirm panel ("Delete all N demo documents and their PDFs? This can't be undone." Cancel / Delete) → `DELETE /api/docs` → `refresh()`; Stages card listing the 4 columns and their rules (from `STAGES`); Demo stamp row (`DEMO_MARKER`, `DEMO_FOOTER`).
- Modify (all in `POC/docs/` unless noted): `features/FEAT-007-tracking-board.md` (create from `_TEMPLATE.md`), `DECISIONS.md` (D32 supersede D13 for POC; D33 supersede D26; D34 Supabase via server, header rule; D35 shadcn look in plain CSS; D36 server-side PDF parsing + demo guard scope; D37 Mark reviewed, no drag, 4 columns; D38 relative demo dates; D39 dashboard money definitions — D39 is a business rule: add it to the workspace `docs/DECISIONS.md` instead), `FLOW.md` (§2 upload → board, §4 AI queue, new §: document routes), `ARCHITECTURE.md` (§1 folder map: `store.js`, `supabase/`, `public/*.js`, `demo/batch-*`; §2 diagram with Supabase; §3 → done), `HANDOVER.md` (Right now, Done, How to run incl. Supabase setup), `POC/CLAUDE.md` if rules change; workspace `CLAUDE.md` next-free numbers (D40, FEAT-008, BUG-007) and workspace `docs/HANDOVER.md` one-line POC status.

- [ ] **Step 1: Extend e2e** (Part D): Rules tab shows Supabase "ok"; Clear demo data → confirm → board empty, Dashboard empty state.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** full e2e A–D → PASS; `npm test` → PASS; `bash api.check.sh` → `API OK`.
- [ ] **Step 5: Demo rehearsal:** `node demo/make-demos.js`; Clear demo data; upload batch-1 (10) → screenshot; upload batch-2 (5) → screenshot; open the PIP card → PIP alert + Open PDF works. Attach screenshots to FEAT-007.
- [ ] **Step 6: Update docs** listed above (DECISIONS entries in the existing format: Decision / Why / Rejected / Trade-off).
- [ ] **Step 7: Commit** `git add -A && git commit -m "Rules: storage + clear demo data; docs"` (in `POC/`).
