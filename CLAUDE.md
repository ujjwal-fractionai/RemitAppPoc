# CLAUDE.md — REMIT POC

Prototype of the ERA Remit Dashboard for Delaware Integrative Healthcare's billing team: upload Waystar EOB PDFs → triaged dashboard + plain-English next steps + Gemini summary.

If this folder sits inside the `RemitApp/` workspace, the workspace `../CLAUDE.md` also applies (project rules, HIPAA rules, glossary) and wins on any conflict.

## Start of every session

1. `docs/HANDOVER.md` — POC state right now.
2. `docs/ARCHITECTURE.md` — folder map and how the pieces fit.
3. The trace for what you're touching: `docs/features/FEAT-*.md`, `docs/bugs/BUG-*.md`, or the spec/plan in `docs/superpowers/`.
4. `docs/FLOW.md` for the call path you'll change; `docs/DECISIONS.md` before changing an approach.

## End of every session

Update `docs/HANDOVER.md`; add `docs/DECISIONS.md` entries (Why / Rejected / Trade-off; numbering shared with the workspace, check both files for the next free D-number); update `docs/FLOW.md` for changed call paths; one trace file per feature/bug (copy `_TEMPLATE.md`; numbers shared with the workspace: check the `features/` and `bugs/` folders in both places for the next free FEAT/BUG number). Commit in this repo.

## Rules (short form — full list in the workspace CLAUDE.md)

- **No real PHI** in code, tests, fixtures, docs, logs, commits or Supabase. Demo data only (`demo/`); never weaken the demo-stamp guard (`eob.js:isDemo`, server re-check).
- **No PHI to AI.** Gemini gets only `public/eob.js:deidentify()` output.
- **No secrets in git.** `.env` stays local; commit `.env.example` only; never zip a folder that contains `.env`.
- **Money in integer cents**; the AI never computes money, buckets, stages or deadlines.
- **Always use Ponytail** (`ponytail:ponytail`) for coding: shortest working change, stdlib before dependencies, zero npm deps in the server, no CDN scripts.
- **Explicit comments:** every file starts with a header (job, who calls it, what it must never do); comment the flow of non-obvious logic.
- **Rules are named constants** at the top of `public/eob.js`, shown on the Rules tab. The billing team's denial playbook + terms are config: `public/denial-playbook.json` (D42).
- **Test first** for logic: `npm test`; demos double as fixtures.
- **Verify before claiming done:** `npm test`; for API changes `bash api.check.sh`; for UI changes the workspace `npm run e2e` and look at the screenshots. ⚠ `store.check.js`, `api.check.sh` and `npm run e2e` delete every document on the shared Supabase board: ask the owner first if a demo board might be set up.
- **Never commit or push** — the owner does all git.
- The browser never talks to Supabase or Gemini; only `server.js` (via `store.js`) does.
- Specs, plans and mockups for POC work go in `docs/superpowers/`.
