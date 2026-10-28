# BUG-005 — Misleading "Next step" wording

**Status:** Fixed · **Severity:** Low · **Found:** 2026-10-21

## Symptom
"Bill patient $0.00 and work 1 denied line(s)" for a partial claim where the patient owes nothing; "Paid; only contractual write-off" on claims paid in full with no write-off.

## Fix
`eob.js:nextAction()`: PARTIAL joins only the parts that apply; PAID says "Paid in full" when billed == paid.

## Verification
Printed every PARTIAL/PAID action across all demos; tests pass.
