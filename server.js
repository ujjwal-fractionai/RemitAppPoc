// server.js — POC server: passcode gate, static files from public/, the v2 document API (demo EOBs stored in
// Supabase via store.js) and a background queue that sends DE-IDENTIFIED claim data (eob.js:deidentify) to Gemini.
// Started by `npm start`. Routes: /login, /logout, /api/config, /api/docs…, everything else = static.
// Stores demo documents only: every upload is re-read here with the bundled pdf.js and refused without the demo
// stamp (eob.js:isDemo). Never logs request bodies, PDFs, row contents or the passcode. Zero npm dependencies.
// Flow: docs/FLOW.md §1 (login), §4 (AI queue), §7 (document routes).
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { analyze, deidentify, isDemo, NOT_DEMO, parseEob, readPdf } from "./public/eob.js";
import { configured, deleteAllDocs, findBySha, getDoc, getPdf, insertDoc, listDocs, ping, putPdf, updateDoc } from "./store.js";

const here = fileURLToPath(new URL(".", import.meta.url));
for (const f of [".env", "../.env"]) try { process.loadEnvFile(join(here, f)); } catch {}

const { GEMINI_API_KEY, GEMINI_MODEL = "gemini-2.5-flash", PORT = 3000, HOST = "127.0.0.1", APP_PASSCODE } = process.env;
if (!APP_PASSCODE && !["127.0.0.1", "localhost", "::1"].includes(HOST)) {
  console.error("Refusing to start: APP_PASSCODE must be set in .env when HOST exposes the app beyond this computer.");
  process.exit(1);
}
const PUBLIC = join(here, "public");
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json" }; // .json: denial-playbook.json (JSON module)

const PROMPT = `You explain one insurance payment (ERA / EOB) to the billing staff of a chiropractic practice, in plain English.
Input: de-identified JSON. Claims are labelled C1, C2…; patients Patient 1, Patient 2…; amounts are USD.
"bucket" is already computed by rules: PAID, PARTIAL (payer paid part, patient owes the rest), PATIENT_RESP ($0 from payer, all to deductible/copay), NEXT_PAYER (benefit maximum reached, bill the next insurance), DENIED, REVERSED (payer undid an earlier claim).
Rules:
- Use only the numbers given. Never invent amounts; only simple sums of given amounts.
- Refer to claims and patients only by their labels.
- Explain a code only with its text in codeMeanings or billingPlaybook. If a code has no meaning there, just name the code; never guess what it means.
- PATIENT_RESP is NOT a denial: the action is to bill the patient, never to appeal.
- A reversal paired with a correction is the payer reprocessing the claim. Explain the net effect, especially patientResponsibilityChange (negative = patient now owes less, so any amount already billed to them should be adjusted or refunded).
- Group CO = contractual write-off (do not bill the patient). Group PR = patient responsibility.
- NEXT_PAYER = benefit maximum reached (code 119). When autoPipPayer is true it means the patient's auto PIP (Personal Injury Protection) is exhausted; Delaware PIP covers at least $15,000 per person / $30,000 per accident. The action is to bill amountToBillNextPayer to the patient's health insurance with this EOB attached as proof of exhaustion. Never suggest appealing to this payer. nextPayerFilingStatus ("open", "due soon", "overdue") is how close the filing deadline is: "due soon" or "overdue" makes it the first High action.
- DENIED claims are never "write off" or "no appeal needed": the action is to review the denial reason codes, then correct and resubmit or appeal.
- billingPlaybook is the practice's own denial playbook for the codes on this EOB. For a denied claim or line, base the action on its resolution and name its reason. If several rows share a code (e.g. CO-16), name them and say to check the EOB and payer notes for which applies.
- Priorities: High = next-payer deadlines due soon/overdue, denials, unreconciled payments/parserWarnings, patient refunds/adjustments from reversals. Medium = bill the patient. Low = routine posting of PAID claims (combine these into one action).
- If reconciled is false or there are parserWarnings, make checking that the first action.
- Be concise and practical. No legal or coding-compliance advice.`;

const SCHEMA = {
  type: "OBJECT",
  properties: {
    summary: { type: "STRING", description: "2-3 sentences: what this payment is and the big picture" },
    actions: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: { priority: { type: "STRING", enum: ["High", "Medium", "Low"] }, text: { type: "STRING" } },
        required: ["priority", "text"],
      },
    },
    reversals: { type: "STRING", description: "Plain-English explanation of reversal pairs; empty if none" },
    watch: { type: "ARRAY", items: { type: "STRING" }, description: "Unusual things worth a second look; may be empty" },
  },
  required: ["summary", "actions", "reversals", "watch"],
};

async function insights(payload) {
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": GEMINI_API_KEY },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: PROMPT }] },
      contents: [{ role: "user", parts: [{ text: JSON.stringify(payload) }] }],
      generationConfig: { temperature: 0.2, responseMimeType: "application/json", responseSchema: SCHEMA },
    }),
    signal: AbortSignal.timeout(45_000),
  });
  const j = await res.json();
  if (!res.ok) throw new Error(j.error?.message ?? `Gemini HTTP ${res.status}`);
  const parts = j.candidates?.[0]?.content?.parts;
  if (!parts) throw new Error("Gemini returned no answer");
  return JSON.parse(parts.map((p) => p.text).join(""));
}

// Same pdf.js the browser uses, run in Node so the server reads every upload itself (spec §6).
const pdfjs = await import("./public/vendor/pdf.min.mjs");
pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(join(here, "public/vendor/pdf.worker.min.mjs")).href;

// ---- Background AI: one Gemini call per document, result stored on its row (ai / ai_status / ai_error) ----
// ponytail: in-memory queue, 2 at a time. A row can't stay "pending" forever: startup and every GET /api/docs re-queue
// pending rows that aren't queued or running (covers restarts and Supabase blips during an update or insert).
const queue = [];
const inflight = new Set(); // queued or running ids: also stops a double-clicked "Try again" from calling Gemini twice
let running = 0;
const enqueue = (id) => { if (inflight.has(id)) return; inflight.add(id); queue.push(id); pump(); };
function pump() {
  while (running < 2 && queue.length) {
    running++;
    const id = queue.shift();
    runAi(id).finally(() => { running--; inflight.delete(id); pump(); });
  }
}
async function runAi(id) {
  const t = Date.now();
  try {
    if (!GEMINI_API_KEY) throw new Error("GEMINI_API_KEY is not set in .env");
    const row = await getDoc(id);
    if (!row) return;
    const ai = await insights(deidentify(analyze(parseEob(row.lines.flat()))));
    await updateDoc(id, { ai: { ...ai, model: GEMINI_MODEL, ms: Date.now() - t }, ai_status: "done", ai_error: null });
    console.log(`ai ${id} done in ${Date.now() - t} ms`);
  } catch (e) {
    const msg = e.name === "TimeoutError" ? "Gemini didn't answer within 45 seconds" : e.message;
    console.log(`ai ${id} failed in ${Date.now() - t} ms: ${msg}`);
    await updateDoc(id, { ai_status: "error", ai_error: msg }).catch(() => {});
  }
}
if (configured) listDocs().then((rows) => rows.filter((r) => r.ai_status === "pending").forEach((r) => enqueue(r.id)))
  .catch((e) => console.log(`startup re-queue skipped: ${e.message}`));

// ---- Document API (behind the passcode gate) ----
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const json = (res, status, body) => send(res, status, JSON.stringify(body));
async function readBody(req, limit) {
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    if ((size += c.length) > limit) return null;
    chunks.push(c);
  }
  return Buffer.concat(chunks);
}

async function docsApi(req, res, path) {
  if (!configured) return json(res, 503, { error: "Supabase is not configured: see supabase/schema.sql and .env" });
  const [, , , id, sub] = path.split("/"); // /api/docs/<id>/<sub>
  if (id && !UUID.test(id)) return json(res, 404, { error: "No such document" });
  const m = req.method;

  if (!id && m === "GET") {
    const rows = await listDocs();
    rows.filter((r) => r.ai_status === "pending").forEach((r) => enqueue(r.id)); // no-op for ids already in flight
    return json(res, 200, rows);
  }
  if (!id && m === "DELETE") return json(res, 200, { deleted: await deleteAllDocs() });
  if (!id && m === "POST") {
    const bytes = await readBody(req, 5 * 1024 * 1024);
    if (!bytes) return json(res, 413, { error: "File too large (5 MB max)" });
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const dup = await findBySha(sha256);
    if (dup) return json(res, 409, { error: "Already uploaded", id: dup.id });
    let read;
    try { read = await readPdf(pdfjs, new Uint8Array(bytes)); } catch { return json(res, 422, { error: "Not a readable PDF" }); } // copy: pdf.js may detach it
    if (!isDemo(read)) return json(res, 422, { error: NOT_DEMO });
    const file_name = decodeURIComponent(req.headers["x-file-name"] ?? "upload.pdf").replace(/[\/ -]/g, "_").slice(0, 200);
    await putPdf(`${sha256}.pdf`, bytes);
    let row;
    try {
      row = await insertDoc({ file_name, sha256, pdf_path: `${sha256}.pdf`, lines: read.pages });
    } catch (e) {
      // Same file uploaded twice at once, or our own insert retried after a dropped connection (it may have landed).
      if (e.message.startsWith("Supabase 409")) return json(res, 409, { error: "Already uploaded", id: (await findBySha(sha256))?.id });
      throw e;
    }
    console.log(`doc ${row.id} stored (${read.pages.length} pages)`);
    enqueue(row.id);
    return json(res, 201, row);
  }
  if (id && !sub && m === "PATCH") {
    const body = await readBody(req, 10_000);
    let stage;
    try { ({ stage } = JSON.parse(body)); } catch { return json(res, 400, { error: "Bad JSON" }); }
    if (stage !== "reviewed" && stage !== null) return json(res, 400, { error: 'stage must be "reviewed" or null' });
    const row = await updateDoc(id, { stage, stage_at: stage ? new Date().toISOString() : null });
    return row ? json(res, 200, row) : json(res, 404, { error: "No such document" });
  }
  if (id && sub === "ai" && m === "POST") {
    const row = await updateDoc(id, { ai_status: "pending", ai_error: null });
    if (!row) return json(res, 404, { error: "No such document" });
    enqueue(id);
    return json(res, 202, row);
  }
  if (id && sub === "pdf" && m === "GET") {
    const row = await getDoc(id);
    if (!row) return json(res, 404, { error: "No such document" });
    const pdf = await getPdf(row.pdf_path);
    // No CSP here: Chrome's built-in PDF viewer breaks under object-src 'none'. A PDF can't run our page's scripts anyway.
    res.writeHead(200, { "content-type": "application/pdf", "content-disposition": `inline; filename="${row.file_name.replace(/[^\w.-]/g, "_")}"`,
      "x-content-type-options": "nosniff", "cache-control": "no-store" });
    return res.end(pdf);
  }
  return json(res, 405, { error: "Not allowed" });
}

// PHI is on screen in the browser: the page may only load code from and talk to this server,
// so no injected script or third-party resource can send it anywhere else.
const SECURITY = {
  "content-security-policy":
    "default-src 'self'; script-src 'self'; worker-src 'self'; connect-src 'self'; style-src 'self' 'unsafe-inline'; " +
    "img-src 'self' data:; font-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
  "cache-control": "no-store",
};

const send = (res, status, body, type = "application/json") => {
  res.writeHead(status, { "content-type": type, ...SECURITY });
  res.end(body);
};

// ---- Passcode gate (APP_PASSCODE in .env): keeps crawlers and strangers off the app and the Gemini budget ----
// ponytail: sessions live in memory (a restart asks for the passcode again); per-IP lockout trusts X-Forwarded-For
const SESSION_HOURS = 12; // automatic logoff
const MAX_FAILS = 5, LOCK_MINUTES = 15;
const sessions = new Map(); // token → expiry ms
const fails = new Map(); // ip → { count, until }
const sha = (s) => createHash("sha256").update(s).digest();
const passcodeOk = (given) => timingSafeEqual(sha(given), sha(APP_PASSCODE));
const ipOf = (req) => (req.headers["x-forwarded-for"] ?? "").split(",")[0].trim() || req.socket.remoteAddress;
const cookieToken = (req) => /(?:^|;\s*)remit_session=([a-f0-9]{64})/.exec(req.headers.cookie ?? "")?.[1];
function authed(req) {
  if (!APP_PASSCODE) return true;
  const t = cookieToken(req), exp = t && sessions.get(t);
  if (exp && exp > Date.now()) return true;
  if (t) sessions.delete(t);
  return false;
}
const redirect = (res, to, cookie) => {
  res.writeHead(303, { location: to, ...SECURITY, ...(cookie ? { "set-cookie": cookie } : {}) });
  res.end();
};
const cookie = (req, value, maxAge) =>
  `remit_session=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}` + (req.headers["x-forwarded-proto"] === "https" ? "; Secure" : "");

const LOGIN_ERRORS = { wrong: "That passcode isn't right. Try again.", locked: `Too many tries. Wait ${LOCK_MINUTES} minutes and try again.`, expired: "Your session ended. Enter the passcode again." };
async function loginPage(res, error) {
  const html = (await readFile(join(here, "login.html"), "utf8")).replace("<!--ERROR-->", error ? `<p class="error" role="alert">${LOGIN_ERRORS[error]}</p>` : "");
  send(res, error === "locked" ? 429 : 200, html, TYPES[".html"]);
}

async function handleLogin(req, res) {
  const ip = ipOf(req), f = fails.get(ip);
  if (f && f.until > Date.now()) return loginPage(res, "locked");
  let body = "";
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 2000) return send(res, 413, "Too large", "text/plain");
  }
  const given = new URLSearchParams(body).get("passcode") ?? "";
  if (!passcodeOk(given)) {
    const now = Date.now();
    const prev = f && now - f.first < LOCK_MINUTES * 60e3 ? f : { count: 0, first: now };
    const count = prev.count + 1;
    if (fails.size > 10_000) fails.clear(); // bound memory if someone sprays fake IPs
    fails.set(ip, { count, first: prev.first, until: count >= MAX_FAILS ? now + LOCK_MINUTES * 60e3 : 0 });
    console.log(`login failed (${count}/${MAX_FAILS})`); // never log the passcode or IP
    await new Promise((r) => setTimeout(r, 500)); // slow down guessing
    return loginPage(res, count >= MAX_FAILS ? "locked" : "wrong");
  }
  fails.delete(ip);
  const token = randomBytes(32).toString("hex");
  sessions.set(token, Date.now() + SESSION_HOURS * 3600e3);
  redirect(res, "/", cookie(req, token, SESSION_HOURS * 3600));
}

createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  if (url.pathname === "/login") {
    if (!APP_PASSCODE) return redirect(res, "/");
    if (req.method === "POST") return handleLogin(req, res);
    return authed(req) ? redirect(res, "/") : loginPage(res, url.searchParams.get("e") === "expired" ? "expired" : null);
  }
  if (url.pathname === "/logout") {
    sessions.delete(cookieToken(req));
    return redirect(res, APP_PASSCODE ? "/login" : "/", cookie(req, "", 0));
  }
  if (!authed(req)) {
    if (req.url.startsWith("/api/")) return send(res, 401, JSON.stringify({ error: "Locked. Reload the page and enter the passcode." }));
    return redirect(res, req.headers.cookie?.includes("remit_session=") ? "/login?e=expired" : "/login");
  }

  if (req.method === "GET" && req.url === "/api/config")
    return send(res, 200, JSON.stringify({ model: GEMINI_MODEL, aiEnabled: !!GEMINI_API_KEY, passcode: !!APP_PASSCODE, sessionHours: SESSION_HOURS, maxFails: MAX_FAILS, lockMinutes: LOCK_MINUTES, supabase: await ping() }));
  if (url.pathname === "/api/docs" || url.pathname.startsWith("/api/docs/")) {
    try {
      return await docsApi(req, res, url.pathname);
    } catch (e) {
      console.log(`${req.method} ${url.pathname} failed: ${e.message}`);
      return json(res, 502, { error: e.message });
    }
  }

  let path;
  try { path = normalize(join(PUBLIC, decodeURIComponent(url.pathname))); } catch { return send(res, 400, "Bad request", "text/plain"); } // e.g. /%E0
  if (!path.startsWith(PUBLIC)) return send(res, 404, "Not found", "text/plain");
  if (path.endsWith("/")) path += "index.html";
  try {
    send(res, 200, await readFile(path), TYPES[extname(path)] ?? "application/octet-stream");
  } catch {
    send(res, 404, "Not found", "text/plain");
  }
}).listen(PORT, HOST, () =>
  console.log(`EOB POC on http://${HOST}:${PORT}  (Gemini model: ${GEMINI_MODEL}, passcode ${APP_PASSCODE ? "on" : "OFF: set APP_PASSCODE in .env"})`));
