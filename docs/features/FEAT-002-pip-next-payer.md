# FEAT-002 — PIP maximum reached / bill next payer + demo PDFs

**Status:** Done (POC) · **Started:** 2026-10-21 · **Done:** 2026-10-21

## Scope
Owner (most important): a demo with PIP claims that reached the maximum, showing (1) PIP maximum reached in Delaware, (2) insurance must be billed instead, (3) deadline and follow-up status. Plus more demo PDFs.

## Design
- CARC 119 (+ RARC N587) → new bucket NEXT_PAYER (D20), not counted as denied lines.
- PIP detection by payer name (D22); Delaware minimum $15,000/person, $30,000/accident (21 Del. C. § 2118) as `DE_PIP_MINIMUM`.
- Deadline = check date + 90 days, statuses open / due soon (≤14 d) / overdue (D21), computed in `analyze(r, today)`.
- UI: `app.js:pipCard()` (amount to bill, file-by date, status pill, 5-step checklist), new tile, next-step text.
- Gemini prompt: NEXT_PAYER = bill health insurance, never appeal; due soon/overdue = first High action. Only the status word is sent, never a date.
- Demos from `demo/make-demos.js` (D27): pip-maximum-reached, denials-paper-check, deductible-season, reversals-reprocessed, needs-review-mismatch (+ synthetic-eob).

## Log
- Verified Delaware PIP minimum and N587 wording by web search; CARC 119 wording from the standard list.
- Fixed while testing: stray "0" in payment card, "Bill patient $0.00…" wording, "contractual write-off" on paid-in-full claims (BUG-002, BUG-005).
- Added explicit warning when the check doesn't reconcile (mismatch demo previously showed only a pill).

## Verification
`npm test`: each demo's `expect` block (buckets, reconciled, pairs, PIP, amount $280.50) + deadline test with fixed dates (due 11/02/2026; 12 days left on 10/21 = due soon; overdue on 11/03). Browser: PIP card, Gemini ranked PIP billing as first High action.

## Follow-ups
Per-plan timely-filing limits from billing. Tracking "billed to health insurance" needs storage (final app). A real redacted PIP remit to confirm payer codes.
