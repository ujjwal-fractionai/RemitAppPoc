# POC v2 — Multi-document tracking board (design)

_2026-10-27 · Owner: Ujjwal · Builds on `POC/` (FEAT-001…005). Trace file once built: `POC/docs/features/FEAT-007-tracking-board.md`._

## 1. Intent

Today the POC explains **one** EOB PDF at a time and forgets it. The owner wants it to show what the **final tracking tool** will feel like: the billing team uploads many EOBs, every one is triaged automatically, and they work through them on a shared board until each is done. Owner's words: "upload multiple, and all that needs to get triaged and populated on a kanban of sorts. On a separate view, you can dive into each document, OR on the kanban, you can click into action items / denials that need to be figured out."

It's a **demo of the final product**, run on **dummy documents only**, shown to the manager and billing team: upload 10 → see the board and dashboard fill; upload 5 more → watch it grow.

## 2. Goals

1. Upload **many** EOB PDFs at once (file picker multi-select + drag & drop), with progress.
2. Every document is stored (PDF + parsed data + AI summary) in **Supabase**, so every login sees the same board and anyone can re-open the original PDF.
3. **Dashboard** (new home view): totals across all documents + a "Needs attention" list across all documents not yet reviewed.
4. **Documents** view: **Board** (kanban) and **List** (table) of the same documents. New uploads are **placed automatically**; billing clicks **Mark reviewed** when a document is handled (for Ready to post: once posted). No dragging.
5. **Document view**: click a card / row / attention item → the existing single-EOB breakdown (payment card, PIP card, tiles, AI insights, reversals, claims table) plus **Open PDF** and **Mark reviewed / Reopen**.
6. **20 synthetic demo EOBs** in three batches (10 + 5 + 5) with realistic variety.
7. Look: the existing light theme (bookkeep/ABACUS tokens) in a clean shadcn-like style.

## 3. Non-goals

- Real EOBs / real PHI. The POC v2 refuses to store anything that isn't one of our demo PDFs (§6).
- Per-user accounts, audit log, roles (shared passcode stays; final app = DECISIONS D11).
- Ticking off individual action items (document-level Mark reviewed only; item-level later).
- SFTP / 835 ingestion (separate track, FEAT-006).
- Editing rules from the UI.

## 4. Anti-goals (would be a failure even if it "works")

- Any path that lets a real EOB land in Supabase.
- AI computing money, buckets, stages or deadlines (they stay in `eob.js`, D15).
- New heavy tooling in the POC (React/Tailwind/build step). The POC stays plain HTML/CSS/JS + a zero-dependency Node server.
- A UI that looks like a different product from the current POC / bookkeep app.

## 5. Decided

**By the owner**
- Storage: **Supabase** (project `vzocbrfhfwnschrgqxds`), full documents incl. PDFs, **dummy docs only**.
- Views: **Dashboard** + **Documents (Board + List)**; option B: automatic placement.
- **No dragging, no In-progress column** (2026-10-27): one manual step, **Mark reviewed**, on every document incl. Ready to post ("once posted"); **Reopen** undoes it.
- **Document-level** review first (no per-item ticks).
- Clean, nice UI in the current palette; shadcn "if easier".
- Keys: builder adds placeholders to `POC/.env.example`; owner fills `POC/.env` and runs `POC/supabase/schema.sql` at the start of the build.
- **2026-10-27, explicitly approved:** supersede **D13** for the POC (server + Supabase receive and store PDFs, demo docs only, enforced by the stamp guard) and **D26** (full-screen loader replaced by immediate cards + progress card; AI runs in the background).
- Real EOBs must fail: no demo stamp → rejected in the browser before upload and again on the server.

**My calls (owner saw them, didn't object)**
- **No shadcn library**: replicate its look in plain CSS with the existing tokens (card, badge, tabs, button, table). Final app (Next.js) may use real shadcn.
- **Browser never talks to Supabase.** The POC server holds `SUPABASE_SECRET_KEY` (service role) and proxies everything, behind the existing passcode gate. CSP stays `connect-src 'self'`.
- **Demo stamp guard**: demo PDFs carry a marker; anything without it is refused (§6).
- **AI runs in the background** per document after upload; cards appear immediately.
- **Duplicate uploads** (same file bytes) are detected and skipped.

## 6. Demo-only guard

- `demo/make-demos.js` writes PDF Info dictionary `/Subject (REMIT-DEMO-SYNTHETIC)` **and** a visible footer line `SYNTHETIC DEMO DATA - NOT A REAL EOB` on every page.
- Browser: before upload, reject a file whose PDF metadata Subject ≠ marker ("This looks like a real EOB. The demo only stores synthetic demo files.").
- Server (authoritative): `POST /api/docs` receives **only the PDF**. The server extracts `lines` itself (bundled `public/vendor/pdf.min.mjs` + `eob.js:pageLines`, run in Node) and rejects with 422 unless the metadata Subject is the marker **and every page** carries the footer line. The browser never sends `lines`, so stored text always comes from the stored PDF.
- Scope _(my call)_: this stops **honest mistakes** (a real EOB dropped in by accident). Deliberately forging the stamp onto a real PDF is out of scope for a passcode-gated demo used by trusted staff.
- The parser must ignore the footer line (it doesn't match any EOB pattern; add a test).
- Existing demo PDFs are regenerated with the stamp. The old single-file "explain without saving" path is removed (the app now always saves), so a real EOB can no longer be processed at all in v2. _Accepted by the owner's "POC for dummy docs only"._

## 7. How it fits together

```
Browser (app.js)                                   POC server (server.js)                 Supabase
 upload N PDFs ─► per file: metadata stamp check (pdf.js, fast fail)
   ─► POST /api/docs  (raw PDF body, header x-file-name)  ─► sha256 → 409 if duplicate
                                                          ─► pdf.js in Node → lines; stamp + footer check → 422
                                                          ─► Storage: eob-pdfs/<id>.pdf ──► private bucket
                                                          ─► insert documents row       ──► table
                                                          ─► background: analyze(lines) → deidentify → Gemini
                                                                         → update row.ai / ai_error
 GET /api/docs (on load + poll every 4 s while any ai is pending) ◄── select rows (no PDF bytes)
   per doc: parseEob(lines) → analyze(r, today) → autoStage(r), attentionItems(r)   (live, current rules)
 PATCH /api/docs/:id {stage}           ─► 'reviewed' or null (Reopen)
 GET  /api/docs/:id/pdf                ─► stream from Storage (Content-Type application/pdf)
 DELETE /api/docs (Rules tab "Clear demo data", confirm) ─► delete rows + storage objects
```

- `server.js` imports `./public/eob.js` (pure, already runs in Node tests) and the bundled pdf.js to extract lines, and to run `analyze` + `deidentify` for the background AI call. Duplicate check (SHA-256) is server-side.
- Supabase auth headers _(my call)_: always send `apikey: <key>`; add `Authorization: Bearer <key>` only when the key is a legacy JWT (starts with `eyJ`). Works with both legacy `service_role` keys and new `sb_secret_…` keys. Existing `/api/insights` stays for "Try again" (client posts deidentify output; server updates the row via `PATCH {ai}`), or the builder may fold retry into `POST /api/docs/:id/ai`.
- All Supabase calls use `fetch` to the REST APIs (PostgREST `/rest/v1/…`, Storage `/storage/v1/object/…`) with `apikey` + `Authorization: Bearer <secret>`. **No supabase-js.**
- AI background work: simple in-process queue, **2 concurrent** Gemini calls; on failure store `ai_error` (message only).
- Analysis is **recomputed in the browser** from stored `lines` every load, so deadline status (open/due soon/overdue) and rule changes are always current. Only `stage` (manual override), `ai`, and metadata are stored.

## 8. Data (Supabase)

`POC/supabase/schema.sql` (owner pastes once into the SQL editor):

```sql
create table if not exists documents (
  id          uuid primary key default gen_random_uuid(),
  file_name   text not null,
  sha256      text not null unique,
  pdf_path    text not null,
  lines       jsonb not null,          -- pageLines() output, re-parsed on every load
  stage       text check (stage = 'reviewed' or stage is null),  -- null = automatic column
  stage_at    timestamptz,
  ai          jsonb,                   -- Gemini result {summary, actions, reversals, watch, model, ms}
  ai_error    text,
  ai_status   text not null default 'pending' check (ai_status in ('pending','done','error')),
  uploaded_at timestamptz not null default now()
);
alter table documents enable row level security;   -- no policies: only the service key can read/write
insert into storage.buckets (id, name, public) values ('eob-pdfs','eob-pdfs', false) on conflict do nothing;
```

## 9. Stages

Columns, left → right: **Doesn't add up** · **Action needed** · **Ready to post** · **✓ Reviewed**.

`eob.js:autoStage(r)` (pure, exported, tested) places every document whose `stage` is null:
1. `!r.reconciled || r.warnings.length` → **mismatch** ("Doesn't add up")
2. any claim DENIED or NEXT_PAYER, any PARTIAL with a denied line, any unmatched reversal, any reversal pair with `patientChange < 0` → **action**
3. otherwise → **ready**

The only manual step: **Mark reviewed** (button on every non-reviewed card, list row and in the document view; for Ready to post it means "posted") → `PATCH stage='reviewed'`, records `stage_at`. **Reopen** on a reviewed card / document → `PATCH stage=null`, back to its automatic column. No drag and drop.

## 10. Needs attention

`eob.js:attentionItems(r)` (pure, exported, tested) → items for one document; dashboard lists items of all documents whose stage ≠ reviewed, sorted: overdue/due-soon first, then mismatch, denials, next payer, refunds, unmatched reversals, denied lines.

| Type | One item per | Text example | Amount |
|---|---|---|---|
| Doesn't add up | document | "Check is $10.00 more than claims: confirm with payer" | difference |
| Denied | claim | "CO-50 · fix and resubmit or appeal" | billed |
| PIP / next payer | patient group | "Bill health insurance, attach EOB · file by 11/02/2026" | Σ nextPayerAmount |
| Refund / adjust | reversal pair with patientChange < 0 | "Balance down after reprocessing" | −patientChange |
| Unmatched reversal | claim | "Correction not in this EOB yet" | — |
| Denied line | PARTIAL claim with denied lines | "Work denied line(s): CO-97" | Σ denied-line billed |

Items of reviewed documents disappear. Each item links to its document; the document view opens with that claim's detail row expanded and scrolled into view. Filter tabs: All · Denials · PIP · Refunds · Mismatch.

## 10a. Dashboard money definitions _(my calls; pure `eob.js:summarize(docs)`, tested)_

- Totals cover **all** documents, including Reviewed (it's a history of what came in). "Needs attention" excludes Reviewed. KPI label "Payer paid", not "to post".
- **Payer paid** = Σ claim NET over non-reversed claims, i.e. what the payers actually paid on current claims.
- **Bill patients** = Σ `pr` of non-reversed claims with `pr > 0`. Reversal pairs' patient decreases show as Refund items, not as negatives here.
- **Denied** = billed of DENIED claims + billed of denied lines inside PARTIAL claims.
- **Bill next payer** = Σ `nextPayerAmount`; the card also shows the nearest due-date status.
- **Contractual write-off** = Σ CO adjustments on lines that are not denied (CO-45, CO-253, …).
- **Status-22 reversal claims are excluded** from money totals and the bar (their effect appears as Refund / Unmatched items), so the bar never has negative segments.

## 11. Screens

Sidebar: **Dashboard** (default) · **Documents** (count) · **Rules & settings** · **Lock**. Hash routes: `#dashboard`, `#documents`, `#doc/<id>`, `#rules`.

- **Upload** button on Dashboard and Documents; drop anywhere on those views. A slim progress card: "Processing 3 of 5 · 1 duplicate skipped · 1 rejected (not a demo file)". No full-screen loader for multi-upload (FEAT-005's loader is retired).
- **Dashboard**: 6 KPI cards (Documents + claims · Payer paid · Bill patients · Denied · Bill next payer with nearest due · Reviewed x/y); Needs attention table with tabs; "Where the money went" stacked bar (paid / patients owe / denied / next payer / contractual write-off) with legend; top denial reasons (code + glossary text + count). Empty state: "No EOBs yet. Upload demo files from POC/demo/batch-1."
- **Documents · Board**: 4 columns (count chips). Card: payer, check amount, file name, claim count, issue badges (denials n, PIP + days, refund $, patient bills n, off by $), "AI…" chip while pending, **Mark reviewed** button (Reviewed cards: reviewed date + **Reopen**). Click elsewhere on the card → document view.
- **Documents · List**: table, same documents: payer, file, check date, check amount, claims, issues, stage, Mark reviewed / Reopen, uploaded. Sort by uploaded desc.
- **Document view**: header with ← Back, file name, stage badge, **Mark reviewed / Reopen**, **Open PDF** (new tab), then the existing breakdown rendered from the stored data, AI box from stored `ai` (or pending skeleton / error + Try again).
- **Rules & settings**: existing tab + Supabase status row (configured? reachable?) + **Clear demo data** (confirm dialog in-page, not `window.confirm`).

Style: existing tokens; shadcn-like cards (10 px radius, 1 px border, subtle shadow), tabs (muted track, white active pill), badges (tinted). See mockup `POC/docs/superpowers/mockups/board-v2.html` (open in a browser).

## 12. Demo documents (20)

`demo/make-demos.js` gains 20 specs in `demo/batch-1/` (10), `demo/batch-2/` (5), `demo/batch-3/` (5). Variety across batches: several payers (commercial, BCBS-like, Medicare-like with CO-253 sequestration — add 253 to `CODES`; lines still pay, so it's never a denial), clean all-paid EOBs, deductible season, copays/coinsurance, denials (50, 29, 16/MA130, 97, 197), reversals (matched + unmatched), PIP exhausted (one due soon, one overdue, one open), one mismatch, a paper check, multi-page EOBs. Fake names/IDs only, unique per doc so dedupe and patient grouping behave. Each spec has an `expect` block (buckets, reconciled, pairs, autoStage) checked by `eob.test.js`.
- **Dates are relative** _(my call)_: specs are built from a `base` date (CLI: the day you run `node demo/make-demos.js`; tests: a fixed date), so PIP cases stay "open / due soon / overdue" whenever the demo runs. Regenerate the day before a demo, then **Clear demo data** (file hashes change). Batch 2 should visibly change the dashboard (e.g. adds a second PIP, a big denial). Existing six demos stay (regenerated with stamp).

## 13. Testing

- `npm test`: existing 10 + autoStage + attentionItems + every demo (incl. stamp line ignored by parser) + deidentify-no-PHI unchanged.
- Server: curl checks for each `/api/docs` route incl. 422 on non-demo PDF, 401 without session, duplicate sha → 409.
- Browser (Playwright + Chrome): upload batch-1, board shows 10 cards in expected columns, Mark reviewed moves a card to Reviewed and persists after reload, Reopen returns it, open PDF works, upload batch-2 adds 5, attention item click opens the right claim, no console errors, CSP intact, 390 px width usable.

## 14. Constraints

- Zero npm dependencies in the POC server (D16); no CDN scripts (D25); CSP unchanged except nothing new needed.
- Gemini still receives only `deidentify()` output.
- Passcode gate covers all new routes.
- `.env.example`: `SUPABASE_URL=https://vzocbrfhfwnschrgqxds.supabase.co`, `SUPABASE_SECRET_KEY=` (service role / secret key). Server starts without Supabase settings but the app shows a clear "Supabase not configured" banner.
- Ponytail mode for all coding (D31); explicit file header comments; docs updated (FEAT-007, DECISIONS, FLOW, ARCHITECTURE, HANDOVER).

## 15. Left to the builder

Polling interval details, exact copy text, button placement on cards, sort orders not specified above, how `/api/insights` retry is wired, file layout inside `public/` (may split `app.js` if it grows past ~600 lines), payload size limits (demo PDFs are ~10 KB).
