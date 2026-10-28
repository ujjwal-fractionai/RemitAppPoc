# FEAT-003 — Rules & settings tab

**Status:** Done · **Done:** 2026-10-21

## Scope
Owner: "for all constants you added make one more section/tab in sidebar so users can see what the constants are."

## Design
All rule values exported as named constants at the top of `POC/public/eob.js` (D23); `app.js:renderRules()` reads them directly plus `GET /api/config` for model / passcode / session values. Read-only, each row shows "Change in: file · CONSTANT". Hash routing `#explainer` / `#rules` (`showView`). Flow: FLOW §5.

## Verification
Chrome: tab switch keeps the loaded EOB; direct `/#rules` link works; mobile nav row visible; tests still pass (PIP detection rebuilt from `PIP_PAYER_WORDS`).

## Follow-ups
Editing values from the UI needs persistence (final app).
