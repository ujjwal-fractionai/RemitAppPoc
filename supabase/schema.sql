-- REMIT POC v2 — run once in the Supabase SQL Editor (Project → SQL Editor → New query → paste → Run).
-- Demo documents only (the server refuses anything without the demo stamp). Spec §8.
create table if not exists documents (
  id          uuid primary key default gen_random_uuid(),
  file_name   text not null,
  sha256      text not null unique,
  pdf_path    text not null,
  lines       jsonb not null,          -- text rows per page, re-parsed in the browser on every load
  stage       text check (stage = 'reviewed' or stage is null),  -- null = automatic column
  stage_at    timestamptz,
  ai          jsonb,                   -- Gemini result {summary, actions, reversals, watch, model, ms}
  ai_error    text,
  ai_status   text not null default 'pending' check (ai_status in ('pending','done','error')),
  uploaded_at timestamptz not null default now()
);
-- Row level security on with no policies: only the server's secret key can read or write. The browser never talks to Supabase.
alter table documents enable row level security;
-- Private bucket for the PDFs.
insert into storage.buckets (id, name, public) values ('eob-pdfs', 'eob-pdfs', false) on conflict do nothing;
