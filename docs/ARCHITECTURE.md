# ARCHITECTURE — POC

The shape of the prototype: what the pieces are and how data moves. Call paths: [FLOW.md](FLOW.md). Why: [DECISIONS.md](DECISIONS.md). The whole project (final app, Waystar SFTP, database plan, roadmap) is in the workspace `docs/ARCHITECTURE.md`.

---

## 1. Folder map

```
POC/                           ← its own git repo (github: RemitAppPoc)
├── CLAUDE.md                  ← entry point for agents working only in this repo
├── server.js                  ← Node server: passcode gate, static files, document API, background AI queue
├── store.js                   ← the only door to Supabase (PostgREST + Storage REST via fetch)
├── login.html                 ← passcode page (served by server.js)
├── supabase/schema.sql        ← table `documents` + private bucket `eob-pdfs` (run once in the SQL Editor)
├── public/                    ← everything the browser runs (plain ES modules, no build)
│   ├── index.html             ← layout + all CSS (bookkeep tokens, shadcn-like look)
│   ├── app.js                 ← shell: routes, load/poll documents, upload + progress, Mark reviewed, banners
│   ├── dashboard.js           ← Dashboard: KPIs, Needs attention, money breakdown
│   ├── documents.js           ← Documents: board (4 columns) + list
│   ├── doc.js                 ← one stored document: breakdown, PIP card, AI box, claims, Open PDF
│   ├── rules.js               ← Rules & settings (read-only) + Storage / Clear demo data
│   ├── ui.js                  ← h() DOM builder (text only), pills, bucket/stage vocabulary
│   ├── denial-playbook.json   ← billing team's denial playbook + terms (source of truth, D42)
│   ├── eob.js                 ← PURE logic: parse, checks, buckets, pairing, stages, attention items, totals, de-identify
│   └── vendor/                ← pdf.js (bundled; also used by the server in Node)
├── demo/make-demos.js         ← generates stamped synthetic EOB PDFs (also the test fixtures)
│   ├── *.pdf                  ← 5 v1 demos
│   └── batch-1/ (10) · batch-2/ (5) · batch-3/ (5) · batch-4/ (4, denial playbook codes)
├── eob.test.js                ← node:test suite (npm test)
├── store.check.js · api.check.sh  ← integration checks against the real Supabase
└── docs/                      ← HANDOVER, ARCHITECTURE, FLOW, DECISIONS, features/, bugs/, superpowers/
```
End-to-end browser checks live in the workspace: `RemitApp/tools/e2e-board.mjs` (`npm run e2e`).

## 2. How it works (v2, demo documents only)

```
 Browser (billing staff PC) ─────────────────────────────────────────────────────────────
   Upload N PDFs ─► pdf.js stamp pre-check ─► POST /api/docs (raw PDF)
   Dashboard · Documents board/list · Document view  ◄── GET /api/docs (rows: text + stage + ai)
       every row re-analysed here: eob.js analyze → autoStage / attentionItems / summarize
   Mark reviewed / Reopen ─► PATCH   ·   Open PDF ─► GET /api/docs/:id/pdf
                                   │ cookie (passcode session), CSP connect-src 'self'
 POC/server.js (Node, 0 deps) ─────┼─────────────────────────────────────────────────────
   passcode gate ─► document API ─► pdf.js in Node: read text, require demo stamp (else 422)
                 └► AI queue (2 at a time): analyze → deidentify ─► Gemini ─► store result on the row
                                   │ store.js: REST + service key (never in the browser)
 Supabase ─────────────────────────┼─────────────────────────────────────────────────────
   table documents (file_name, sha256, pdf_path, lines, stage, ai, ai_status…)  ·  bucket eob-pdfs (private)
```

| Piece | Responsibility | Never does |
|---|---|---|
| `eob.js` | Parse text, check math, buckets, pairing, follow-up, stages, attention items, totals, de-identify, billing team denial playbook | Touch DOM, network or storage |
| `app.js` + views | Show documents, upload, Mark reviewed, poll for AI | Compute money; call Supabase or Gemini directly |
| `server.js` | Passcode, demo-stamp guard, document API, AI queue | Store a PDF without the demo stamp; log bodies, PDFs or keys |
| `store.js` | Supabase REST calls (one retry on network failure) | Run outside the server |
| Gemini | Summary + prioritised actions from de-identified JSON | Decide numbers, buckets, stages or deadlines |

**Data boundary:** only synthetic demo documents are stored (stamp enforced by the server). Gemini receives only `deidentify()` output. Real EOBs (`RemitApp/pdfs/`) are refused at upload.

## 3. History

- v1 (2026-10-20 → 22): one PDF at a time, parsed in the browser, nothing stored (FEAT-001…005).
- v2 (2026-10-27 → 28): multi-document tracking board on Supabase (FEAT-007; spec/plan in `docs/superpowers/`).

## 4. Configuration

| Where | Holds |
|---|---|
| `POC/.env` | `GEMINI_API_KEY`, `GEMINI_MODEL`, `APP_PASSCODE`, `PORT`, `HOST`, `SUPABASE_URL`, `SUPABASE_SECRET_KEY` (service role) |
| `public/eob.js` (top) | All business rules as named constants (shown read-only on the Rules tab), demo stamp, shared messages |
| `server.js` | `SESSION_HOURS`, `MAX_FAILS`, `LOCK_MINUTES`, Gemini prompt + schema, AI concurrency (2), upload limit (5 MB) |
| `public/denial-playbook.json` | Billing team's denial playbook + terms (edit, then `npm test`) |
| `supabase/schema.sql` | Table + bucket definition |
