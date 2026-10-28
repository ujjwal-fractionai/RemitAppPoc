# FEAT-001 — POC: upload EOB PDF → dashboard + AI insights

**Status:** Done · **Started:** 2026-10-20 · **Done:** 2026-10-22 · **Code:** `POC/` (own git repo, github RemitAppPoc)

## Scope
Owner: "build a POC which takes upload the doc and makes the dashboard and tells using AI how many billed or unbilled partial is there and some insights … no DB just upload and get result." Later: JavaScript "so it's easy to deploy", light theme matching the bookkeep (ABACUS) app.
Out of scope: database, SFTP, 835 files, per-user login.

## Design
- PDF parsed in the browser (D13), rules in `public/eob.js` (pure), UI in `public/app.js`, zero-dep `server.js` (D16) proxying de-identified JSON to Gemini (D14, D15). Flow: FLOW §2–§4.
- Checks: line balance, claim NET, PT RESP vs PR adjustments, payment reconciliation, TOTALS row.
- Buckets (D9), reversal pairing (D18), patient labels (D19), money in cents (D17).
- UI: payment card, bucket tiles (click to filter), AI card with patient key, reversal pairs, claims table with expandable service lines, EOB glossary.

## Log
- 2026-10-20 Real UHC EOB inspected (local only, `pdfs/`, gitignored): found ACNT shared by all of one patient's claims → pairing redesigned (D18).
- 2026-10-20 First attempt was Python/Streamlit; owner switched to JS mid-build → rewritten as browser + Node.
- 2026-10-20 pypdf default extraction split every cell onto its own line; pdf.js items rebuilt into rows by y/x (`pageLines`).
- 2026-10-20 Real EOB: 9 claims, 42 lines, all balance, reconciles to $188.91, 4/4 reversals paired, no PHI in AI payload.
- 2026-10-21 Restyled to bookkeep tokens (navy sidebar, light only). Six synthetic demo PDFs (FEAT-002, D27).
- 2026-10-22 AI timing made visible ("Written by Gemini in X s").

## Verification
`cd POC && npm test` (10 tests). Browser runs via Playwright + Chrome on every demo PDF: no console errors, no horizontal scroll at 390 px.

## Follow-ups
Billing team review of buckets (D9/D20). Only Waystar's "View EOB" layout is supported.
