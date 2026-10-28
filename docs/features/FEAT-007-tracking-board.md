# FEAT-007 — POC v2: multi-document tracking board

**Status:** Done (uncommitted in the working tree; owner commits) · **Started:** 2026-10-27 · **Done:** 2026-10-28

## Scope
Owner: "we need to be able to upload multiple, and all that needs to get triaged and populated on a kanban of sorts. On a separate view, you can dive into each document OR on the Kanban, you can click into action items / denials." Plus 15–20 demo files to show "10, then 5 more". Later decisions: Supabase storing full demo documents (dummy only), Dashboard + Documents (board/list), automatic columns, **Mark reviewed** instead of drag, document-level review.
Out of scope: real EOBs, per-user login, per-item ticks, SFTP.

Design: `docs/superpowers/specs/2026-10-27-poc-tracking-board-design.md` · Plan: `docs/superpowers/plans/2026-10-27-poc-tracking-board.md` · Mockup: `docs/superpowers/mockups/board-v2.html`.

## Design (as built)
- **Storage** (D32, D34): Supabase table `documents` + private bucket `eob-pdfs` (`supabase/schema.sql`); the browser never talks to Supabase — `server.js` → `store.js` (REST, service key, one retry on network-level failures).
- **Demo-only guard** (D36): generator stamps every PDF (Info `/Subject REMIT-DEMO-SYNTHETIC` + footer on every page); browser pre-checks the Subject; server re-reads the PDF with bundled pdf.js and refuses (422) anything without both.
- **AI** (D33): server-side queue (2 at a time) after upload, result stored on the row; startup re-queues pending rows; "Try again" re-queues.
- **Rules** (pure, tested, `eob.js`): `autoStage`, `attentionItems`, `summarize` (money definitions D39 in the workspace DECISIONS).
- **UI**: `app.js` shell (routes, polling, upload, progress, drop), `dashboard.js`, `documents.js` (board + list), `doc.js` (stored document view), `rules.js` (+ Storage card, Clear demo data), `ui.js` helpers. Columns: Doesn't add up · Action needed · Ready to Review · ✓ Reviewed (D37).
- **Demos**: 20 PDFs in `demo/batch-1..3` (10 + 5 + 5), dates relative to the day generated (D38).

## Log
- 2026-10-27 Brainstorm + mockups; design approved incl. superseding D13/D26. Builder check raised 5 gaps; 3 settled as my calls (guard scope, relative dates, money definitions), 2 answered by owner.
- 2026-10-27 Verified bundled pdf.js parses in Node before planning (no new dependency).
- Tasks 1–3: stamp + relative dates (ruling: shift dates by base−REF instead of rewriting specs), pure rules, 20 demos — 40 unit tests.
- Task 4: Supabase key turned out to be the legacy `service_role` JWT → header rule (apikey always; Bearer only for JWTs). `STORE OK`.
- Task 5: API + queue. `lines` stored per page (consumers `.flat()`); PDF route served without CSP (Chrome's PDF viewer).
- Task 6: module split. **Found by e2e:** hash-only navigation to a just-uploaded doc stayed on "Loading…" → shell re-fetches once, then "not found".
- Task 7: **Found by e2e:** (1) intermittent `fetch failed` on Supabase POST/DELETE (Node reuses a closed pooled connection; only GETs auto-retry) → one retry in `store.js call()`; (2) one network blip stopped AI polling forever → keep retrying, stop only on 401; (3) phone nav overflowed (4 items) → wraps; (4) sidebar CSS hit the List/Board switch → scoped to `.sidebar nav`.
- Task 8: **Found by e2e:** `.cols.dash` overrode the mobile one-column rule → fixed. A masked failure (`| tail -1` hid the exit code) was caught from the ledger line and re-verified with `pipefail`.
- 2026-10-28 Owner: never commit/push — all changes left uncommitted (first 5 local commits are on branch `poc-v2-tracking-board`).

## Verification
- `npm test` → 40/40 (parser, stamp, buckets, stages, attention items, money totals, 25 demos).
- `node store.check.js` → `STORE OK` (real Supabase).
- `bash api.check.sh` (server on :3440) → `API OK`: 401 without session, 201 upload, 409 duplicate, 422 un-stamped / not a PDF, 200/400 stage, PDF bytes, clear.
- `npm run e2e` (workspace root; starts its own server on :3450) → `E2E OK`: document view, Open PDF, AI box, Mark reviewed persists, claim deep link; batch-1 → 10 cards in 1/4/5 columns, batch-2 → 15; mixed upload (good + duplicate + garbage + un-stamped) → 1 · 1 · 2 with reasons; dashboard KPIs equal `summarize()` computed in Node; PIP row → claim; reviewed items leave Needs attention; Locked banner after restart; Clear demo data with in-page confirm; no-Supabase banner + disabled upload; no console errors; no sideways scroll at 390 px.

## Follow-ups
- Billing team review session with the demo batches.
- Per-item "done" ticks, per-user login and audit log belong to the final app.
- Regenerate demos (`node demo/make-demos.js`) and **Clear demo data** the day before each demo (dates are relative).
