// Synthetic EOB text only — no real PHI. Run: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import {
  analyze, attentionItems, autoStage, cents, deidentify, DEMO_FOOTER, DEMO_MARKER, DENIAL_PLAYBOOK, denialPlaybook, isDemo, mdy, pageLines, TERMS,
  parseEob, readPdf, summarize,
} from "./public/eob.js";

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
    assert.equal(autoStage(r), d.expect.stage);
  });
}

test("24 batch demos: 10 + 5 + 5 + 4, unique file names, all stamped", async () => {
  const batches = DEMOS.filter((d) => d.dir);
  const count = (dir) => batches.filter((d) => d.dir === dir).length;
  assert.deepEqual([count("batch-1"), count("batch-2"), count("batch-3"), count("batch-4")], [10, 5, 5, 4]);
  assert.equal(new Set(DEMOS.map((d) => d.file)).size, DEMOS.length);
  for (const dir of ["batch-1", "batch-2", "batch-3", "batch-4"]) {
    const d = batches.find((b) => b.dir === dir);
    assert.ok(isDemo(await readPdf(pdfjs, latin1Bytes(pdf(eobPages(d))))), `${d.file} stamped`);
  }
});

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

// ---- v2: stages, needs-attention items, dashboard totals (spec §9, §10, §10a) ----
const demo = (file) => analyze(parseEob(eobPages(DEMOS.find((d) => d.file === file)).flat()), BASE);

test("autoStage places each document in its automatic column", () => {
  assert.equal(autoStage(demo("pip-maximum-reached.pdf")), "action");
  assert.equal(autoStage(demo("denials-paper-check.pdf")), "action");
  assert.equal(autoStage(demo("deductible-season.pdf")), "ready");
  assert.equal(autoStage(demo("reversals-reprocessed.pdf")), "action");
  assert.equal(autoStage(demo("needs-review-mismatch.pdf")), "mismatch");
  assert.equal(autoStage(analyze(parseEob(LINES))), "action");
});

test("attentionItems: PIP is one next-payer item per patient with its deadline", () => {
  const items = attentionItems(demo("pip-maximum-reached.pdf"));
  assert.equal(items.length, 1);
  assert.equal(items[0].type, "next_payer");
  assert.equal(items[0].amount, 28050);
  assert.equal(items[0].status, "due soon");
  assert.equal(mdy(items[0].due), "11/02/2026");
});

test("attentionItems: one item per denied claim, plus denied lines inside partial claims", () => {
  const items = attentionItems(demo("denials-paper-check.pdf"));
  assert.deepEqual(items.filter((i) => i.type === "denied").map((i) => i.claim), ["C1", "C2", "C3", "C5"]);
  assert.ok(items.find((i) => i.type === "denied").text.includes("CO-50"));
  const line = items.filter((i) => i.type === "denied_line");
  assert.deepEqual(line.map((i) => [i.claim, i.amount]), [["C4", 6000]]);
});

test("attentionItems: refunds per reversal pair where the patient now owes less, plus unmatched reversals", () => {
  const items = attentionItems(demo("reversals-reprocessed.pdf"));
  assert.deepEqual(items.filter((i) => i.type === "refund").map((i) => [i.claim, i.amount]), [["C4", 4500], ["C5", 12000]]);
  assert.deepEqual(items.filter((i) => i.type === "unmatched").map((i) => i.claim), ["C3"]);
});

test("attentionItems: a payment that doesn't add up is one mismatch item", () => {
  const items = attentionItems(demo("needs-review-mismatch.pdf"));
  assert.deepEqual(items.map((i) => [i.type, i.amount]), [["mismatch", 1000]]);
});

test("summarize: dashboard money definitions", () => {
  const t = summarize([{ r: demo("denials-paper-check.pdf"), stage: "action" }]);
  assert.equal(t.payerPaid, 4640);
  assert.equal(t.billPatients, 2000);
  assert.equal(t.denied, 32500);
  assert.equal(t.writeOff, 8360);
  assert.equal(t.nextPayer, 0);
  assert.equal(t.denialReasons[0].count, 1);
});

test("summarize: counts reviewed documents and leaves reversal claims out of the money", () => {
  const t = summarize([
    { r: demo("reversals-reprocessed.pdf"), stage: "action" },
    { r: demo("deductible-season.pdf"), stage: "reviewed" },
  ]);
  assert.equal(t.documents, 2);
  assert.equal(t.reviewed, 1);
  const rev = summarize([{ r: demo("reversals-reprocessed.pdf"), stage: "action" }]);
  assert.equal(rev.payerPaid, 5344);
  assert.equal(rev.billPatients, 3000);
});

test("summarize: Denied counts denied lines only inside PARTIAL claims (spec §10a)", () => {
  const r = demo("deductible-season.pdf");
  const c = r.claims.find((x) => x.bucket === "PATIENT_RESP");
  c.lines[0].denied = true; // a denied line on a claim that isn't PARTIAL must not count as Denied money
  assert.equal(summarize([{ r, stage: "ready" }]).denied, 0);
});

// ---- Billing team's denial playbook (FEAT-008) ----

test("denialPlaybook: the billing team's rows for an adjustment code", () => {
  assert.equal(DENIAL_PLAYBOOK.length, 18);
  assert.deepEqual(denialPlaybook("CO-27").map((p) => p.reason), ["Eligibility or inactive coverage"]);
  assert.equal(denialPlaybook("CO-16").length, 3); // three reasons share CO-16: the remark code says which
  assert.deepEqual(denialPlaybook("OA-119").map((p) => p.reason), ["Maximum benefits reached"]); // same reason, other denial group
  assert.deepEqual(denialPlaybook("PR-2").map((p) => p.codes), [["PR-1", "PR-2", "PR-3"]]);
  assert.deepEqual(denialPlaybook("CO-1"), []); // PR reasons don't leak into denial groups
  assert.deepEqual(denialPlaybook("N130"), []);
  assert.deepEqual(denialPlaybook("CO-999"), []);
});

test("denied claims carry the playbook rows and name the reason in their next step", () => {
  const r = demo("denials-paper-check.pdf");
  const c1 = r.claims[0]; // CO-50
  assert.deepEqual(c1.playbook.map((p) => p.reason), ["Medical necessity not established"]);
  assert.ok(c1.action.includes("Medical necessity not established"), c1.action);
  const partial = r.claims.find((c) => c.bucket === "PARTIAL" && c.lines.some((l) => l.denied)); // CO-97 line
  assert.ok(partial.action.includes("Bundled service/incidental procedure"), partial.action);
  assert.deepEqual(r.claims.find((c) => c.bucket === "PAID")?.playbook ?? [], []);
});

test("attentionItems and summarize use the playbook reason names", () => {
  const r = demo("denials-paper-check.pdf");
  assert.ok(attentionItems(r).find((i) => i.claim === "C1").text.includes("Medical necessity not established"));
  const t = summarize([{ r, stage: "action" }]);
  assert.equal(t.denialReasons.find((d) => d.code === "CO-50").text, "Medical necessity not established");
});

test("AI payload carries only the playbook rows for codes in this EOB", () => {
  const reasons = deidentify(demo("denials-paper-check.pdf")).billingPlaybook.map((p) => p.reason);
  assert.ok(reasons.includes("Medical necessity not established"));
  assert.ok(reasons.includes("Timely filing exceeded"));
  assert.ok(!reasons.includes("Duplicate claim"));
});

test("playbook is read from public/denial-playbook.json (the billing team's source of truth)", async () => {
  const { readFile } = await import("node:fs/promises");
  const json = JSON.parse(await readFile(new URL("./public/denial-playbook.json", import.meta.url), "utf8"));
  assert.deepEqual(DENIAL_PLAYBOOK.map((p) => p.reason), json.denial_resolution_guide.map((g) => g.denial_reason));
  const bundled = DENIAL_PLAYBOOK.find((p) => p.reason === "Bundled or mutually exclusive");
  assert.deepEqual([bundled.codes, bundled.notes], [["CO-4", "CO-11"], ["Or payer-specific edits"]]); // free text isn't a code
  assert.equal(TERMS.length, Object.keys(json.terms).length);
});

test("every code in the playbook has a demo EOB that shows it (add a demo when billing adds a code)", () => {
  const used = new Set(DEMOS.flatMap((d) => d.claims.flatMap((c) => c.lines.flatMap((l) => [
    ...l.other.map(([code]) => code), ...(l.deduct ? ["PR-1"] : []), ...(l.coins ? ["PR-2"] : [])]))));
  const missing = DENIAL_PLAYBOOK.flatMap((p) => p.codes).filter((code) => ![...used].some((u) => denialPlaybook(u).some((p) => p.codes.includes(code))));
  assert.deepEqual(missing, []);
});
