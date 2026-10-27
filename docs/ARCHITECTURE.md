# ARCHITECTURE — POC

The shape of the prototype: what the pieces are and how data moves. Call paths: [FLOW.md](FLOW.md). Why: [DECISIONS.md](DECISIONS.md). The whole project (final app, Waystar SFTP, database plan, roadmap) is in the workspace `docs/ARCHITECTURE.md`.

---

## 1. Folder map

```
POC/                           ← its own git repo (github: RemitAppPoc)
├── CLAUDE.md                  ← entry point for agents working only in this repo
├── server.js                  ← Node server: static files, passcode gate, Gemini proxy
├── login.html                 ← passcode page (served by server.js)
├── public/                    ← everything the browser runs
│   ├── index.html             ← layout + all CSS
│   ├── app.js                 ← UI: upload, loader, dashboard, Rules tab
│   ├── eob.js                 ← PURE logic: parse EOB text, checks, buckets, pairing, de-identify
│   └── vendor/                ← pdf.js (bundled, not from a CDN)
├── demo/make-demos.js         ← generates synthetic demo PDFs (also the test fixtures)
├── eob.test.js                ← node:test suite
└── docs/
    ├── HANDOVER.md            ← POC state right now (read first)
    ├── ARCHITECTURE.md        ← this file
    ├── FLOW.md                ← call paths, file → function
    ├── DECISIONS.md           ← POC decisions (D12, D13, D16, D22–D27, …)
    ├── features/ · bugs/      ← one trace file each (FEAT-001…005, BUG-002…006)
    └── superpowers/           ← design specs, build plans, mockups
```

## 2. How it works today (v1, live)

Upload one Waystar "View EOB" PDF → dashboard + AI to-do list. No database, nothing stored.

```
 ┌──────────────────────── Browser (billing staff PC) ─────────────────────────┐
 │  PDF file ─► pdf.js ─► eob.js: pageLines → parseEob → analyze ─► app.js UI  │
 │                         (full PHI stays here)          │                     │
 │                                           deidentify() │ numbers + codes     │
 └────────────────────────────────────────────────────────┼─────────────────────┘
                                                          ▼ POST /api/insights (cookie)
                                   ┌──────────── POC/server.js (Node, 0 deps) ───┐
                                   │ passcode gate → forward → Gemini REST API   │
                                   └─────────────────────────────────────────────┘
```

| Piece | Responsibility | Never does |
|---|---|---|
| `eob.js` | Parse text, check the math, bucket, pair reversals, follow-up deadlines, build the de-identified payload | Touch the DOM or network |
| `app.js` | Upload, loader, render dashboard / PIP card / tables / Rules tab, call `/api/insights` | Compute money (asks `eob.js`) |
| `server.js` | Serve files, passcode sessions, call Gemini with the server-side key | See the PDF or any PHI |
| Gemini | Write summary + prioritised actions from de-identified JSON | Decide numbers or buckets |

**PHI boundary:** the PDF and everything identifying stays in the browser. Only `deidentify(r)` output crosses the network (HIPAA Safe Harbor: no names, member/account/claim IDs, NPIs, dates).

---

## 3. Next: v2 tracking board (planned)

Multi-upload, Supabase storage (demo documents only), Dashboard + Documents board, Mark reviewed. Design: `docs/superpowers/specs/2026-10-27-poc-tracking-board-design.md`; plan: `docs/superpowers/plans/2026-10-27-poc-tracking-board.md`. Update §1–§2 of this file when it ships.

## 4. Configuration

| File | Holds |
|---|---|
| `POC/.env` | `GEMINI_API_KEY`, `GEMINI_MODEL`, `APP_PASSCODE`, `PORT`, `HOST` (v2 adds `SUPABASE_URL`, `SUPABASE_SECRET_KEY`) |
| `public/eob.js` (top) | All business rules as named constants (shown read-only on the Rules tab) |
| `server.js` | `SESSION_HOURS`, `MAX_FAILS`, `LOCK_MINUTES`, Gemini prompt + schema |
