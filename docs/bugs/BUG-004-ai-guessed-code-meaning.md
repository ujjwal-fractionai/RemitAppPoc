# BUG-004 — Gemini invented the meaning of CO-50

**Status:** Fixed · **Severity:** Medium · **Found:** 2026-10-22

## Symptom
"Claim C3 was denied with reason CO-50 (non-covered service/routine exam)". CO-50 actually means not medically necessary.

## Root cause
That demo's glossary didn't define code 50, so the model guessed.

## Fix
PROMPT rule: explain a code only with its text in `codeMeanings`; otherwise just name the code. Real Waystar EOBs include a glossary, so impact was mainly on the test fixture.

## Verification
Re-run on synthetic-eob: "review the denial reason (CO-50) and appeal or correct and resubmit".
