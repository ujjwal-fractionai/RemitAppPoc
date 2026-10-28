// store.js — the POC server's only door to Supabase: table `documents` (PostgREST) + private bucket `eob-pdfs` (Storage).
// Called by server.js only; the browser never talks to Supabase (CSP connect-src 'self').
// Plain fetch to the REST APIs, no supabase-js. Never logs keys, PDFs or row contents; errors carry status + Supabase's message.
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// Imports are evaluated before server.js runs its own loadEnvFile, so load .env here too (it never overrides real env vars).
const here = fileURLToPath(new URL(".", import.meta.url));
for (const f of [".env", "../.env"]) try { process.loadEnvFile(join(here, f)); } catch {}

const BASE = (process.env.SUPABASE_URL ?? "").replace(/\/+$/, "");
const KEY = process.env.SUPABASE_SECRET_KEY ?? "";
const BUCKET = "eob-pdfs";
export const configured = !!(BASE && KEY);

// New sb_secret_… keys go in `apikey` only; legacy service_role keys are JWTs (eyJ…) and also need Authorization.
const auth = () => ({ apikey: KEY, ...(KEY.startsWith("eyJ") ? { authorization: `Bearer ${KEY}` } : {}) });

async function call(path, { method = "GET", body, headers = {}, raw = false } = {}) {
  if (!configured) throw new Error("Supabase is not configured");
  // Node's fetch reuses pooled connections; when Supabase has already closed one, a POST/DELETE fails with
  // "fetch failed" (Node only auto-retries GETs). Retry once on that network-level error. Safe here: PDF uploads
  // upsert, delete/patch repeat cleanly, and a repeated insert at worst reports "already uploaded".
  let res;
  for (let attempt = 1; ; attempt++) {
    try {
      res = await fetch(BASE + path, { method, body, headers: { ...auth(), ...headers }, signal: AbortSignal.timeout(20_000) });
      break;
    } catch (e) {
      if (attempt > 1 || e.name !== "TypeError") throw e; // TypeError = network failure; timeouts/aborts are not retried
      console.log(`supabase ${method} retry after: ${e.message}`);
    }
  }
  if (!res.ok) {
    const text = await res.text();
    let msg;
    try { const j = JSON.parse(text); msg = j.message ?? j.error; } catch {}
    throw new Error(`Supabase ${res.status}: ${msg || text.slice(0, 200)}`);
  }
  if (raw) return Buffer.from(await res.arrayBuffer());
  return res.status === 204 ? null : res.json();
}
const rest = (query, opts = {}) =>
  call(`/rest/v1/documents${query}`, { ...opts, headers: { "content-type": "application/json", prefer: "return=representation" } });

export const listDocs = () => rest("?select=*&order=uploaded_at.desc");
export const getDoc = async (id) => (await rest(`?select=*&id=eq.${encodeURIComponent(id)}`))[0] ?? null;
export const findBySha = async (sha) => (await rest(`?select=id&sha256=eq.${encodeURIComponent(sha)}`))[0] ?? null;
export const insertDoc = async (row) => (await rest("", { method: "POST", body: JSON.stringify(row) }))[0];
export const updateDoc = async (id, patch) => (await rest(`?id=eq.${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(patch) }))[0];

export const putPdf = (path, bytes) =>
  call(`/storage/v1/object/${BUCKET}/${path}`, { method: "POST", body: bytes, headers: { "content-type": "application/pdf", "x-upsert": "true" } });
export const getPdf = (path) => call(`/storage/v1/object/${BUCKET}/${path}`, { raw: true });

// "Clear demo data": every row, then their PDFs. Returns how many documents were deleted.
export async function deleteAllDocs() {
  const rows = await rest("?id=not.is.null", { method: "DELETE" });
  if (rows.length)
    await call(`/storage/v1/object/${BUCKET}`, { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ prefixes: rows.map((r) => r.pdf_path) }) });
  return rows.length;
}

// Shown on the Rules tab and used to disable uploads. "unreachable" also covers a missing table (schema.sql not run).
export async function ping() {
  if (!configured) return "not configured";
  try { await rest("?select=id&limit=1"); return "ok"; } catch (e) { console.log(`supabase ping failed: ${e.message}`); return "unreachable"; }
}
