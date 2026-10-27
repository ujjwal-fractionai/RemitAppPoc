# HANDOVER — POC

**Read this first when working on the POC.** Keep it short and current: replace stale lines, don't append history (history lives in `features/`, `bugs/` and `DECISIONS.md`). Project-wide state (Waystar SFTP, final app, open questions for the practice) is in the workspace `docs/HANDOVER.md`.

_Last updated: 2026-10-27_

---

## Right now

- **v1 is live:** upload one Waystar EOB PDF → dashboard + Gemini insights (FEAT-001…005).
- **v2 approved, not started:** multi-document tracking board on Supabase (demo documents only) — Dashboard, Documents board/list, Mark reviewed, 20 demo EOBs.
  - Design: `docs/superpowers/specs/2026-10-27-poc-tracking-board-design.md`
  - Plan (9 tasks): `docs/superpowers/plans/2026-10-27-poc-tracking-board.md`
  - Mockups: `docs/superpowers/mockups/board-v2.html`
- **Waiting on owner:** choose execution approach (Native recommended); at plan Task 4, copy Supabase keys into `POC/.env` and run `supabase/schema.sql`.
- **Approved 2026-10-27 for v2:** supersede D13 (PDF stays in browser) and D26 (loader waits for AI). Record as D32/D33 when building.

## Done

| What | Where | Trace |
|---|---|---|
| EOB PDF → dashboard + Gemini insights, light theme | `public/`, `server.js` | FEAT-001 |
| PIP / bill next payer + 6 synthetic demo PDFs | `public/eob.js`, `demo/` | FEAT-002 |
| Rules & settings tab | `public/app.js:renderRules` | FEAT-003 |
| Passcode page | `server.js`, `login.html` | FEAT-004 |
| Full-screen loader, AI error isolation | `public/app.js:load` | FEAT-005 |

## Broken / open

- Nothing known. (Fixed: BUG-002…006.)

## How to run

```bash
npm start                    # http://127.0.0.1:3000 ; needs POC/.env (GEMINI_API_KEY, APP_PASSCODE)
npm test                     # must stay green
node demo/make-demos.js      # regenerate demo PDFs after changing demo specs
```

## Avoid

- Coding without Ponytail mode: always invoke `ponytail:ponytail` first (D31).
- Real PHI anywhere in this repo, its tests, logs or AI prompts. v2 stores demo documents only; never weaken the demo-stamp guard.
- Sending Gemini anything except `eob.js:deidentify()` output. If you add a field there, extend the "no PHI" test.
- Letting the AI compute money, buckets, stages or deadlines (D15).
- npm dependencies in the server (D16) or scripts from CDNs (D25).
- Hard-coded rule values in UI code: add a named constant in `eob.js` so the Rules tab shows it (D23).
- `cond && element` with numbers in UI code (BUG-002).

## Next steps

1. Owner picks the execution approach → build v2 following the plan, task by task.
2. Billing team review session using the demo batches (upload 10, then 5).
