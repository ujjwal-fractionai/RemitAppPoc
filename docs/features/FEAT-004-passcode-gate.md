# FEAT-004 — Passcode page

**Status:** Done (POC) · **Done:** 2026-10-22

## Scope
Owner: "put a passcode on it so random web crawlers don't use our Gemini budget … in the .env … a page with a text field, don't use Chrome's dialog, just PASSCODE, no username."

## Design
D24. `server.js`: `authed`, `handleLogin`, `loginPage`, `/logout`; `login.html` (plain HTML form, no JS); sidebar "Lock" link; Access section on the Rules tab. CSP `form-action` changed to `'self'`. Flow: FLOW §1.

## Log
- Self-review caught a bug before release: failed-attempt counter reset every time, so lockout never triggered (BUG-006).

## Verification
curl: unauthenticated `/` → 303 /login, assets → 303, `/api/insights` → 401; 4 wrong → "isn't right", 5th → 429 locked (right passcode also refused while locked); right passcode → 303 + HttpOnly cookie; logout clears; forged cookie rejected; `HOST=0.0.0.0` without passcode → refuses to start. Chrome: no browser dialog, autofocus, error message, unlock → app, Lock → login.

## Follow-ups
Per-user SSO (D11). HTTPS required in deployment.
