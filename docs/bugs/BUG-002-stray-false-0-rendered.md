# BUG-002 — Stray "false" / "0" text on the dashboard

**Status:** Fixed · **Severity:** Low · **Found:** 2026-10-20 · **Fixed:** 2026-10-21

## Symptom
The word "false" between cards; later a lone "0" in the payment card.

## Root cause
Conditional UI written as `cond && element`. `app.js:h()` drops `null`/`false`, but (a) one call passed children straight to `replaceChildren()`, which stringifies `false`, and (b) `reversedPt && …` yields the number `0`, which `h()` correctly renders (counts must render "0").

## Fix
Wrap top-level content in `h("div", …)`; use explicit comparisons (`x !== 0 &&`, `length > 0 &&`). Audited all `&&` children in `app.js`.

## Verification
Playwright check "stray false nodes: 0" on every demo; visual check of payment card.
