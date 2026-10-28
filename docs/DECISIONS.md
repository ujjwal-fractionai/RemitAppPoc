# DECISIONS — POC: what we chose and why

Every meaningful decision, with the reasoning and the trade-off we accepted. Append new entries; never rewrite history. If a decision changes, add a new entry that **supersedes** the old one and mark the old one.

**Status values:** Decided (owner approved) · Proposed (recommended, needs owner OK) · Superseded · Open.
**Rule:** do not change a Decided item without the owner's explicit approval.

Entry format:
```
### Dnn — Title  ·  Status  ·  YYYY-MM-DD
Decision: …
Why: …
Rejected: … (and why)
Trade-off: … what we gave up / the known ceiling
```

---

> This file holds decisions about **how the POC is built**. Project-wide and business-rule decisions (D1–D11, D14, D15, D17–D21, D28–D31: SFTP, database, Gemini, money in cents, bucket rules, PIP rules…) live in the workspace `docs/DECISIONS.md` (`../../docs/DECISIONS.md` from here). Numbering is shared: **next free number is D41**.

## Index

| # | Decision | Status |
|---|---|---|
| D12 | Build a POC that reads EOB PDFs before the 835 pipeline | Decided |
| D13 | Parse the PDF in the browser; PHI never leaves it | Superseded for POC v2 by D32 |
| D16 | POC server in plain Node, zero npm dependencies, pdf.js bundled | Decided |
| D22 | PIP detected by payer-name keywords | Decided (POC) |
| D23 | All rules as named constants, shown read-only on a Rules tab | Decided |
| D24 | Passcode page + in-memory sessions for the POC | Decided (POC) |
| D25 | Strict Content-Security-Policy on every response | Decided |
| D26 | Loader waits for AI; AI failure never blocks the dashboard | Superseded by D33 |
| D27 | Demo PDFs generated from code and used as test fixtures | Decided |
| D32 | POC v2 stores full demo documents (PDF + text) in Supabase, via the server | Decided (owner approved 2026-10-27) |
| D33 | AI runs server-side in a background queue; cards appear immediately | Decided (owner approved 2026-10-27) |
| D34 | Browser never talks to Supabase; service key server-side; REST via fetch | Decided |
| D35 | shadcn look in plain CSS (no React/Tailwind in the POC) | Decided |
| D36 | Demo-only guard: stamp in PDF + server re-reads every upload | Decided |
| D37 | Four columns, automatic placement, one manual step: Mark reviewed / Reopen | Decided |
| D38 | Demo dates relative to the day they're generated | Decided |
| D40 | Column "Ready to post" renamed "Ready to Review" | Decided (owner, 2026-10-28) |
---

## Entries

### D12 — POC reads EOB PDFs first · Decided · 2026-10-20
Decision: before the SFTP/835 pipeline, build a tool that takes the Waystar "View EOB" PDF the team already downloads.
Why: SFTP access wasn't working yet; the team gets value immediately; validates bucket rules on real data.
Trade-off: parses a printed layout (fixed-width text) instead of exact 835 data; only Waystar's layout works.

### D13 — Parse the PDF in the browser · Decided · 2026-10-20
Decision: pdf.js + `eob.js` run client-side; the server never receives the PDF.
Why: PHI never crosses the network or lands on a server → any host is fine, no hosting BAA.
Rejected: server-side parsing (would make the host a HIPAA business associate).
Trade-off: logic ships to the browser (visible, but contains no secrets).

### D16 — Zero-dependency POC server, bundled pdf.js · Decided · 2026-10-20
Why: easy deploy ("copy folder, `node server.js`"), nothing to patch, no CDN supply-chain risk on a page that shows PHI.
Rejected: Streamlit (Python; owner asked for JS), Express (not needed).

### D22 — PIP detected by payer-name keywords · Decided (POC) · 2026-10-21
Why: the PDF has no claim filing indicator. Trade-off: name matching can miss/over-match; switch to payer IDs (835 CLP06 = AM auto) in the final app.

### D23 — Rules as named constants + read-only Rules tab · Decided · 2026-10-21
Why: one source of truth; billing can see exactly how decisions are made. Editing from the UI waits for the DB (needs persistence).

### D24 — POC passcode gate · Decided (POC) · 2026-10-21
Decision: own passcode page (no browser Basic-auth dialog), `APP_PASSCODE` in `.env`, random session token in an HttpOnly SameSite=Strict cookie, sessions in memory for 12 h, 5 wrong tries → 15 min lock per IP, refuse to start exposed without a passcode.
Why: keep crawlers off the app and the Gemini budget with the least machinery.
Trade-off: shared passcode (no per-user audit), restart signs everyone out, per-IP lock trusts X-Forwarded-For. Real per-user auth = D11.

### D25 — Strict CSP · Decided · 2026-10-20
`default-src 'self'`, no third-party scripts, `connect-src 'self'`, `frame-ancestors 'none'`. Why: PHI is on screen; nothing injected can send it elsewhere.

### D26 — Loader waits for AI; AI failure isolated · Decided · 2026-10-22
Why: owner wanted everything to appear at once. AI errors/timeouts (45 s server, 60 s browser) show inside the AI box with "Try again"; PDF errors show a clear card. Trade-off: dashboard appears 5–15 s later than it could.

### D27 — Demo PDFs from code, used as fixtures · Decided · 2026-10-21
Why: demos with no PHI for training/sales, and the test suite proves the generator and parser agree.

### D32 — POC v2 stores full demo documents in Supabase · Decided · 2026-10-27 · supersedes D13 for the POC
Decision: uploaded PDFs, their extracted text (per page) and AI results are stored in Supabase (table `documents`, private bucket `eob-pdfs`) so every login sees the same board and can reopen the PDF.
Why: the owner wants the POC to show what the tracking tool will be; a per-browser store (IndexedDB) can't be shared.
Rejected: IndexedDB (not shared); storing only de-identified data (other logins couldn't open the PDF or see names); Supabase with real PHI (no BAA).
Trade-off: only possible because the POC is **demo documents only** (D36). Real EOBs must never be stored here.

### D33 — Background AI on the server · Decided · 2026-10-27 · supersedes D26
Decision: after each upload the server queues one Gemini call (2 at a time), stores `ai` / `ai_status` / `ai_error` on the row, re-queues pending rows on startup; the browser polls every 4 s while anything is pending. Full-screen loader removed.
Why: with 10+ uploads, waiting for each AI summary would make cards appear minutes late; numbers never depend on the AI anyway (D15).
Trade-off: in-memory queue (ponytail) — fine at demo volume; a restart only delays, never loses, work.

### D34 — Supabase only through the server · Decided · 2026-10-27
`store.js` is the only module that talks to Supabase (PostgREST + Storage REST via `fetch`, no supabase-js). Uses the service-role key from `.env`; RLS on with no policies, so nothing else can read the data. Header rule: `apikey` always, `Authorization: Bearer` only for legacy JWT keys. One retry on network-level `fetch failed` (Node reuses closed pooled connections; it auto-retries only GETs).
Why: keeps CSP `connect-src 'self'` and the passcode in front of all data; zero npm dependencies (D16).

### D35 — shadcn look, plain CSS · Decided · 2026-10-27
Cards, tabs, badges and buttons copy shadcn's look with the existing bookkeep tokens. Rejected: adding React + Tailwind + a build step to the POC. The final Next.js app can use real shadcn.

### D36 — Demo-only guard · Decided · 2026-10-27
Every generated PDF carries Info `/Subject (REMIT-DEMO-SYNTHETIC)` and the footer `SYNTHETIC DEMO DATA - NOT A REAL EOB` on every page. The browser pre-checks the Subject; the server re-reads the PDF itself (bundled pdf.js in Node) and returns 422 unless both are present; the browser never sends parsed text.
Scope: stops honest mistakes. Deliberately forging the stamp onto a real PDF is out of scope for a passcode-gated demo.

### D37 — Columns and Mark reviewed · Decided · 2026-10-27
Columns: Doesn't add up · Action needed · Ready to post · ✓ Reviewed. `eob.js:autoStage` places documents; the only manual step is Mark reviewed (for Ready to post: once posted) and Reopen. No drag and drop, no In-progress column; review is per document (no per-item ticks yet). Stored `stage` is `'reviewed'` or null.
Why: owner preference — simplest workflow that still tracks what's handled.

### D38 — Relative demo dates · Decided · 2026-10-27
Demo specs are written as if today were 2026-10-21; `demos(base)` shifts every printed date by base − that day, so PIP cases stay open / due soon / overdue whenever the demo runs. Tests pin the base. Regenerate before a demo and Clear demo data (file hashes change).

### D40 — "Ready to post" renamed "Ready to Review" · Decided · 2026-10-28 · amends D37
Owner: "it aligns more" with the review workflow (every document ends with Mark reviewed). Label only: the stage key stays `ready`, rules unchanged.

### D41 — Billing team's denial playbook as a rule constant · Decided · 2026-10-28
Decision: the billing team's 18-row denial table (reason, adjustment codes, resolution) lives in `eob.js` as `DENIAL_PLAYBOOK` (wording kept, typos fixed), with their terms list as `TERMS`. `denialPlaybook(code)` matches the exact code, or the same reason number when both groups are denial groups (CO-27 also covers OA-27 / PI-27); PR rows never match CO/OA/PI. Shown: under each denied claim ("How to fix"), in the claim's next step and Needs attention text (reason names), as the dashboard's top-denial-reason names, on the Rules tab, and to Gemini as `billingPlaybook` (only rows for codes on the EOB; static text, no PHI).
Why: staff follow the practice's own steps instead of a generic "fix and resubmit or appeal"; one constant keeps the UI, AI and Rules tab in step (D23).
Rejected: picking one row when a code maps to several (CO-16 → 3, CO-4 / CO-11 → 2) — the remark code decides, and RARC→row mapping wasn't given; so all matching rows are shown with a note. Mapping "wrong payer" to CARC 109 — the team listed it as payer-specific; left with no code until they confirm.
Trade-off: bucket rules unchanged. CO-119 still routes to Bill next payer (D9/D20); the playbook's 119 guidance (verify limits / explain patient responsibility) is shown alongside — to confirm with billing for non-PIP payers.

### D42 — Denial playbook lives in a JSON config file · Decided · 2026-10-28 · amends D41, D23
Decision: the billing team's table is `public/denial-playbook.json` (`denial_resolution_guide`, their JSON as sent, plus `terms`). `eob.js` imports it as a JSON module (`import … with { type: "json" }`, works in Node 24 and current browsers); entries in `adjustment_codes` that aren't `XX-nn` codes become `notes`. The server serves `.json` as `application/json`. A test fails if any playbook code has no demo EOB showing it.
Why: owner wants the billing team's document to be the source of truth; one file they can read and edit, no second copy in code.
Rejected: keeping the rows as a JS constant (copy drifts from billing's doc); a database table (no editor UI in the POC, and D34 keeps Supabase server-only).
Trade-off: an edit to the JSON changes the app immediately: run `npm test` after editing (it checks the file loads and the demos still cover every code).

