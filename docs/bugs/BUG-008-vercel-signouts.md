# BUG-008 — Signed out within minutes on Vercel; board looks empty

**Status:** Fixed (uncommitted, branch `vercel-sessions`) · **Severity:** High (deployed POC unusable) · **Found:** 2026-10-29 · **Fixed:** 2026-10-29

## Symptom
On the Vercel deployment: "Your session ended. Enter the passcode again." after a few minutes or a refresh; PDFs didn't open; when a second person signed in, the first person's board showed no documents (looked like files were deleted; they were still in Supabase).

## Reproduce
Two servers with the same `APP_PASSCODE` (= two Vercel instances): sign in on one, send the cookie to the other → 401.

## Investigation
Supabase rows were intact; every symptom was a 401. `GET /api/docs` 401 leaves `state.docs` empty (board shows 0); Open PDF 401 redirects to /login.

## Root cause
`server.js` kept sessions in an in-memory Map. Vercel runs several short-lived instances with separate memory, so a request on any instance other than the one that handled the login was unauthenticated.

## Fix
Stateless cookie `<expiry>.<HMAC(expiry)>` (D45); no server-side session store. Optional `SESSION_SECRET` in `.env.example`; Rules tab text updated.

## Verification
Two-instance check (sign in on :3461, use cookie on :3462): RED 401 before, GREEN 200 after; forged cookie 401; cookie from a server with another passcode 401; expired cookie → 401 / `/login?e=expired`; Lock clears the cookie; `npm test` 54 pass.
