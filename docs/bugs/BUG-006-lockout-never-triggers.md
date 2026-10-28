# BUG-006 — Passcode lockout never triggered

**Status:** Fixed before release · **Severity:** High (security) · **Found:** 2026-10-22

## Symptom
Found in self-review, not in use: the failed-attempt count reset to 1 on every wrong passcode.

## Root cause
The window check compared against `until` (0 when not locked) instead of the time of the first failure.

## Fix
`server.js:handleLogin()`: store `{ count, first, until }`; count within `LOCK_MINUTES` of `first`; cap the Map at 10,000 entries.

## Verification
curl: tries 1–4 "isn't right", try 5 → 429 "Too many tries", correct passcode refused while locked.
