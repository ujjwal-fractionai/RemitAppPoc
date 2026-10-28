# BUG-003 — Gemini told staff to write off a denial

**Status:** Fixed · **Severity:** Medium · **Found:** 2026-10-21

## Symptom
First live Gemini run: "C3 is denied. Write off the $60.00 (CO-50). No appeal is needed." Also every action marked High.

## Root cause
Prompt didn't state the billing policy for DENIED or define priorities.

## Fix
`server.js` PROMPT: DENIED is never "write off / no appeal" → review reason, correct and resubmit or appeal; priorities High (denials, refunds, deadlines, unreconciled) / Medium (bill patient) / Low (routine posting, combined).

## Verification
Re-run: "[High] Review denial for C3 … correct/resubmit or appeal", Medium patient bills, Low posting.
