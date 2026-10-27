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

> This file holds decisions about **how the POC is built**. Project-wide and business-rule decisions (D1–D11, D14, D15, D17–D21, D28–D31: SFTP, database, Gemini, money in cents, bucket rules, PIP rules…) live in the workspace `docs/DECISIONS.md` (`../../docs/DECISIONS.md` from here). Numbering is shared: **next free number is D32**.

## Index

| # | Decision | Status |
|---|---|---|
| D12 | Build a POC that reads EOB PDFs before the 835 pipeline | Decided |
| D13 | Parse the PDF in the browser; PHI never leaves it | Decided |
| D16 | POC server in plain Node, zero npm dependencies, pdf.js bundled | Decided |
| D22 | PIP detected by payer-name keywords | Decided (POC) |
| D23 | All rules as named constants, shown read-only on a Rules tab | Decided |
| D24 | Passcode page + in-memory sessions for the POC | Decided (POC) |
| D25 | Strict Content-Security-Policy on every response | Decided |
| D26 | Loader waits for AI; AI failure never blocks the dashboard | Decided |
| D27 | Demo PDFs generated from code and used as test fixtures | Decided |

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
