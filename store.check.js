// store.check.js — integration check for store.js against the real Supabase project (needs POC/.env).
// Not part of `npm test` (network). Run: node store.check.js  → prints STORE OK. Leaves no rows behind.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { deleteAllDocs, findBySha, getPdf, insertDoc, ping, putPdf, updateDoc } from "./store.js";

assert.equal(await ping(), "ok", "Supabase not reachable: check POC/.env and that supabase/schema.sql was run");
const sha = randomBytes(32).toString("hex"), path = `${sha}.pdf`, bytes = Buffer.from("%PDF-check");
await putPdf(path, bytes);
assert.deepEqual(await getPdf(path), bytes);
const row = await insertDoc({ file_name: "check.pdf", sha256: sha, pdf_path: path, lines: [["x"]] });
assert.equal((await findBySha(sha)).id, row.id);
assert.equal((await updateDoc(row.id, { stage: "reviewed" })).stage, "reviewed");
assert.ok((await deleteAllDocs()) >= 1);
assert.equal(await findBySha(sha), null);
console.log("STORE OK");
