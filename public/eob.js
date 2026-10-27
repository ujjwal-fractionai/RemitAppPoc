// eob.js — the POC's brain. Waystar "View EOB" PDF text → claims, checks, buckets, reversal pairs,
// next-payer follow-up, and the de-identified payload for the AI.
// Called by app.js (browser, so PHI stays on the user's machine), eob.test.js and demo tooling (Node).
// Pure: no DOM, no network. Order inside analyze() matters — see docs/FLOW.md §3.
// Money is integer cents everywhere — never float math on amounts.
// The rule constants below are shown read-only on the Rules tab (app.js:renderRules); change them here only.

const AMT = String.raw`-?[\d,]*\.\d\d`;
const R = {
  header: /^\s*(.*?)\s{2,}([A-Z][A-Z #]*):\s+(\S.*?)\s*$/,
  colHeader: /^\s*PROV\s+SERV DATE/,
  claim: /NAME:(.*?)\s+MBR:(\S*)\s+ACNT:(\S*)\s+ICN:(\S*)/,
  claimNo: /^\s*(\d{6,})\s*$/,
  status: /CLM Status:\s*(\d+)/,
  // PROV  FROM(MMDD) TO(MMDDYY)  POS  NOS  PROC  [MODS]  BILLED ALLOWED DEDUCT COINS  [GRP-RC AMT]  PROV PD
  line: new RegExp(String.raw`^\s*(\d{10})\s+(\d{4})\s+(\d{6})\s+(\S+)\s+(\S+)\s+(\S+)\s+(.*?)\s*(${AMT})\s+(${AMT})\s+(${AMT})\s+(${AMT})\s+(?:([A-Z]{2}-\w+)\s+(${AMT})\s+)?(${AMT})\s*$`),
  adj: new RegExp(String.raw`^\s*([A-Z]{2}-\w+)\s+(${AMT})\s*$`),
  rem: /^\s*REM:\s*(.+?)\s*$/,
  ptResp: new RegExp(String.raw`PT RESP\s+(${AMT})`),
  net: new RegExp(String.raw`^\s*NET\s+(${AMT})\s*$`),
  plb: new RegExp(String.raw`^\s*([A-Z0-9]{2})\s+(?:(\S+)\s+)?(${AMT})\s*$`),
};

// ---- Rules. All shown read-only on the "Rules & settings" tab; change them here. ----
export const CONTRACTUAL = new Set(["45"]); // CO-45 alone is a normal write-off, not a denial (spec §4.1)
export const DENY_GROUPS = new Set(["CO", "OA", "PI"]);
export const BENEFIT_MAX = new Set(["119"]); // CARC 119: benefit maximum reached (e.g. auto PIP exhausted) → bill the next payer
// ponytail: PIP spotted by payer name; switch to payer IDs once real auto-payer ERAs arrive
export const PIP_PAYER_WORDS = ["PIP", "AUTO", "AUTOMOBILE", "CASUALTY", "GEICO", "PROGRESSIVE", "ALLSTATE", "STATE FARM", "NATIONWIDE", "USAA", "TRAVELERS", "LIBERTY MUTUAL", "ERIE"];
const PIP_PAYER = new RegExp(`\\b(${PIP_PAYER_WORDS.join("|")})\\b`, "i");
export const DE_PIP_MINIMUM = { perPerson: 1500000, perAccident: 3000000 }; // cents; 21 Del. C. § 2118
// ponytail: one default filing window for every next payer; confirm each plan's timely-filing limit
export const NEXT_PAYER_FILING_DAYS = 90; // counted from the EOB check date
export const DUE_SOON_DAYS = 14;
export const FOLLOW_UP_AFTER_DAYS = 30;
// Demo stamp (POC v2 stores demo documents only): our generator writes both; anything without them is refused.
export const DEMO_MARKER = "REMIT-DEMO-SYNTHETIC"; // PDF Info /Subject
export const DEMO_FOOTER = "SYNTHETIC DEMO DATA - NOT A REAL EOB"; // printed on every page

export const cents = (s) => {
  const [i, f = "0"] = s.replace(/[^\d.]/g, "").split(".");
  return (s.trim().startsWith("-") ? -1 : 1) * (Number(i || 0) * 100 + Number(f.padEnd(2, "0").slice(0, 2)));
};
export const usd = (c) =>
  (c < 0 ? "-$" : "$") + (Math.abs(c) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dollars = (c) => (c / 100).toFixed(2);
export const mdy = (d) => `${String(d.getUTCMonth() + 1).padStart(2, "0")}/${String(d.getUTCDate()).padStart(2, "0")}/${d.getUTCFullYear()}`;
const sum = (xs, f) => xs.reduce((t, x) => t + f(x), 0);

// pdf.js text items → monospace-ish lines (the EOB is a fixed-width printout).
// ponytail: rows grouped by rounded y; add a y-tolerance if a PDF splits a row.
export function pageLines(items) {
  const parts = items.filter((i) => i.str.trim());
  const widths = parts.map((i) => i.width / i.str.length).sort((a, b) => a - b);
  const cw = widths[widths.length >> 1] || 1;
  const rows = new Map();
  for (const i of parts) {
    const y = Math.round(i.transform[5]);
    rows.has(y) ? rows.get(y).push(i) : rows.set(y, [i]);
  }
  return [...rows.keys()]
    .sort((a, b) => b - a)
    .map((y) =>
      rows
        .get(y)
        .sort((a, b) => a.transform[4] - b.transform[4])
        .reduce((s, i) => {
          const col = Math.round(i.transform[4] / cw);
          return (s.length < col ? s.padEnd(col) : s + (s ? " " : "")) + i.str;
        }, ""),
    );
}

// PDF bytes → text rows per page + the Info /Subject. Takes pdf.js as a parameter so it runs the same in the
// browser (app.js, stamp pre-check) and in Node (server.js, authoritative read). pdf.js may detach `bytes`
// (it transfers the buffer to its worker): callers that still need the bytes pass a copy.
export async function readPdf(pdfjs, bytes) {
  const doc = await pdfjs.getDocument({ data: bytes, verbosity: 0 }).promise;
  const pages = [];
  for (let p = 1; p <= doc.numPages; p++) pages.push(pageLines((await (await doc.getPage(p)).getTextContent()).items));
  const { info } = await doc.getMetadata();
  return { pages, subject: info?.Subject ?? "" };
}

// A demo document has our marker AND the footer on every page (stops real EOBs dropped in by accident; spec §6).
export const isDemo = ({ pages, subject }) =>
  subject === DEMO_MARKER && pages.length > 0 && pages.every((p) => p.some((l) => l.trim() === DEMO_FOOTER));

export function parseEob(lines) {
  const r = { payer: "", header: {}, claims: [], plb: [], totals: null, glossary: {} };
  let mode = "header", claim = null, line = null, gCol = 0, gKey = null, m;

  for (const raw of lines) {
    if (!raw.trim() || /^\s*Page \d+\s*$/.test(raw) || raw.trim() === DEMO_FOOTER) continue;

    if (mode === "header") {
      if (R.colHeader.test(raw)) { mode = "claims"; continue; }
      m = raw.match(R.header);
      const left = (m ? m[1] : raw).trim();
      if (left && !r.payer) r.payer = left;
      if (m) r.header[m[2]] = m[3];
      continue;
    }
    if (mode === "glossary") {
      const prefix = raw.slice(0, gCol).trim(), text = raw.slice(gCol).trim();
      if (prefix) r.glossary[(gKey = prefix)] = text;
      else if (gKey) r.glossary[gKey] += " " + text;
      continue;
    }
    if ((m = raw.match(/^(.*GLOSSARY:\s+)/))) { mode = "glossary"; gCol = m[1].length; continue; }
    if (raw.includes("PROVIDER ADJ DETAILS:")) { mode = "plb"; continue; }
    if (mode === "plb") {
      if ((m = raw.match(R.plb))) r.plb.push({ code: m[1], ref: m[2] ?? "", amount: cents(m[3]) });
      continue;
    }
    if (/TOTALS:\s+# OF CLAIMS/.test(raw)) { mode = "totals"; continue; }
    if (mode === "totals") {
      const n = raw.trim().split(/\s+/);
      r.totals = { claims: Number(n[0]), paid: cents(n[6] ?? "0"), check: cents(n[8] ?? "0") };
      mode = "claims";
      continue;
    }

    if ((m = raw.match(R.claim))) {
      claim = { name: m[1].trim(), member: m[2], acnt: m[3], icn: m[4], claimNo: "", status: "", lines: [], ptResp: 0, net: null };
      r.claims.push(claim);
      line = null;
      continue;
    }
    if (!claim) continue;
    if (!claim.claimNo && (m = raw.match(R.claimNo))) { claim.claimNo = m[1]; continue; }
    if ((m = raw.match(R.status))) { claim.status = m[1]; continue; }
    if ((m = raw.match(R.line))) {
      line = {
        npi: m[1], from: m[2], to: m[3], pos: m[4], units: m[5], proc: m[6],
        mods: m[7].trim() ? m[7].trim().split(/\s+/) : [],
        billed: cents(m[8]), allowed: cents(m[9]), deduct: cents(m[10]), coins: cents(m[11]),
        adjs: m[12] ? [{ code: m[12], amount: cents(m[13]) }] : [],
        paid: cents(m[14]), remarks: [],
      };
      claim.lines.push(line);
      continue;
    }
    if (line && (m = raw.match(R.adj))) { line.adjs.push({ code: m[1], amount: cents(m[2]) }); continue; }
    if (line && (m = raw.match(R.rem))) { line.remarks.push(...m[1].split(/\s+/)); continue; }
    if ((m = raw.match(R.ptResp))) { claim.ptResp = cents(m[1]); continue; }
    if ((m = raw.match(R.net))) claim.net = cents(m[1]);
  }
  return r;
}

function bucket(c) {
  if (c.status === "22") return "REVERSED";
  if (c.nextPayerAmount > 0) return "NEXT_PAYER";
  if (c.status === "4") return "DENIED";
  if (c.paid === 0) return c.pr > 0 ? "PATIENT_RESP" : "DENIED";
  if (c.pr > 0 || c.lines.some((l) => l.denied)) return "PARTIAL";
  return "PAID";
}

const denialCodes = (c) => [
  ...new Set(c.lines.flatMap((l) => [...l.adjs.filter((a) => !a.code.startsWith("PR-") && a.code !== "CO-45").map((a) => a.code), ...l.remarks])),
];

function nextAction(c, r) {
  const p = usd(c.pr);
  switch (c.bucket) {
    case "NEXT_PAYER":
      return `${r.pip ? "PIP" : "Benefit"} maximum reached. Bill ${usd(c.nextPayerAmount)} to the patient's health insurance with this EOB attached` +
        (r.followUp ? ` by ${mdy(r.followUp.due)}` : "") + ". Don't appeal to this payer.";
    case "PAID": return c.billed === c.paid ? "No action. Paid in full." : "No action. Paid; only contractual write-off.";
    case "PARTIAL": {
      const d = c.lines.filter((l) => l.denied).length;
      return [c.pr > 0 && `Bill patient ${p}`, d && `Work ${d} denied line(s): ${denialCodes(c).join(", ")}`].filter(Boolean).join(". ") + ".";
    }
    case "PATIENT_RESP":
      return `Bill patient ${p}${sum(c.lines, (l) => l.deduct) > 0 ? " (deductible)" : ""}. Not a denial: don't appeal.`;
    case "DENIED": return `Check ${denialCodes(c).join(", ") || "denial reason"}, then fix and resubmit or appeal.`;
    case "REVERSED":
      return c.pair ? `Reversal, replaced by ${c.pair.label}. Act on the net.` : "Reversal with no correction in this EOB. Watch for reprocessing.";
  }
}

const procKey = (c) => c.lines.map((l) => [l.proc, l.mods.join(" "), l.from, l.to].join("|")).sort().join(";");
const dateKey = (c) => [...new Set(c.lines.map((l) => l.from + l.to))].sort().join(";");

export function analyze(r, today = new Date()) {
  const warnings = [], patients = new Map();
  r.pip = PIP_PAYER.test(r.payer);

  r.claims.forEach((c, i) => {
    c.label = `C${i + 1}`;
    const pk = `${c.member}|${c.name}`;
    if (!patients.has(pk)) patients.set(pk, `Patient ${patients.size + 1}`);
    c.patient = patients.get(pk);
    c.billed = sum(c.lines, (l) => l.billed);
    c.allowed = sum(c.lines, (l) => l.allowed);
    c.paid = c.net ?? sum(c.lines, (l) => l.paid);
    c.pr = sum(c.lines, (l) => l.deduct + l.coins + sum(l.adjs.filter((a) => a.code.startsWith("PR-")), (a) => a.amount));
    c.lines.forEach((l, n) => {
      if (l.billed - l.deduct - l.coins - sum(l.adjs, (a) => a.amount) !== l.paid) warnings.push(`${c.label} line ${n + 1} doesn't balance`);
      l.denied = l.paid === 0 && l.adjs.some((a) => DENY_GROUPS.has(a.code.slice(0, 2)) && !CONTRACTUAL.has(a.code.slice(3)) && !BENEFIT_MAX.has(a.code.slice(3)));
    });
    c.nextPayerAmount = sum(c.lines, (l) => sum(l.adjs.filter((a) => BENEFIT_MAX.has(a.code.slice(3))), (a) => a.amount));
    if (sum(c.lines, (l) => l.paid) !== c.paid) warnings.push(`${c.label}: line payments don't add up to NET`);
    if (c.status !== "22" && c.pr !== c.ptResp) warnings.push(`${c.label}: PT RESP ${usd(c.ptResp)} ≠ patient adjustments ${usd(c.pr)}`);
    c.bucket = bucket(c);
  });

  // Reversal ↔ correction: same account + same procedures/dates + opposite charge; fall back to same dates.
  // (Account alone is ambiguous: one patient's claims all share it.)
  r.pairs = [];
  const free = r.claims.filter((c) => c.status !== "22");
  for (const rev of r.claims.filter((c) => c.status === "22")) {
    const same = free.filter((c) => c.acnt === rev.acnt);
    const match =
      same.find((c) => c.billed === -rev.billed && procKey(c) === procKey(rev)) ?? same.find((c) => dateKey(c) === dateKey(rev));
    if (!match) continue;
    free.splice(free.indexOf(match), 1);
    rev.pair = match;
    match.pair = rev;
    r.pairs.push({ reversal: rev, correction: match, payerNet: match.paid + rev.paid, patientChange: match.pr + rev.pr });
  }
  // Next-payer follow-up: filing deadline counted from this EOB's check date
  const d = (r.header["CHECK DATE"] ?? "").match(/(\d\d)\/(\d\d)\/(\d{4})/);
  if (d && r.claims.some((c) => c.bucket === "NEXT_PAYER")) {
    const due = new Date(Date.UTC(+d[3], +d[1] - 1, +d[2] + NEXT_PAYER_FILING_DAYS));
    const daysLeft = Math.round((due - Date.UTC(today.getFullYear(), today.getMonth(), today.getDate())) / 864e5);
    r.followUp = { due, daysLeft, status: daysLeft < 0 ? "overdue" : daysLeft <= DUE_SOON_DAYS ? "due soon" : "open" };
  }
  r.claims.forEach((c) => (c.action = nextAction(c, r)));

  const paid = sum(r.claims, (c) => c.paid), plb = sum(r.plb, (p) => p.amount);
  r.checkAmount = cents(r.header["CHECK AMT"] ?? "0");
  r.difference = paid - plb - r.checkAmount;
  r.reconciled = r.difference === 0;
  if (!r.header["CHECK AMT"]) warnings.push("Couldn't find CHECK AMT in the header");
  else if (!r.reconciled) warnings.push(`Claim payments minus provider adjustments are ${usd(paid - plb)}, but the check is ${usd(r.checkAmount)}. Confirm with the payer before posting.`);
  if (r.totals && r.totals.claims !== r.claims.length) warnings.push(`EOB says ${r.totals.claims} claims, found ${r.claims.length}`);
  if (r.totals && r.totals.paid !== paid) warnings.push(`EOB PROV PAID ${usd(r.totals.paid)} ≠ sum of claims ${usd(paid)}`);
  r.warnings = warnings;
  return r;
}

// What Gemini sees. HIPAA Safe Harbor: no names, member/account/claim IDs, NPIs or dates.
export function deidentify(r) {
  return {
    payer: r.payer,
    paymentMethod: r.header.EFT ? "EFT" : "Check",
    checkAmount: dollars(r.checkAmount),
    reconciled: r.reconciled,
    reconcileDifference: dollars(r.difference),
    parserWarnings: r.warnings,
    autoPipPayer: r.pip,
    nextPayerFilingStatus: r.followUp?.status ?? null,
    providerAdjustments: r.plb.map((p) => ({ code: p.code, amount: dollars(p.amount), meaning: r.glossary[p.code] ?? "" })),
    claims: r.claims.map((c) => ({
      claim: c.label,
      patient: c.patient,
      claimStatusCode: c.status,
      bucket: c.bucket,
      billed: dollars(c.billed),
      allowed: dollars(c.allowed),
      payerPaid: dollars(c.paid),
      patientResponsibility: dollars(c.pr),
      amountToBillNextPayer: dollars(c.nextPayerAmount),
      pairedWith: c.pair?.label ?? null,
      lines: c.lines.map((l) => ({
        procedure: l.proc, modifiers: l.mods, units: l.units,
        billed: dollars(l.billed), allowed: dollars(l.allowed), paid: dollars(l.paid),
        deductible: dollars(l.deduct), coinsurance: dollars(l.coins),
        adjustments: l.adjs.map((a) => `${a.code} ${dollars(a.amount)}`),
        remarks: l.remarks, denied: l.denied,
      })),
    })),
    reversalPairs: r.pairs.map((p) => ({
      reversal: p.reversal.label, correction: p.correction.label,
      payerNet: dollars(p.payerNet), patientResponsibilityChange: dollars(p.patientChange),
    })),
    codeMeanings: r.glossary,
  };
}

// ---- v2 tracking board: automatic column, "Needs attention" items, dashboard totals ----
// Pure, like everything above. Called by the browser (board, dashboard) on documents re-analysed from stored lines.

export const STAGES = { mismatch: "Doesn't add up", action: "Action needed", ready: "Ready to post", reviewed: "✓ Reviewed" };

// Where a document lands until someone clicks "Mark reviewed" (spec §9, first match wins).
export function autoStage(r) {
  if (!r.reconciled || r.warnings.length) return "mismatch";
  const needsWork = r.claims.some((c) =>
    c.bucket === "DENIED" || c.bucket === "NEXT_PAYER" || (c.bucket === "REVERSED" && !c.pair) ||
    (c.bucket === "PARTIAL" && c.lines.some((l) => l.denied)));
  return needsWork || r.pairs.some((p) => p.patientChange < 0) ? "action" : "ready";
}

// Dashboard sorts items by deadline first, then by this order (spec §10).
export const ATTENTION_ORDER = ["mismatch", "denied", "next_payer", "refund", "unmatched", "denied_line"];

// Everything in one document that a person has to act on, one row each (spec §10 table). Built in ATTENTION_ORDER.
export function attentionItems(r) {
  const items = [];
  const add = (type, c, text, amount, extra) =>
    items.push({ type, claim: c?.label ?? null, patient: c?.patient ?? null, name: c?.name ?? null, text, amount, status: null, due: null, ...extra });

  if (!r.reconciled || r.warnings.length) {
    const d = r.difference;
    add("mismatch", null, r.reconciled ? "The EOB's own numbers don't balance: check before posting."
      : `Check is ${usd(Math.abs(d))} ${d < 0 ? "more" : "less"} than the claims: confirm with the payer before posting.`,
      r.reconciled ? null : Math.abs(d));
  }
  for (const c of r.claims.filter((c) => c.bucket === "DENIED"))
    add("denied", c, `${denialCodes(c).join(", ") || "Denied"} · fix and resubmit or appeal`, c.billed);

  // One next-payer item per patient (PIP is per person), dated by the EOB's follow-up deadline.
  const byPatient = new Map();
  for (const c of r.claims.filter((c) => c.bucket === "NEXT_PAYER")) byPatient.set(c.patient, [...(byPatient.get(c.patient) ?? []), c]);
  for (const cs of byPatient.values())
    add("next_payer", cs[0], `${r.pip ? "PIP exhausted" : "Benefit maximum reached"}: bill health insurance, attach this EOB` +
      (r.followUp ? ` · file by ${mdy(r.followUp.due)}` : ""), sum(cs, (c) => c.nextPayerAmount),
      { status: r.followUp?.status ?? null, due: r.followUp?.due ?? null });

  for (const p of r.pairs.filter((p) => p.patientChange < 0))
    add("refund", p.correction, `Patient balance down ${usd(-p.patientChange)} after reprocessing: adjust or refund if already billed`, -p.patientChange);
  for (const c of r.claims.filter((c) => c.bucket === "REVERSED" && !c.pair))
    add("unmatched", c, "Reversal without a correction in this EOB: watch for reprocessing", null);
  for (const c of r.claims.filter((c) => c.bucket === "PARTIAL" && c.lines.some((l) => l.denied)))
    add("denied_line", c, `Work denied line(s): ${denialCodes(c).join(", ")}`, sum(c.lines.filter((l) => l.denied), (l) => l.billed));
  return items;
}

// Dashboard totals across documents (spec §10a). Reversal claims stay out of the money; their effect shows as items.
export function summarize(list) {
  const t = { documents: list.length, claims: 0, payerPaid: 0, billPatients: 0, denied: 0, nextPayer: 0, writeOff: 0, reviewed: 0, nearestDue: null, denialReasons: [] };
  const reasons = new Map(); // code → { code, text, count }
  for (const { r, stage } of list) {
    if (stage === "reviewed") t.reviewed++;
    else if (r.followUp && (!t.nearestDue || r.followUp.due < t.nearestDue.due)) t.nearestDue = r.followUp;
    t.claims += r.claims.length;
    for (const c of r.claims) {
      if (c.bucket === "REVERSED") continue;
      t.payerPaid += c.paid;
      if (c.pr > 0) t.billPatients += c.pr;
      t.nextPayer += c.nextPayerAmount;
      if (c.bucket === "DENIED") t.denied += c.billed;
      for (const l of c.lines) {
        if (!l.denied) { t.writeOff += sum(l.adjs.filter((a) => a.code.startsWith("CO-")), (a) => a.amount); continue; }
        if (c.bucket !== "DENIED") t.denied += l.billed; // denied line inside a partly paid claim
        for (const a of l.adjs) {
          const reason = a.code.slice(3);
          if (!DENY_GROUPS.has(a.code.slice(0, 2)) || CONTRACTUAL.has(reason) || BENEFIT_MAX.has(reason)) continue;
          const e = reasons.get(a.code) ?? reasons.set(a.code, { code: a.code, text: r.glossary[reason] ?? "", count: 0 }).get(a.code);
          e.count++;
        }
      }
    }
  }
  t.denialReasons = [...reasons.values()].sort((a, b) => b.count - a.count);
  return t;
}
