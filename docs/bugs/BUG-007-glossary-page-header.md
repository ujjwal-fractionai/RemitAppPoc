# BUG-007 — Repeated page header read as glossary entries

**Status:** Fixed (uncommitted, branch `billing-denial-playbook`) · **Severity:** Low · **Found:** 2026-10-28 · **Fixed:** 2026-10-28

## Symptom
"Code meanings from this EOB" listed junk keys ("TEST HEALTH", "200 PLAN AVE", "PROV"…) for `demo/batch-1/b1-03-copays.pdf`. Found by a scan of every demo PDF for codes outside `denial-playbook.json` (FEAT-008).

## Reproduce
Any EOB whose GLOSSARY section continues onto a new page (Waystar repeats the payer header on every page).

## Investigation
Only b1-03 showed it: the only demo whose glossary crosses a page break. Header rows are fixed-width like glossary rows, so the glossary branch took their left part as a code.

## Root cause
`public/eob.js:parseEob` glossary mode treated every line as `code  text` and never skipped the page header.

## Fix
In glossary mode, skip lines matching the header pattern (`LABEL:  value`) or the column header. `ponytail:` comment notes the limit (glossary text shaped like a header row would be skipped).

## Verification
Test "glossary that runs onto a new page ignores the repeated page header (BUG-007)": RED on b1-03, GREEN after the fix; `npm test` 54 pass; PDF scan: no non-code glossary keys.
