// POC server: serves the page and forwards DE-IDENTIFIED claim data to Gemini.
// The PDF is parsed in the browser and never reaches this server. Zero npm dependencies.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
for (const f of [".env", "../.env"]) try { process.loadEnvFile(join(here, f)); } catch {}

const { GEMINI_API_KEY, GEMINI_MODEL = "gemini-2.5-flash", PORT = 3000, HOST = "127.0.0.1" } = process.env;
const PUBLIC = join(here, "public");
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css" };

const PROMPT = `You explain one insurance payment (ERA / EOB) to the billing staff of a chiropractic practice, in plain English.
Input: de-identified JSON. Claims are labelled C1, C2…; patients Patient 1, Patient 2…; amounts are USD.
"bucket" is already computed by rules: PAID, PARTIAL (payer paid part, patient owes the rest), PATIENT_RESP ($0 from payer, all to deductible/copay), NEXT_PAYER (benefit maximum reached, bill the next insurance), DENIED, REVERSED (payer undid an earlier claim).
Rules:
- Use only the numbers given. Never invent amounts; only simple sums of given amounts.
- Refer to claims and patients only by their labels.
- PATIENT_RESP is NOT a denial: the action is to bill the patient, never to appeal.
- A reversal paired with a correction is the payer reprocessing the claim. Explain the net effect, especially patientResponsibilityChange (negative = patient now owes less, so any amount already billed to them should be adjusted or refunded).
- Group CO = contractual write-off (do not bill the patient). Group PR = patient responsibility.
- NEXT_PAYER = benefit maximum reached (code 119 / remark N587). When autoPipPayer is true it means the patient's auto PIP (Personal Injury Protection) is exhausted; Delaware PIP covers at least $15,000 per person / $30,000 per accident. The action is to bill amountToBillNextPayer to the patient's health insurance with this EOB attached as proof of exhaustion. Never suggest appealing to this payer. nextPayerFilingStatus ("open", "due soon", "overdue") is how close the filing deadline is: "due soon" or "overdue" makes it the first High action.
- DENIED claims are never "write off" or "no appeal needed": the action is to review the denial reason codes, then correct and resubmit or appeal.
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
  });
  const j = await res.json();
  if (!res.ok) throw new Error(j.error?.message ?? `Gemini HTTP ${res.status}`);
  return JSON.parse(j.candidates[0].content.parts.map((p) => p.text).join(""));
}

// PHI is on screen in the browser: the page may only load code from and talk to this server,
// so no injected script or third-party resource can send it anywhere else.
const SECURITY = {
  "content-security-policy":
    "default-src 'self'; script-src 'self'; worker-src 'self'; connect-src 'self'; style-src 'self' 'unsafe-inline'; " +
    "img-src 'self' data:; font-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
  "cache-control": "no-store",
};

const send = (res, status, body, type = "application/json") => {
  res.writeHead(status, { "content-type": type, ...SECURITY });
  res.end(body);
};

createServer(async (req, res) => {
  if (req.method === "GET" && req.url === "/api/config") return send(res, 200, JSON.stringify({ model: GEMINI_MODEL, aiEnabled: !!GEMINI_API_KEY }));
  if (req.method === "POST" && req.url === "/api/insights") {
    if (!GEMINI_API_KEY) return send(res, 500, JSON.stringify({ error: "GEMINI_API_KEY is not set in .env" }));
    let body = "";
    for await (const chunk of req) {
      body += chunk;
      if (body.length > 1_000_000) return send(res, 413, JSON.stringify({ error: "Payload too large" }));
    }
    const t = Date.now();
    try {
      const out = await insights(JSON.parse(body));
      console.log(`insights ok in ${Date.now() - t} ms`); // never log payloads
      return send(res, 200, JSON.stringify(out));
    } catch (e) {
      console.log(`insights failed in ${Date.now() - t} ms: ${e.message}`);
      return send(res, 502, JSON.stringify({ error: e.message }));
    }
  }

  let path = normalize(join(PUBLIC, decodeURIComponent(new URL(req.url, "http://x").pathname)));
  if (!path.startsWith(PUBLIC)) return send(res, 404, "Not found", "text/plain");
  if (path.endsWith("/")) path += "index.html";
  try {
    send(res, 200, await readFile(path), TYPES[extname(path)] ?? "application/octet-stream");
  } catch {
    send(res, 404, "Not found", "text/plain");
  }
}).listen(PORT, HOST, () => console.log(`EOB POC on http://${HOST}:${PORT}  (Gemini model: ${GEMINI_MODEL})`));
