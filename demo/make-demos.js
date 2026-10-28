// Synthetic Waystar-style "View EOB" PDFs for demos and tests.
// Fake people, IDs and money only — never put real PHI here.
// Run: node demo/make-demos.js   (rewrites demo/*.pdf, dated relative to today)
// Used by eob.test.js (specs double as fixtures) and, in v2, as the only documents the app will store:
// every PDF carries the demo stamp (Info /Subject + footer on every page), see eob.js DEMO_MARKER / DEMO_FOOTER.
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { DEMO_FOOTER, DEMO_MARKER } from "../public/eob.js";

// Specs below are written as if today were 2026-10-21. demos(base) shifts every printed date by (base − REF),
// so deadlines stay "open / due soon / overdue" whenever the demo is generated.
const REF = Date.UTC(2026, 9, 21);
const p2 = (n) => String(n).padStart(2, "0");
const shiftCheck = (mdy, days) => {
  const [m, d, y] = mdy.split("/").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return `${p2(t.getUTCMonth() + 1)}/${p2(t.getUTCDate())}/${t.getUTCFullYear()}`;
};
// Service dates print as "MMDD MMDDYY" (from has no year: same year as `to`, or the year before if its month is later).
const shiftService = (from, to, days) => {
  const y = 2000 + Number(to.slice(4)), tm = Number(to.slice(0, 2)), fm = Number(from.slice(0, 2));
  const f = new Date(Date.UTC(fm > tm ? y - 1 : y, fm - 1, Number(from.slice(2)) + days));
  const t = new Date(Date.UTC(y, tm - 1, Number(to.slice(2, 4)) + days));
  return `${p2(f.getUTCMonth() + 1)}${p2(f.getUTCDate())} ${p2(t.getUTCMonth() + 1)}${p2(t.getUTCDate())}${String(t.getUTCFullYear()).slice(2)}`;
};

const GROUPS = {
  CO: "Contractual Obligations. The patient may not be billed for this amount",
  PR: "Patient Responsibility",
  OA: "Other Adjustments",
  PI: "Payer Initiated Reductions",
};
const CODES = {
  1: "Deductible Amount",
  2: "Coinsurance Amount",
  3: "Co-payment Amount",
  4: "The procedure code is inconsistent with the modifier used.",
  11: "The diagnosis is inconsistent with the procedure.",
  16: "Claim/service lacks information or has submission/billing error(s).",
  18: "Exact duplicate claim/service.",
  22: "This care may be covered by another payer per coordination of benefits.",
  27: "Expenses incurred after coverage terminated.",
  29: "The time limit for filing has expired.",
  45: "Charge exceeds fee schedule/maximum allowable or contracted/legislated fee arrangement.",
  50: "These are non-covered services because this is not deemed a 'medical necessity' by the payer.",
  96: "Non-covered charge(s).",
  97: "The benefit for this service is included in the payment/allowance for another service/procedure that has already been adjudicated.",
  119: "Benefit maximum for this time period or occurrence has been reached.",
  170: "Payment is denied when performed/billed by this type of provider.",
  197: "Precertification/authorization/notification/pre-treatment absent.",
  242: "Services not provided by network/primary care providers.",
  253: "Sequestration - reduction in federal payment.",
  288: "Referral absent.",
  MA67: "Alert: Correction to a prior claim.",
  MA130: "Your claim contains incomplete and/or invalid information, and no appeal rights are afforded because the claim is unprocessable. Please submit a new claim with the complete/correct information.",
  N130: "Consult plan benefit documents/guidelines for information about restrictions for this service.",
  N587: "Policy benefits have been exhausted.",
  AH: "This is the claim transmission fee.",
  L6: "Interest owed.",
};

const M = "        "; // left margin
const money = (c) => (c / 100).toFixed(2);
const sum = (xs, f) => xs.reduce((t, x) => t + f(x), 0);
const reason = (code) => code.split("-")[1];

// One service line. Adjustments are [code, cents]; PR-1 / PR-2 print in the DEDUCT / COINS columns.
// Paid and allowed are derived so every line balances like a real 835.
const line = (dates, proc, mods, billed, adjs = [], remarks = []) => {
  const [from, to] = dates.split(" ");
  const deduct = sum(adjs.filter(([c]) => c === "PR-1"), ([, a]) => a);
  const coins = sum(adjs.filter(([c]) => c === "PR-2"), ([, a]) => a);
  const other = adjs.filter(([c]) => c !== "PR-1" && c !== "PR-2");
  const notAllowed = sum(adjs.filter(([c]) => !c.startsWith("PR-") || !["1", "2", "3"].includes(reason(c))), ([, a]) => a)
    - sum(adjs.filter(([c]) => c.startsWith("OA-") && reason(c) === "119"), ([, a]) => a); // benefit max reduces payment, not allowed
  return { from, to, proc, mods, billed, allowed: billed - notAllowed, deduct, coins, other, paid: billed - sum(adjs, ([, a]) => a), remarks };
};
const claim = (name, member, acnt, icn, claimNo, status, lines) => ({ name, member, acnt, icn, claimNo, status, lines });

export function eobPages({ payer, payerAddr, payee, ref, checkDate, prodDate, claims, plb = [], checkDelta = 0, shift = 0 }) {
  const paid = sum(claims, (c) => sum(c.lines, (l) => l.paid));
  const check = paid - sum(plb, ([, , a]) => a) + checkDelta;
  const header = [
    [payer, "PAYER CONTACT:", "CLAIMS SUPPORT"],
    [payerAddr[0], "FAX:", "(302)555-0101"],
    [payerAddr[1], "PHONE:", "(302)555-0100"],
    [payee, "EIN:", "999999999"],
    ["1 MAIN ST", "NPI:", "1234567893"],
    ["MIDDLETOWN, DE 19709", `${ref[0]}:`, ref[1]],
    ["", "CHECK DATE:", shiftCheck(checkDate, shift)],
    ["", "CHECK AMT:", money(check)],
    ["", "PRODUCTION DATE:", shiftCheck(prodDate, shift)],
  ].map(([l, k, v]) => `${M}${l.padEnd(62)}${k.padEnd(18)}${v}`);
  header.push(`${M}PROV        SERV DATE    POS NOS  PROC   MODS      BILLED   ALLOWED    DEDUCT     COINS   GRP/RC-AMT     PROV PD`);

  const body = [];
  const codesUsed = new Set();
  for (const c of claims) {
    body.push(`${M}NAME:${c.name.padEnd(24)}MBR:${c.member.padEnd(16)}ACNT:${c.acnt.padEnd(16)}ICN:${c.icn}`);
    body.push(`${M}${" ".repeat(73)}${c.claimNo}`, `${M}CORRECTED: NA  HICN:`, `${M}CLM Status:${c.status.padEnd(4)}MRN:`);
    for (const l of c.lines) {
      const [first, ...rest] = l.other;
      const adj = first ? `${first[0].padEnd(8)}${money(first[1]).padStart(8)}` : " ".repeat(16);
      body.push(`${M}1234567893  ${shiftService(l.from, l.to, shift)}  11  1   ${l.proc.padEnd(6)} ${l.mods.padEnd(6)}` +
        [l.billed, l.allowed, l.deduct, l.coins].map((a) => money(a).padStart(10)).join("") + `   ${adj}${money(l.paid).padStart(12)}`);
      for (const [code, amt] of rest) body.push(`${M}${" ".repeat(87)}${code.padEnd(8)}${money(amt).padStart(8)}`);
      if (l.remarks.length) body.push(`${M}${" ".repeat(40)}REM: ${l.remarks.join(" ")}`);
      [...l.deduct ? ["PR-1"] : [], ...l.coins ? ["PR-2"] : [], ...l.other.map(([code]) => code)].forEach((code) => codesUsed.add(code));
      l.remarks.forEach((r) => codesUsed.add(r));
    }
    const pr = sum(c.lines, (l) => l.deduct + l.coins + sum(l.other.filter(([code]) => code.startsWith("PR-")), ([, a]) => a));
    const tot = (f) => money(sum(c.lines, f)).padStart(10);
    body.push(
      `${M}PT RESP ${money(c.status === "22" ? 0 : pr).padEnd(30)}SUB TOTALS ${tot((l) => l.billed)}${tot((l) => l.allowed)}${tot((l) => l.deduct)}${tot((l) => l.coins)}` +
        `${money(sum(c.lines, (l) => sum(l.other, ([, a]) => a))).padStart(19)}${tot((l) => l.paid)}`,
      `${M}ADJ TO TOTALS:   PREV PD 0.00   INTEREST 0.00   LATE FILING CHARGE 0.00`,
      `${M}${" ".repeat(100)}NET ${money(sum(c.lines, (l) => l.paid))}`,
    );
  }

  const all = claims.flatMap((c) => c.lines);
  body.push(
    `${M}   TOTALS:   # OF CLAIMS  BILLED AMT  ALLOWED AMT  DEDUCT AMT  COINS AMT    RC-AMT  PROV PAID  PROV ADJ  CHECK AMT`,
    `${M}${" ".repeat(18)}` + [String(claims.length).padStart(3), ...[
      sum(all, (l) => l.billed), sum(all, (l) => l.allowed), sum(all, (l) => l.deduct), sum(all, (l) => l.coins),
      sum(all, (l) => sum(l.other, ([, a]) => a)), paid, sum(plb, ([, , a]) => a), check,
    ].map((a) => money(a).padStart(11))].join(" "),
    `${M}PROVIDER ADJ DETAILS:            PLB REASON CODE        FCN / Other Identifier       AMOUNT`,
    ...plb.map(([code, id, amt]) => `${M}${" ".repeat(40)}${code.padEnd(23)}${id.padEnd(25)}${money(amt).padStart(8)}`),
  );
  plb.forEach(([code]) => codesUsed.add(code));

  // Glossary: groups with their reason codes, then remark codes, then PLB codes (descriptions start at a fixed column)
  const wrap = (text) => text.match(/.{1,92}(\s|$)/g).map((s) => s.trim());
  const entry = (key, text) => wrap(text).map((t, i) => `${M}${(i ? "" : key).padEnd(12)}${t}`);
  body.push(`${M}GLOSSARY:   Adjustment, Group, Reason, MOA, and Remark codes`);
  const adjCodes = [...codesUsed].filter((c) => c.includes("-"));
  const listed = new Set();
  for (const g of Object.keys(GROUPS)) {
    const reasons = adjCodes.filter((c) => c.startsWith(g + "-")).map(reason).filter((r) => !listed.has(r));
    if (!adjCodes.some((c) => c.startsWith(g + "-"))) continue;
    body.push(...entry(`${g}-`, GROUPS[g]));
    for (const r of [...new Set(reasons)]) {
      listed.add(r);
      body.push(...wrap(CODES[r]).map((t, i) => `${M}${(i ? "" : r).padStart(11)} ${t}`));
    }
  }
  for (const c of codesUsed) if (!c.includes("-")) body.push(...entry(c, CODES[c]));

  // Paginate like Waystar: header repeated on every page, demo stamp + "Page N" footer
  const pages = [];
  for (let i = 0; i < body.length; i += 52)
    pages.push([...header, ...body.slice(i, i + 52), `${" ".repeat(40)}${DEMO_FOOTER}`, `${" ".repeat(60)}Page ${pages.length + 1}`]);
  return pages;
}

export function pdf(pages) {
  const esc = (s) => s.replace(/[\\()]/g, (m) => "\\" + m);
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>", "", "<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>",
    `<< /Subject (${DEMO_MARKER}) /Producer (REMIT demo generator) >>`, // object 4 = Info dictionary
  ];
  const kids = [];
  for (const lines of pages) {
    const stream = lines.map((l, i) => `BT /F1 7 Tf 1 0 0 1 20 ${770 - i * 11} Tm (${esc(l)}) Tj ET`).join("\n");
    objs.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
    objs.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${objs.length} 0 R >>`);
    kids.push(`${objs.length} 0 R`);
  }
  objs[1] = `<< /Type /Pages /Kids [${kids.join(" ")}] /Count ${pages.length} >>`;
  let out = "%PDF-1.4\n";
  const offsets = objs.map((o, i) => { const at = out.length; out += `${i + 1} 0 obj\n${o}\nendobj\n`; return at; });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => String(o).padStart(10, "0") + " 00000 n \n").join("")}`;
  return out + `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R /Info 4 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
}

const DEMO_PAYEE = "TEST CHIROPRACTIC CLINIC";

// `expect` is checked by eob.test.js, so the demos double as test fixtures.
const SPECS = [
  {
    file: "pip-maximum-reached.pdf",
    payer: "TEST AUTO INSURANCE CO - PIP", payerAddr: ["PO BOX 1000", "WILMINGTON, DE 19801"], payee: DEMO_PAYEE,
    ref: ["EFT", "EFT2000001"], checkDate: "08/04/2026", prodDate: "08/03/2026",
    claims: [
      claim("PARKER, SAM", "PIP0000001", "0000300001", "AUTO000001", "3000000001", "1", [
        line("0601 061526", "98941", "", 7500), line("0601 061526", "97012", "GP", 5500), line("0601 061526", "97110", "GP", 6000),
      ]),
      claim("PARKER, SAM", "PIP0000001", "0000300001", "AUTO000001", "3000000002", "1", [
        line("0701 071526", "98941", "", 7500),
        line("0701 071526", "97110", "GP", 6000, [["OA-119", 3550]], ["N587"]),
        line("0701 071526", "97012", "GP", 5500, [["OA-119", 5500]], ["N587"]),
      ]),
      claim("PARKER, SAM", "PIP0000001", "0000300001", "AUTO000001", "3000000003", "4", [
        line("0720 073126", "98941", "", 7500, [["OA-119", 7500]], ["N587"]),
        line("0720 073126", "97110", "GP", 6000, [["OA-119", 6000]], ["N587"]),
        line("0720 073126", "97012", "GP", 5500, [["OA-119", 5500]], ["N587"]),
      ]),
      claim("NGUYEN, LEE", "PIP0000002", "0000300002", "AUTO000002", "3000000004", "1", [
        line("0715 071526", "98940", "", 6500), line("0715 071526", "97110", "GP", 6000),
      ]),
    ],
    expect: { buckets: ["PAID", "NEXT_PAYER", "NEXT_PAYER", "PAID"], reconciled: true, pairs: 0, pip: true, nextPayer: 28050, stage: "action" },
  },
  {
    file: "denials-paper-check.pdf",
    payer: "TEST HEALTH PLAN OF DELAWARE", payerAddr: ["200 PLAN AVE", "NEWARK, DE 19711"], payee: DEMO_PAYEE,
    ref: ["CHECK #", "0004417"], checkDate: "10/16/2026", prodDate: "10/15/2026",
    claims: [
      claim("BROWN, ALEX", "MEM100001", "0000500001", "GRP500001", "5000000001", "4", [line("0902 090226", "97140", "GP", 6000, [["CO-50", 6000]], ["N130"])]),
      claim("GARCIA, MIA", "MEM100002", "0000500002", "GRP500002", "5000000002", "4", [line("0310 031026", "98941", "", 7500, [["CO-29", 7500]])]),
      claim("KIM, JORDAN", "MEM100003", "0000500003", "GRP500003", "5000000003", "1", [line("0915 091526", "98941", "", 7500, [["CO-16", 7500]], ["MA130"])]),
      claim("PATEL, RIYA", "MEM100004", "0000500004", "GRP500004", "5000000004", "1", [
        line("0918 091826", "98941", "", 7500, [["CO-45", 4180]]),
        line("0918 091826", "97140", "GP", 6000, [["CO-97", 6000]]),
      ]),
      claim("SMITH, CHRIS", "MEM100005", "0000500005", "GRP500005", "5000000005", "4", [line("0922 092226", "97012", "GP", 5500, [["CO-197", 5500]])]),
      claim("BROWN, ALEX", "MEM100001", "0000500001", "GRP500001", "5000000006", "1", [line("0929 092926", "98941", "", 7500, [["CO-45", 4180], ["PR-3", 2000]])]),
    ],
    plb: [["L6", "0004417", -125]],
    expect: { buckets: ["DENIED", "DENIED", "DENIED", "PARTIAL", "DENIED", "PARTIAL"], reconciled: true, pairs: 0, stage: "action" },
  },
  {
    file: "deductible-season.pdf",
    payer: "TEST BLUE PLAN", payerAddr: ["300 BLUE WAY", "DOVER, DE 19901"], payee: DEMO_PAYEE,
    ref: ["EFT", "EFT3000001"], checkDate: "01/23/2026", prodDate: "01/22/2026",
    claims: [
      claim("WRIGHT, TAYLOR", "MEM200001", "0000600001", "GRP600001", "6000000001", "1", [
        line("0105 010526", "98941", "", 7500, [["CO-45", 3476], ["PR-1", 4024]]),
        line("0105 010526", "97012", "GP", 5500, [["CO-45", 4035], ["PR-1", 1465]]),
      ]),
      claim("ADAMS, JO", "MEM200002", "0000600002", "GRP600002", "6000000002", "1", [line("0107 010726", "98941", "", 7500, [["CO-45", 3476], ["PR-1", 2000]])]),
      claim("HALL, CASEY", "MEM200003", "0000600003", "GRP600003", "6000000003", "1", [line("0108 010826", "98941", "", 7500, [["CO-45", 3476], ["PR-2", 805]])]),
      claim("YOUNG, PAT", "MEM200004", "0000600004", "GRP600004", "6000000004", "1", [line("0112 011226", "98940", "", 6500, [["CO-45", 3190], ["PR-1", 3310]])]),
      claim("WRIGHT, TAYLOR", "MEM200001", "0000600005", "GRP600001", "6000000005", "1", [line("0114 011426", "97110", "GP", 6000, [["CO-45", 3488], ["PR-1", 2512]])]),
      claim("LOPEZ, RAY", "MEM200005", "0000600006", "GRP600005", "6000000006", "1", [line("0115 011526", "98941", "", 7500, [["CO-45", 3476]])]),
    ],
    plb: [["AH", "EFT3000001", 384]],
    expect: { buckets: ["PATIENT_RESP", "PARTIAL", "PARTIAL", "PATIENT_RESP", "PATIENT_RESP", "PAID"], reconciled: true, pairs: 0, stage: "ready" },
  },
  {
    file: "reversals-reprocessed.pdf",
    payer: "TEST NATIONAL HEALTH INSURANCE CO", payerAddr: ["400 NATIONAL BLVD", "WILMINGTON, DE 19801"], payee: DEMO_PAYEE,
    ref: ["EFT", "EFT4000001"], checkDate: "10/09/2026", prodDate: "10/08/2026",
    claims: [
      claim("MORGAN, JESSE", "MEM300001", "0000400001", "GRP400001", "4000000101", "22", [
        line("0910 092326", "98941", "", -7500, [["PR-1", -3831], ["PR-242", -3669]]),
      ]),
      claim("MORGAN, JESSE", "MEM300001", "0000400001", "GRP400001", "4000000102", "22", [
        line("0910 092326", "97110", "GP", -6000, [["PR-1", -2026], ["PR-242", -3974]]),
        line("0910 092326", "97110", "GP", -6000, [["PR-1", -2026], ["PR-242", -3974]]),
      ]),
      claim("REED, ALI", "MEM300002", "0000400002", "GRP400002", "4000000103", "22", [
        line("0914 092226", "98940", "", -6500, [["PR-1", -2663], ["PR-242", -3837]]),
      ]),
      claim("MORGAN, JESSE", "MEM300001", "0000400001", "GRP400001", "4000000201", "1", [
        line("0910 092326", "98941", "", 7500, [["CO-45", 4180], ["PR-3", 3000]], ["MA67"]),
      ]),
      claim("MORGAN, JESSE", "MEM300001", "0000400001", "GRP400001", "4000000202", "1", [
        line("0910 092326", "97110", "GP", 6000, [["CO-45", 3488]], ["MA67"]),
        line("0910 092326", "97110", "GP", 6000, [["CO-45", 3488]], ["MA67"]),
      ]),
    ],
    plb: [["AH", "EFT4000001", 384]],
    expect: { buckets: ["REVERSED", "REVERSED", "REVERSED", "PARTIAL", "PAID"], reconciled: true, pairs: 2, stage: "action" },
  },
  {
    file: "needs-review-mismatch.pdf",
    payer: "TEST HEALTH PLAN OF DELAWARE", payerAddr: ["200 PLAN AVE", "NEWARK, DE 19711"], payee: DEMO_PAYEE,
    ref: ["EFT", "EFT5000001"], checkDate: "10/20/2026", prodDate: "10/19/2026", checkDelta: 1000,
    claims: [
      claim("DIAZ, ROBIN", "MEM400001", "0000700001", "GRP700001", "7000000001", "1", [line("1005 100526", "98941", "", 7500, [["CO-45", 4180]])]),
      claim("FOX, SAGE", "MEM400002", "0000700002", "GRP700002", "7000000002", "1", [line("1006 100626", "98940", "", 6500, [["CO-45", 3190], ["PR-3", 2000]])]),
    ],
    expect: { buckets: ["PAID", "PARTIAL"], reconciled: false, pairs: 0, stage: "mismatch" },
  },
];

// ---- 24 demo EOBs for the tracking-board demo: upload batch-1 (10), then batch-2 (5), then batch-3 (5);
//      batch-4 (4) covers the billing team's denial playbook codes the other demos don't use (FEAT-008) ----
const PAYERS = {
  UHC: ["TEST UNITED HEALTH PLAN", ["PO BOX 30555", "SALT LAKE CITY, UT 84130"]],
  BLUE: ["TEST BLUE PLAN", ["300 BLUE WAY", "DOVER, DE 19901"]],
  HPD: ["TEST HEALTH PLAN OF DELAWARE", ["200 PLAN AVE", "NEWARK, DE 19711"]],
  AUTO: ["TEST AUTO INSURANCE CO - PIP", ["PO BOX 1000", "WILMINGTON, DE 19801"]],
  NAT: ["TEST NATIONAL HEALTH INSURANCE CO", ["400 NATIONAL BLVD", "WILMINGTON, DE 19801"]],
  MCR: ["TEST MEDICARE PART B", ["PO BOX 890", "CAMP HILL, PA 17089"]],
};
const day = (daysBeforeRef) => new Date(REF - daysBeforeRef * 864e5);
const mmdd = (d) => `${p2(d.getUTCMonth() + 1)}${p2(d.getUTCDate())}`;
let claimSeq = 8000000000;
// A patient's claims share member/account IDs (so reversal pairing and patient grouping work); claim numbers are unique.
const cl = (name, id, status, lines) => claim(name, `MEM${id}`, `0000${id}`, `GRP${id}`, String(++claimSeq), status, lines);
// One batch document, checked `daysAgo` days before REF. build(svc) gets svc(from, to) = service dates that many days before the check.
function batch(dir, file, payer, ref, daysAgo, build, expect, extra = {}) {
  const svc = (from, to = from) => `${mmdd(day(daysAgo + from))} ${mmdd(day(daysAgo + to))}${String(day(daysAgo + to).getUTCFullYear()).slice(2)}`;
  return { dir, file, payer: PAYERS[payer][0], payerAddr: PAYERS[payer][1], payee: DEMO_PAYEE, ref,
    checkDate: shiftCheck("10/21/2026", -daysAgo), prodDate: shiftCheck("10/21/2026", -daysAgo - 1), claims: build(svc), expect, ...extra };
}
const EFT = (n) => ["EFT", `EFT90${n}`];
const PAID = (n) => Array(n).fill("PAID");

SPECS.push(
  // ---- batch-1: lands as Doesn't add up 1 · Action needed 4 · Ready to post 5 ----
  batch("batch-1", "b1-01-clean-all-paid.pdf", "UHC", EFT(1001), 6, (svc) => [
    cl("GREEN, AVERY", "81001", "1", [line(svc(20), "98941", "", 7500, [["CO-45", 3476]])]),
    cl("BELL, CAMERON", "81002", "1", [line(svc(18), "98940", "", 6500, [["CO-45", 3190]]), line(svc(18), "97110", "GP", 6000, [["CO-45", 3488]])]),
    cl("PRICE, DREW", "81003", "1", [line(svc(15), "97012", "GP", 5500, [["CO-45", 4035]])]),
    cl("COLE, EMERSON", "81004", "1", [line(svc(12), "98941", "", 7500, [["CO-45", 3476]])]),
  ], { buckets: PAID(4), reconciled: true, pairs: 0, stage: "ready" }),
  batch("batch-1", "b1-02-deductible-january.pdf", "BLUE", EFT(1002), 8, (svc) => [
    cl("HAYES, FINLEY", "81011", "1", [line(svc(16), "98941", "", 7500, [["CO-45", 3476], ["PR-1", 4024]])]),
    cl("REID, GRAY", "81012", "1", [line(svc(15), "98940", "", 6500, [["CO-45", 3190], ["PR-1", 3310]])]),
    cl("SHAW, HARPER", "81013", "1", [line(svc(14), "97110", "GP", 6000, [["CO-45", 3488], ["PR-1", 2512]])]),
    cl("WEST, INDIGO", "81014", "1", [line(svc(12), "98941", "", 7500, [["CO-45", 3476], ["PR-1", 2000]])]),
    cl("FORD, JALEN", "81015", "1", [line(svc(10), "98940", "", 6500, [["CO-45", 3190], ["PR-1", 1500]])]),
  ], { buckets: ["PATIENT_RESP", "PATIENT_RESP", "PATIENT_RESP", "PARTIAL", "PARTIAL"], reconciled: true, pairs: 0, stage: "ready" }),
  batch("batch-1", "b1-03-copays.pdf", "HPD", EFT(1003), 5, (svc) => [
    cl("KING, KAI", "81021", "1", [line(svc(14), "98941", "", 7500, [["CO-45", 4180], ["PR-3", 3000]])]),
    cl("LANE, LOGAN", "81022", "1", [line(svc(13), "98940", "", 6500, [["CO-45", 3190], ["PR-3", 2500]])]),
    cl("MOSS, MARLOW", "81023", "1", [line(svc(12), "97110", "GP", 6000, [["CO-45", 3488], ["PR-3", 2000]])]),
    cl("NASH, NOVA", "81024", "1", [line(svc(11), "98941", "", 7500, [["CO-45", 3476], ["PR-3", 2000]])]),
    cl("OWEN, OAKLEY", "81025", "1", [line(svc(9), "97012", "GP", 5500, [["CO-45", 3000], ["PR-3", 1500]])]),
  ], { buckets: Array(5).fill("PARTIAL"), reconciled: true, pairs: 0, stage: "ready" }),
  batch("batch-1", "b1-04-denials-medical-necessity.pdf", "HPD", EFT(1004), 4, (svc) => [
    cl("PARK, QUINN", "81031", "4", [line(svc(20), "97140", "GP", 6000, [["CO-50", 6000]], ["N130"])]),
    cl("ROSS, RILEY", "81032", "4", [line(svc(18), "98941", "", 7500, [["CO-50", 7500]])]),
    cl("STONE, SAWYER", "81033", "4", [line(svc(16), "97012", "GP", 5500, [["CO-197", 5500]])]),
    cl("TATE, TATUM", "81034", "1", [line(svc(14), "98941", "", 7500, [["CO-45", 3476]])]),
    cl("VALE, UMA", "81035", "1", [line(svc(12), "98940", "", 6500, [["CO-45", 3190]])]),
  ], { buckets: ["DENIED", "DENIED", "DENIED", "PAID", "PAID"], reconciled: true, pairs: 0, stage: "action" }),
  batch("batch-1", "b1-05-pip-due-soon.pdf", "AUTO", EFT(1005), 80, (svc) => [
    cl("QUINN, VIOLET", "81041", "1", [line(svc(60, 46), "98941", "", 7500), line(svc(60, 46), "97110", "GP", 6000)]),
    cl("QUINN, VIOLET", "81041", "1", [
      line(svc(40, 26), "98941", "", 7500),
      line(svc(40, 26), "97012", "GP", 5500, [["OA-119", 2500]], ["N587"]),
    ]),
    cl("QUINN, VIOLET", "81041", "4", [
      line(svc(20, 6), "98941", "", 7500, [["OA-119", 7500]], ["N587"]),
      line(svc(20, 6), "97110", "GP", 6000, [["OA-119", 6000]], ["N587"]),
    ]),
  ], { buckets: ["PAID", "NEXT_PAYER", "NEXT_PAYER"], reconciled: true, pairs: 0, pip: true, nextPayer: 16000, stage: "action" }),
  batch("batch-1", "b1-06-reversal-refund.pdf", "NAT", EFT(1006), 7, (svc) => [
    cl("WOLFE, WREN", "81051", "22", [line(svc(30, 17), "98941", "", -7500, [["PR-1", -3831], ["PR-242", -3669]])]),
    cl("WOLFE, WREN", "81051", "22", [line(svc(30, 17), "97110", "GP", -6000, [["PR-1", -2026], ["PR-242", -3974]])]),
    cl("WOLFE, WREN", "81051", "1", [line(svc(30, 17), "98941", "", 7500, [["CO-45", 4180], ["PR-3", 3000]], ["MA67"])]),
    cl("WOLFE, WREN", "81051", "1", [line(svc(30, 17), "97110", "GP", 6000, [["CO-45", 3488]], ["MA67"])]),
  ], { buckets: ["REVERSED", "REVERSED", "PARTIAL", "PAID"], reconciled: true, pairs: 2, stage: "action" }, { plb: [["AH", "EFT901006", 384]] }),
  batch("batch-1", "b1-07-medicare-sequestration.pdf", "MCR", EFT(1007), 9, (svc) => [
    cl("ADLER, BLAIR", "81061", "1", [line(svc(20), "98941", "", 7500, [["CO-45", 3476], ["PR-2", 805], ["CO-253", 64]])]),
    cl("BRANDT, CASEY", "81062", "1", [line(svc(18), "98940", "", 6500, [["CO-45", 3190], ["PR-2", 662], ["CO-253", 53]])]),
    cl("CRUZ, DALE", "81063", "1", [line(svc(16), "97110", "GP", 6000, [["CO-45", 3488], ["PR-2", 502], ["CO-253", 40]])]),
    cl("DUNN, ELLIS", "81064", "1", [line(svc(14), "97012", "GP", 5500, [["CO-45", 3000], ["PR-2", 500], ["CO-253", 40]])]),
  ], { buckets: Array(4).fill("PARTIAL"), reconciled: true, pairs: 0, stage: "ready" }),
  batch("batch-1", "b1-08-coinsurance.pdf", "BLUE", EFT(1008), 3, (svc) => [
    cl("EVANS, FARRAH", "81071", "1", [line(svc(15), "98941", "", 7500, [["CO-45", 3476], ["PR-2", 805]])]),
    cl("FINCH, GALE", "81072", "1", [line(svc(14), "98940", "", 6500, [["CO-45", 3190], ["PR-2", 662]])]),
    cl("GRANT, HOLLIS", "81073", "1", [line(svc(12), "97110", "GP", 6000, [["CO-45", 3488], ["PR-2", 502]])]),
    cl("HART, IVY", "81074", "1", [line(svc(10), "97012", "GP", 5500, [["CO-45", 3000], ["PR-2", 500]])]),
  ], { buckets: Array(4).fill("PARTIAL"), reconciled: true, pairs: 0, stage: "ready" }),
  batch("batch-1", "b1-09-check-mismatch.pdf", "HPD", EFT(1009), 2, (svc) => [
    cl("IRWIN, JUDE", "81081", "1", [line(svc(12), "98941", "", 7500, [["CO-45", 4180]])]),
    cl("JONES, KIT", "81082", "1", [line(svc(10), "98940", "", 6500, [["CO-45", 3190], ["PR-3", 2000]])]),
  ], { buckets: ["PAID", "PARTIAL"], reconciled: false, pairs: 0, stage: "mismatch" }, { checkDelta: 1000 }),
  batch("batch-1", "b1-10-paper-check-bundled.pdf", "UHC", ["CHECK #", "0007788"], 10, (svc) => [
    cl("KERR, LANE", "81091", "1", [line(svc(20), "98941", "", 7500, [["CO-45", 3476]]), line(svc(20), "97140", "GP", 6000, [["CO-97", 6000]])]),
    cl("LOWE, MAX", "81092", "1", [line(svc(18), "98940", "", 6500, [["CO-45", 3190]])]),
    cl("MARSH, NIA", "81093", "1", [line(svc(15), "97110", "GP", 6000, [["CO-45", 3488], ["PR-3", 2000]])]),
  ], { buckets: ["PARTIAL", "PAID", "PARTIAL"], reconciled: true, pairs: 0, stage: "action" }, { plb: [["L6", "0007788", -125]] }),

  // ---- batch-2: a second PIP, a big timely-filing denial, a two-page EOB, an unmatched reversal ----
  batch("batch-2", "b2-01-pip-open.pdf", "AUTO", EFT(2001), 20, (svc) => [
    cl("NOBLE, ORION", "82001", "4", [
      line(svc(30, 16), "98941", "", 7500, [["OA-119", 7500]], ["N587"]),
      line(svc(30, 16), "97012", "GP", 5500, [["OA-119", 5500]], ["N587"]),
    ]),
    cl("NOBLE, ORION", "82001", "1", [line(svc(14, 4), "97110", "GP", 6000, [["OA-119", 6000]], ["N587"])]),
  ], { buckets: ["NEXT_PAYER", "NEXT_PAYER"], reconciled: true, pairs: 0, pip: true, nextPayer: 19000, stage: "action" }),
  batch("batch-2", "b2-02-timely-filing-denials.pdf", "UHC", EFT(2002), 6, (svc) => [
    cl("OLSEN, PAIGE", "82011", "4", [line(svc(220), "98941", "", 7500, [["CO-29", 7500]]), line(svc(220), "97110", "GP", 6000, [["CO-29", 6000]])]),
    cl("PACE, REESE", "82012", "4", [
      line(svc(210), "98940", "", 6500, [["CO-29", 6500]]), line(svc(210), "97012", "GP", 5500, [["CO-29", 5500]]),
      line(svc(210), "97140", "GP", 6000, [["CO-29", 6000]]),
    ]),
    cl("RAMOS, SKYE", "82013", "4", [line(svc(200), "98941", "", 7500, [["CO-29", 7500]])]),
    cl("SALAS, TROY", "82014", "1", [line(svc(12), "98941", "", 7500, [["CO-45", 3476]])]),
  ], { buckets: ["DENIED", "DENIED", "DENIED", "PAID"], reconciled: true, pairs: 0, stage: "action" }),
  batch("batch-2", "b2-03-clean-two-pages.pdf", "BLUE", EFT(2003), 4, (svc) =>
    ["ABBOTT, ARI", "BAKER, BLAKE", "CARTER, CRUZ", "DIXON, DANA", "ELLIS, EDEN", "FOSTER, FLYNN",
     "GIBBS, GRAY", "HOLT, HAYDEN", "IVES, ISLA", "JAMES, JORDAN", "KNOX, KENDALL", "LYONS, LEE"]
      .map((n, i) => cl(n, String(82021 + i), "1", [line(svc(20 - i), "98941", "", 7500, [["CO-45", 3476]])])),
  { buckets: PAID(12), reconciled: true, pairs: 0, stage: "ready" }),
  batch("batch-2", "b2-04-unmatched-reversal.pdf", "NAT", EFT(2004), 5, (svc) => [
    cl("PIERCE, ROWAN", "82041", "22", [line(svc(40, 33), "98940", "", -6500, [["PR-1", -2663], ["PR-242", -3837]])]),
    cl("QUINLAN, SAGE", "82042", "1", [line(svc(14), "98941", "", 7500, [["CO-45", 4180]])]),
    cl("RHODES, TAYLOR", "82043", "1", [line(svc(12), "97110", "GP", 6000, [["CO-45", 3488]])]),
  ], { buckets: ["REVERSED", "PAID", "PAID"], reconciled: true, pairs: 0, stage: "action" }),
  batch("batch-2", "b2-05-deductible-and-copay.pdf", "HPD", EFT(2005), 3, (svc) => [
    cl("SIMS, UMA", "82051", "1", [line(svc(15), "98941", "", 7500, [["CO-45", 3476], ["PR-1", 4024]])]),
    cl("TOWNS, VAL", "82052", "1", [line(svc(13), "98940", "", 6500, [["CO-45", 3190], ["PR-3", 2500]])]),
    cl("UPTON, WES", "82053", "1", [line(svc(11), "97110", "GP", 6000, [["CO-45", 3488], ["PR-1", 1000], ["PR-3", 1500]])]),
  ], { buckets: ["PATIENT_RESP", "PARTIAL", "PARTIAL"], reconciled: true, pairs: 0, stage: "ready" }),

  // ---- batch-3: an overdue PIP, missing-info denials, a reversal where the patient owes more ----
  batch("batch-3", "b3-01-pip-overdue.pdf", "AUTO", EFT(3001), 100, (svc) => [
    cl("VANCE, XAN", "83001", "1", [line(svc(40, 26), "98941", "", 7500)]),
    cl("VANCE, XAN", "83001", "4", [line(svc(20, 6), "98941", "", 7500, [["OA-119", 7500]], ["N587"])]),
  ], { buckets: ["PAID", "NEXT_PAYER"], reconciled: true, pairs: 0, pip: true, nextPayer: 7500, stage: "action" }),
  batch("batch-3", "b3-02-missing-info.pdf", "BLUE", EFT(3002), 5, (svc) => [
    cl("WARD, YALE", "83011", "1", [line(svc(15), "98941", "", 7500, [["CO-16", 7500]], ["MA130"])]),
    cl("YATES, ZION", "83012", "1", [line(svc(14), "98940", "", 6500, [["CO-16", 6500]], ["MA130"])]),
    cl("ZANE, AMARI", "83013", "1", [line(svc(12), "97110", "GP", 6000, [["CO-45", 3488]])]),
  ], { buckets: ["DENIED", "DENIED", "PAID"], reconciled: true, pairs: 0, stage: "action" }),
  batch("batch-3", "b3-03-clean.pdf", "MCR", EFT(3003), 4, (svc) => [
    cl("ARCHER, BEAU", "83021", "1", [line(svc(16), "98941", "", 7500, [["CO-45", 3476], ["CO-253", 80]])]),
    cl("BOYD, CLEO", "83022", "1", [line(svc(14), "98940", "", 6500, [["CO-45", 3190], ["CO-253", 66]])]),
    cl("CROSS, DEV", "83023", "1", [line(svc(12), "97012", "GP", 5500, [["CO-45", 3000], ["CO-253", 50]])]),
  ], { buckets: PAID(3), reconciled: true, pairs: 0, stage: "ready" }),
  batch("batch-3", "b3-04-reversal-balance-up.pdf", "NAT", EFT(3004), 6, (svc) => [
    cl("BRIGGS, CORA", "83031", "22", [line(svc(25, 18), "98941", "", -7500, [["CO-45", -3476], ["PR-3", -1000]])]),
    cl("BRIGGS, CORA", "83031", "1", [line(svc(25, 18), "98941", "", 7500, [["CO-45", 3476], ["PR-1", 2000], ["PR-3", 1000]], ["MA67"])]),
    cl("CHASE, DREW", "83032", "1", [line(svc(12), "98940", "", 6500, [["CO-45", 3190]])]),
  ], { buckets: ["REVERSED", "PARTIAL", "PAID"], reconciled: true, pairs: 1, stage: "ready" }),
  batch("batch-3", "b3-05-fees-and-paid.pdf", "UHC", EFT(3005), 3, (svc) => [
    cl("DUKE, EZRA", "83041", "1", [line(svc(14), "98941", "", 7500, [["CO-45", 3476]])]),
    cl("ESTES, FAYE", "83042", "1", [line(svc(12), "98940", "", 6500, [["CO-45", 3190]])]),
    cl("FROST, GIO", "83043", "1", [line(svc(10), "97012", "GP", 5500, [["CO-45", 4035]])]),
  ], { buckets: PAID(3), reconciled: true, pairs: 0, stage: "ready" }, { plb: [["AH", "EFT903005", 384]] }),

  // ---- batch-4: one denial of each playbook reason not shown elsewhere ----
  batch("batch-4", "b4-01-eligibility-and-cob.pdf", "HPD", EFT(4001), 4, (svc) => [
    cl("ABEL, ANSEL", "84001", "4", [line(svc(15), "98941", "", 7500, [["CO-27", 7500]])]),
    cl("BIRCH, BELLAMY", "84002", "4", [line(svc(12), "98940", "", 6500, [["CO-22", 6500]])]),
    cl("CAIN, CORIN", "84003", "1", [line(svc(10), "97110", "GP", 6000, [["CO-45", 3488]])]),
  ], { buckets: ["DENIED", "DENIED", "PAID"], reconciled: true, pairs: 0, stage: "action" }),
  batch("batch-4", "b4-02-duplicate-and-referral.pdf", "BLUE", EFT(4002), 5, (svc) => [
    cl("DALE, DORIAN", "84011", "4", [line(svc(14), "98941", "", 7500, [["CO-18", 7500]])]),
    cl("EAMES, ELLERY", "84012", "4", [line(svc(13), "97012", "GP", 5500, [["CO-288", 5500]])]),
    cl("FAIR, FINN", "84013", "1", [line(svc(11), "98940", "", 6500, [["CO-45", 3190], ["PR-3", 2000]])]),
  ], { buckets: ["DENIED", "DENIED", "PARTIAL"], reconciled: true, pairs: 0, stage: "action" }),
  batch("batch-4", "b4-03-coding-errors.pdf", "UHC", EFT(4003), 3, (svc) => [
    cl("GALE, GRIER", "84021", "1", [line(svc(16), "98941", "", 7500, [["CO-45", 3476]]), line(svc(16), "97140", "GP", 6000, [["CO-4", 6000]])]),
    cl("HUNT, HALE", "84022", "4", [line(svc(14), "98941", "", 7500, [["CO-11", 7500]])]),
    cl("JAY, JUNO", "84023", "1", [line(svc(12), "98940", "", 6500, [["CO-45", 3190]])]),
  ], { buckets: ["PARTIAL", "DENIED", "PAID"], reconciled: true, pairs: 0, stage: "action" }),
  batch("batch-4", "b4-04-noncovered-out-of-network.pdf", "NAT", EFT(4004), 6, (svc) => [
    cl("KANE, KIRBY", "84031", "4", [line(svc(15), "97012", "GP", 5500, [["CO-96", 5500]], ["N130"])]),
    cl("LARK, LENNON", "84032", "4", [line(svc(13), "98941", "", 7500, [["CO-170", 7500]])]),
    cl("MAYS, MILO", "84033", "1", [line(svc(11), "98940", "", 6500, [["CO-45", 3190]])]),
  ], { buckets: ["DENIED", "DENIED", "PAID"], reconciled: true, pairs: 0, stage: "action" }),
);

// All demo specs with their dates moved to `base` (a Date; tests pin it, the CLI uses today).
export function demos(base) {
  const shift = Math.round((Date.UTC(base.getFullYear(), base.getMonth(), base.getDate()) - REF) / 864e5);
  return SPECS.map((s) => ({ ...s, shift }));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dir = fileURLToPath(new URL(".", import.meta.url));
  for (const d of demos(new Date())) {
    const path = d.dir ? `${d.dir}/${d.file}` : d.file;
    mkdirSync(dir + (d.dir ?? ""), { recursive: true });
    writeFileSync(dir + path, pdf(eobPages(d)), "latin1");
    console.log("wrote demo/" + path);
  }
}
