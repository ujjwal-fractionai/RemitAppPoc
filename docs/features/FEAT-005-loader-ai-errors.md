# FEAT-005 — Full-screen loader, AI error isolation

**Status:** Done · **Done:** 2026-10-22

## Scope
Owner: "add a loader full and show once we have whole info; if AI fails show error in AI one and load rest; if there is an error show error there too."

## Design
D26. `app.js:load()` + `loader()` (3 live steps, seconds counter), `render(r, ai)` once; `getInsights()` 60 s timeout; `aiContent()` error box + "Try again"; PDF errors → "Couldn't read this EOB" card. `server.js`: Gemini 45 s timeout, readable "no answer" error. Flow: FLOW §2, §4.

## Verification
Chrome: loader hides dashboard until Gemini returns; bad API key → dashboard + "API key not valid" in AI box, retry works; garbage file → "Invalid PDF structure."; non-EOB PDF → "No claims were found in this PDF."; no page errors.
