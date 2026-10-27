// Synthetic EOB text only — no real PHI. Run: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { analyze, cents, deidentify, DEMO_FOOTER, DEMO_MARKER, isDemo, pageLines, parseEob, readPdf } from "./public/eob.js";

const LINES = `
        TEST HEALTH PLAN                         PAYER CONTACT:     EDI SUPPORT
        100 TEST WAY                             FAX:               (555)555-0101
        TEST CHIROPRACTIC                        EFT:               EFT0000001
                                                 CHECK DATE:        10/14/2026
                                                 CHECK AMT:         34.35
        PROV      SERV DATE   POS  NOS  PROC  MODS   BILLED  ALLOWED  DEDUCT  COINS  GRP/RC-AMT  PROV PD
        NAME:DOE, JANE      MBR:MEMBER001     ACNT:ACCT0001     ICN:GRP0001
                                                           1000000001
        CORRECTED: NA  HICN:
        CLM Status:1   MRN:
        1234567893   0923 092326  11  1  98941          75.00   33.20   0.00  0.00  CO-45   41.80   3.20
                                                                                  PR-3    30.00
                                   REM: N123
        PT RESP 30.00          SUB TOTALS   75.00  33.20  0.00  0.00  71.80  3.20
        ADJ TO TOTALS:   PREV PD 0.00   INTEREST 0.00   LATE FILING CHARGE 0.00
                                                                   NET 3.20
        NAME:ROE, RICHARD   MBR:MEMBER002     ACNT:ACCT0002     ICN:GRP0002
                                                           1000000002
        CLM Status:1   MRN:
        1234567893   1002 100226  11  1  98941          75.00   40.24  40.24  0.00  CO-45   34.76   0.00
        1234567893   1002 100226  11  1  97012  GP      55.00   14.65  14.65  0.00  CO-45   40.35   0.00
        PT RESP 54.89          SUB TOTALS  130.00  54.89 54.89  0.00  75.11  0.00
                                                                   NET 0.00
        NAME:POE, ANNA      MBR:MEMBER003     ACNT:ACCT0003     ICN:GRP0003
                                                           1000000003
        CLM Status:4   MRN:
        1234567893   1001 100126  11  1  97110  GP      60.00    0.00   0.00  0.00  CO-50   60.00   0.00
        PT RESP 0.00           SUB TOTALS   60.00   0.00  0.00  0.00  60.00  0.00
                                                                   NET 0.00
        NAME:DOE, JANE      MBR:MEMBER001     ACNT:ACCT0004     ICN:GRP0001
                                                           1000000004
        CLM Status:22  MRN:
        1234567893   0923 092326  11  1  97012  GP     -55.00   -7.96  -7.96  0.00  PR-242 -47.04   0.00
        PT RESP 0.00           SUB TOTALS  -55.00  -7.96 -7.96  0.00 -47.04  0.00
                                                                   NET 0.00
        NAME:DOE, JANE      MBR:MEMBER001     ACNT:ACCT0004     ICN:GRP0001
                                                           1000000005
        CLM Status:1   MRN:
        1234567893   0923 092326  11  1  97012  GP      55.00    9.87   0.00  0.00  CO-45   45.13   9.87
                                   REM: MA67
        PT RESP 0.00           SUB TOTALS   55.00   9.87  0.00  0.00  45.13  9.87
                                                                   NET 9.87
        NAME:ROE, RICHARD   MBR:MEMBER002     ACNT:ACCT0005     ICN:GRP0002
                                                           1000000006
        CLM Status:1   MRN:
        1234567893   1002 100226  11  1  97110  GP      60.00   25.12   0.00  0.00  CO-45   34.88  25.12
        PT RESP 0.00           SUB TOTALS   60.00  25.12  0.00  0.00  34.88 25.12
                                                                   NET 25.12
           TOTALS:    # OF CLAIMS  BILLED AMT   ALLOWED AMT   DEDUCT AMT   COINS AMT     RC-AMT     PROV PAID   PROV ADJ   CHECK AMT
                           6         325.00       115.12        46.93         0.00       239.88       38.19       3.84       34.35
        PROVIDER ADJ DETAILS:                       PLB REASON CODE        FCN / Other Identifier    AMOUNT
                                                           AH              EFT0000001                3.84
        GLOSSARY:   Adjustment, Group, Reason, MOA, and Remark codes
        CO-         Contractual obligations.
                 45 Charge exceeds fee schedule.
                    Continued text.
        PR-         Patient Responsibility
                 3  Co-payment Amount
                 242Services not provided by network/primary care providers.
        MA67        Alert: Correction to a prior claim.
                                   Page 2
`.split("\n");

test("parses, buckets, pairs and reconciles a synthetic EOB", () => {
  const r = analyze(parseEob(LINES));
  assert.equal(r.payer, "TEST HEALTH PLAN");
  assert.deepEqual(r.claims.map((c) => c.bucket), ["PARTIAL", "PATIENT_RESP", "DENIED", "REVERSED", "PAID", "PAID"]);
  assert.equal(r.claims[0].pr, 3000);
  assert.deepEqual(r.claims[0].lines[0].remarks, ["N123"]);
  assert.equal(r.claims[1].pr, 5489);
  assert.equal(r.pairs.length, 1);
  assert.equal(r.pairs[0].reversal.label, "C4");
  assert.equal(r.pairs[0].correction.label, "C5");
  assert.equal(r.pairs[0].patientChange, -5500);
  assert.equal(r.pairs[0].payerNet, 987);
  assert.ok(r.reconciled);
  assert.deepEqual(r.warnings, []);
  assert.deepEqual(r.plb, [{ code: "AH", ref: "EFT0000001", amount: 384 }]);
  assert.equal(r.glossary["45"], "Charge exceeds fee schedule. Continued text.");
  assert.ok(r.glossary["242"].startsWith("Services"));
  assert.equal(r.claims[0].patient, r.claims[3].patient); // same member, different accounts = one patient
});

test("de-identified payload has no names, IDs, NPIs or dates", () => {
  const json = JSON.stringify(deidentify(analyze(parseEob(LINES))));
  for (const phi of ["DOE", "JANE", "ROE", "MEMBER001", "ACCT0001", "GRP0001", "1000000001", "1234567893", "0923", "092326", "10/14/2026"])
    assert.ok(!json.includes(phi), `leaked ${phi}`);
});

test("cents parses money exactly", () => {
  assert.equal(cents("-1,234.50"), -123450);
  assert.equal(cents("0.07"), 7);
});

test("pageLines rebuilds rows by position", () => {
  const it = (str, x, y) => ({ str, width: str.length * 4.2, transform: [1, 0, 0, 1, x, y] });
  assert.deepEqual(pageLines([it("CD", 21, 700), it("AB", 8.4, 700), it("EF", 0, 690)]), ["  AB CD", "EF"]);
});

// Every demo PDF's text goes through the real parser; demos/make-demos.js declares what each should produce.
// Demo dates are relative to a base day; tests pin it so deadlines (due soon / overdue) are stable.
import { demos, eobPages, pdf } from "./demo/make-demos.js";
const BASE = new Date(2026, 9, 21);
const DEMOS = demos(BASE);

for (const d of DEMOS) {
  test(`demo ${d.file} parses as expected`, () => {
    const r = analyze(parseEob(eobPages(d).flat()), new Date(2026, 9, 21));
    assert.deepEqual(r.claims.map((c) => c.bucket), d.expect.buckets);
    assert.equal(r.reconciled, d.expect.reconciled);
    assert.equal(r.pairs.length, d.expect.pairs);
    if (d.expect.reconciled) assert.deepEqual(r.warnings, []);
    else assert.ok(r.difference !== 0);
    if (d.expect.pip) assert.ok(r.pip);
    if (d.expect.nextPayer) assert.equal(r.claims.reduce((t, c) => t + c.nextPayerAmount, 0), d.expect.nextPayer);
  });
}

test("PIP follow-up deadline: 90 days from check date, status by today", () => {
  const pip = DEMOS.find((d) => d.expect.pip);
  const at = (y, m, day) => analyze(parseEob(eobPages(pip).flat()), new Date(y, m - 1, day)).followUp;
  assert.equal(at(2026, 8, 10).status, "open"); // check date 08/04/2026 → due 11/02/2026
  assert.equal(at(2026, 10, 21).daysLeft, 12);
  assert.equal(at(2026, 10, 21).status, "due soon");
  assert.equal(at(2026, 11, 3).status, "overdue");
  const r = analyze(parseEob(eobPages(pip).flat()), new Date(2026, 9, 21));
  assert.match(r.claims[1].action, /PIP maximum reached\. Bill \$90\.50 .* by 11\/02\/2026/);
  assert.ok(!r.claims[2].lines.some((l) => l.denied), "benefit-max lines are not denials");
  const json = JSON.stringify(deidentify(r));
  assert.ok(!json.includes("PARKER") && !json.includes("11/02/2026") && !json.includes("PIP0000001"));
});

test("footer line is ignored by the parser", () => {
  const r = analyze(parseEob([...LINES, "        " + DEMO_FOOTER]));
  assert.ok(!Object.values(r.glossary).some((t) => t.includes("SYNTHETIC")));
  assert.deepEqual(r.warnings, []);
});

// Same bundled pdf.js the browser uses, run in Node (the v2 server reads PDFs this way).
const pdfjs = await import("./public/vendor/pdf.min.mjs");
pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL("public/vendor/pdf.worker.min.mjs").href;
const latin1Bytes = (s) => new Uint8Array(Buffer.from(s, "latin1"));

test("generated demo PDFs carry the stamp; plain PDFs don't", async () => {
  const pages = eobPages(DEMOS[0]);
  const read = await readPdf(pdfjs, latin1Bytes(pdf(pages)));
  assert.equal(read.subject, DEMO_MARKER);
  assert.ok(read.pages.every((p) => p.some((l) => l.trim() === DEMO_FOOTER)));
  assert.equal(isDemo(read), true);

  const noFooter = pages.map((p, i) => (i === 0 ? p.filter((l) => !l.includes(DEMO_FOOTER)) : p));
  assert.equal(isDemo(await readPdf(pdfjs, latin1Bytes(pdf(noFooter)))), false);

  const noSubject = pdf(pages).replace(DEMO_MARKER, "X".repeat(DEMO_MARKER.length)); // same length keeps xref offsets valid
  assert.equal(isDemo(await readPdf(pdfjs, latin1Bytes(noSubject))), false);
});
