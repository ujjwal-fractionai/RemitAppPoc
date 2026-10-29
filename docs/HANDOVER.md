# HANDOVER — POC

**Read this first when working on the POC.** Keep it short and current: replace stale lines, don't append history (history lives in `features/`, `bugs/` and `DECISIONS.md`). Project-wide state (Waystar SFTP, final app, open questions for the practice) is in the workspace `docs/HANDOVER.md`.

_Last updated: 2026-10-29_

---

## Right now

- **v2 tracking board** (FEAT-007) is merged to `main`.
- **Billing team's denial playbook** (FEAT-008, D41) is on branch `billing-denial-playbook`, **uncommitted**: fix steps under each denied claim, reason names in next steps / Needs attention / top reasons, playbook + terms on the Rules tab, `billingPlaybook` to the AI, `demo/batch-4` (4 EOBs, one per uncovered denial code). The playbook + terms are a config file, `public/denial-playbook.json` (D42): edit it, then `npm test`. Demos use only its codes (no other adjustment, remark or fee codes, D44); `demo/` now holds only the 4 upload batches (D43).
- **Vercel sign-outs fixed** (BUG-008, D45) on branch `vercel-sessions`, **uncommitted**: the login cookie is now signed, so any server instance accepts it. On Vercel set `APP_PASSCODE` (and optionally `SESSION_SECRET`) in the project env.
- **Waiting on owner:** review + commit FEAT-008; ask billing about CO-119 on non-PIP plans, CARC 109 for "wrong payer", and which remark codes pick between CO-16 / CO-4 / CO-11 rows; confirm money definitions (workspace D39) and the 90-day filing estimate (D21).

## Done

| What | Where | Trace |
|---|---|---|
| v1: EOB PDF → dashboard + Gemini insights | `public/`, `server.js` | FEAT-001 |
| PIP / bill next payer | `public/eob.js`, `demo/` | FEAT-002 |
| Rules & settings tab | `public/rules.js` | FEAT-003 |
| Passcode page | `server.js`, `login.html` | FEAT-004 |
| v2: tracking board on Supabase | `server.js`, `store.js`, `public/*.js`, `supabase/`, `demo/batch-*` | FEAT-007 |
| Billing team denial playbook + terms | `public/eob.js`, `doc.js`, `rules.js`, `demo/batch-4` | FEAT-008 |

(FEAT-005's full-screen loader was retired by v2, D33.)

## Broken / open

- Vercel: the AI queue runs inside the request's instance; a summary can sit on "pending" until a later page poll re-queues it, and two instances may both call Gemini for it. Fine for the demo; move to a queue/cron if it bites. Watch: Supabase free projects pause after ~1 week idle (restore in the dashboard before a demo).

## How to run

```bash
# one-time: POC/.env needs GEMINI_API_KEY, APP_PASSCODE, SUPABASE_URL, SUPABASE_SECRET_KEY (service role)
#           and supabase/schema.sql run once in the Supabase SQL Editor
npm start                         # http://127.0.0.1:3000
npm test                          # 54 unit tests, must stay green (offline, safe)
# ⚠ The next three checks DELETE every document in the shared Supabase board. Never run them on a demo day after
#   you've prepared the board — run them first, then upload your demo batches.
node store.check.js               # STORE OK  (real Supabase)
APP_PASSCODE=check-pass-123456 PORT=3440 node server.js &  bash api.check.sh   # API OK
(cd .. && npm run e2e)            # E2E OK — real Chrome; starts its own server on :3450; clears demo data
node demo/make-demos.js           # regenerate demos (dates relative to today) — then Rules → Clear demo data
```

**Demo script:** Rules → Clear demo data · Documents → Upload EOBs → `demo/batch-1` (10) → show board + Dashboard · upload `batch-2` (5) → watch it grow · upload `batch-4` (4) → open a denied claim → "How to fix" playbook steps · open the PIP card → PIP alert + Open PDF · Mark reviewed.

## Avoid

- Coding without Ponytail mode: always invoke `ponytail:ponytail` first (D31).
- Real PHI anywhere: in this repo, Supabase, tests, logs or AI prompts. Never weaken the demo-stamp guard (D36).
- Sending Gemini anything except `eob.js:deidentify()` output. If you add a field there, extend the "no PHI" test.
- Letting the AI compute money, buckets, stages or deadlines (D15).
- Calling Supabase from the browser or adding supabase-js / other npm deps to the server (D16, D34); CDN scripts (D25).
- Hard-coded rule values in UI code: add a named constant in `eob.js` so the Rules tab shows it (D23). Denial playbook text goes in `public/denial-playbook.json`, not code (D42).
- `cond && element` with numbers in UI code (BUG-002); `h()` props with `undefined` values (they become attributes).
- `git commit` / `git push` — leave changes for the owner.

## Next steps

1. Owner reviews and commits FEAT-008 (branch `billing-denial-playbook`).
2. Billing team review with the demo batches (upload 10, then 5).
3. Feed their feedback (column rules, money definitions, deadlines) into the final app's spec.
