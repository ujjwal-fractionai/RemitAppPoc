// Synthetic Waystar-style "View EOB" PDFs for demos and tests.
// Fake people, IDs and money only — never put real PHI here.
// Run: node demo/make-demos.js   (rewrites demo/*.pdf)
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

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
  16: "Claim/service lacks information or has submission/billing error(s).",
  29: "The time limit for filing has expired.",
  45: "Charge exceeds fee schedule/maximum allowable or contracted/legislated fee arrangement.",
  50: "These are non-covered services because this is not deemed a 'medical necessity' by the payer.",
  97: "The benefit for this service is included in the payment/allowance for another service/procedure that has already been adjudicated.",
  119: "Benefit maximum for this time period or occurrence has been reached.",
  197: "Precertification/authorization/notification/pre-treatment absent.",
  242: "Services not provided by network/primary care providers.",
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

export function eobPages({ payer, payerAddr, payee, ref, checkDate, prodDate, claims, plb = [], checkDelta = 0 }) {
  const paid = sum(claims, (c) => sum(c.lines, (l) => l.paid));
  const check = paid - sum(plb, ([, , a]) => a) + checkDelta;
  const header = [
    [payer, "PAYER CONTACT:", "CLAIMS SUPPORT"],
    [payerAddr[0], "FAX:", "(302)555-0101"],
    [payerAddr[1], "PHONE:", "(302)555-0100"],
    [payee, "EIN:", "999999999"],
    ["1 MAIN ST", "NPI:", "1234567893"],
    ["MIDDLETOWN, DE 19709", `${ref[0]}:`, ref[1]],
    ["", "CHECK DATE:", checkDate],
    ["", "CHECK AMT:", money(check)],
    ["", "PRODUCTION DATE:", prodDate],
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
      body.push(`${M}1234567893  ${l.from} ${l.to}  11  1   ${l.proc.padEnd(6)} ${l.mods.padEnd(6)}` +
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

  // Paginate like Waystar: header repeated on every page, "Page N" footer
  const pages = [];
  for (let i = 0; i < body.length; i += 52) pages.push([...header, ...body.slice(i, i + 52), `${" ".repeat(60)}Page ${pages.length + 1}`]);
  return pages;
}

function pdf(pages) {
  const esc = (s) => s.replace(/[\\()]/g, (m) => "\\" + m);
  const objs = ["<< /Type /Catalog /Pages 2 0 R >>", "", "<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>"];
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
  return out + `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
}

const DEMO_PAYEE = "TEST CHIROPRACTIC CLINIC";

// `expect` is checked by eob.test.js, so the demos double as test fixtures.
export const DEMOS = [
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
    expect: { buckets: ["PAID", "NEXT_PAYER", "NEXT_PAYER", "PAID"], reconciled: true, pairs: 0, pip: true, nextPayer: 28050 },
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
    expect: { buckets: ["DENIED", "DENIED", "DENIED", "PARTIAL", "DENIED", "PARTIAL"], reconciled: true, pairs: 0 },
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
    expect: { buckets: ["PATIENT_RESP", "PARTIAL", "PARTIAL", "PATIENT_RESP", "PATIENT_RESP", "PAID"], reconciled: true, pairs: 0 },
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
    expect: { buckets: ["REVERSED", "REVERSED", "REVERSED", "PARTIAL", "PAID"], reconciled: true, pairs: 2 },
  },
  {
    file: "needs-review-mismatch.pdf",
    payer: "TEST HEALTH PLAN OF DELAWARE", payerAddr: ["200 PLAN AVE", "NEWARK, DE 19711"], payee: DEMO_PAYEE,
    ref: ["EFT", "EFT5000001"], checkDate: "10/20/2026", prodDate: "10/19/2026", checkDelta: 1000,
    claims: [
      claim("DIAZ, ROBIN", "MEM400001", "0000700001", "GRP700001", "7000000001", "1", [line("1005 100526", "98941", "", 7500, [["CO-45", 4180]])]),
      claim("FOX, SAGE", "MEM400002", "0000700002", "GRP700002", "7000000002", "1", [line("1006 100626", "98940", "", 6500, [["CO-45", 3190], ["PR-3", 2000]])]),
    ],
    expect: { buckets: ["PAID", "PARTIAL"], reconciled: false, pairs: 0 },
  },
];

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dir = fileURLToPath(new URL(".", import.meta.url));
  for (const d of DEMOS) {
    writeFileSync(dir + d.file, pdf(eobPages(d)), "latin1");
    console.log("wrote demo/" + d.file);
  }
}
