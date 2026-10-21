import * as pdfjs from "./vendor/pdf.min.mjs";
import {
  analyze, BENEFIT_MAX, CONTRACTUAL, DE_PIP_MINIMUM, deidentify, DENY_GROUPS, DUE_SOON_DAYS, FOLLOW_UP_AFTER_DAYS,
  mdy, NEXT_PAYER_FILING_DAYS, pageLines, parseEob, PIP_PAYER_WORDS, usd,
} from "./eob.js";

pdfjs.GlobalWorkerOptions.workerSrc = "./vendor/pdf.worker.min.mjs";

// tone = CSS color pair in index.html (--paid / --paid-bg, …)
const BUCKETS = {
  PAID: { label: "Paid", icon: "✓", tone: "paid", help: "Payer paid. Only contractual write-off." },
  PARTIAL: { label: "Partial", icon: "½", tone: "partial", help: "Payer paid part. Patient owes the rest." },
  PATIENT_RESP: { label: "Patient owes", icon: "$", tone: "owes", help: "$0 from payer: deductible/copay. Not a denial." },
  NEXT_PAYER: { label: "Bill next payer", icon: "→", tone: "next", help: "Benefit maximum reached (e.g. PIP). Bill the health insurance." },
  DENIED: { label: "Denied", icon: "✕", tone: "denied", help: "Nobody pays. Fix and resubmit or appeal." },
  REVERSED: { label: "Reversed", icon: "↺", tone: "reversed", help: "Payer undid an earlier claim. See its correction." },
};
const toneStyle = (t) => `--c:var(--${t});--c-bg:var(--${t}-bg)`;

// Builds DOM with text nodes only: nothing from the PDF or the AI is ever parsed as HTML.
const h = (tag, props = {}, ...kids) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k === "style") el.style.cssText = v;
    else el.setAttribute(k, v);
  }
  el.append(...kids.flat(Infinity).filter((k) => k != null && k !== false).map((k) => (k instanceof Node ? k : String(k))));
  return el;
};
const $ = (id) => document.getElementById(id);
const sum = (xs, f) => xs.reduce((t, x) => t + f(x), 0);
const pill = (tone, text) => h("span", { class: "badge", style: toneStyle(tone) }, h("span", { class: "dot" }), text);
const badge = (b) => pill(BUCKETS[b].tone, BUCKETS[b].label);
const card = (title, ...body) => h("section", { class: "card" }, title && h("h2", {}, title), body);
const fmtDates = (l) => {
  const to = `${l.to.slice(0, 2)}/${l.to.slice(2, 4)}/${l.to.slice(4)}`;
  return l.from === l.to.slice(0, 4) ? to : `${l.from.slice(0, 2)}/${l.from.slice(2)}–${to}`;
};

// ---- upload ----
const drop = $("drop");
$("file").addEventListener("change", (e) => e.target.files[0] && load(e.target.files[0]));
drop.addEventListener("dragover", (e) => (e.preventDefault(), drop.classList.add("over")));
drop.addEventListener("dragleave", () => drop.classList.remove("over"));
drop.addEventListener("drop", (e) => {
  e.preventDefault();
  drop.classList.remove("over");
  if (e.dataTransfer.files[0]) load(e.dataTransfer.files[0]);
});

async function load(file) {
  const out = $("out");
  drop.classList.add("compact");
  out.replaceChildren(h("p", { class: "muted" }, "Reading PDF…"));
  try {
    const doc = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
    const lines = [];
    for (let p = 1; p <= doc.numPages; p++) lines.push(...pageLines((await (await doc.getPage(p)).getTextContent()).items));
    const r = analyze(parseEob(lines));
    if (!r.claims.length) throw new Error("No claims found. Is this a Waystar “View EOB” PDF?");
    render(r);
    insights(r);
  } catch (e) {
    out.replaceChildren(h("p", { class: "error" }, e.message));
  }
}

// ---- dashboard ----
let filter = null;

function render(r) {
  const nonRev = r.claims.filter((c) => c.bucket !== "REVERSED");
  const billPatients = sum(nonRev.filter((c) => c.pr > 0), (c) => c.pr);
  const reversedPt = sum(r.claims.filter((c) => c.bucket === "REVERSED"), (c) => c.pr);
  const ref = r.header.EFT ? ["EFT #", r.header.EFT] : ["Check #", r.header["CHECK #"] ?? r.header["CHECK NO"] ?? "—"];
  filter = null;

  const unmatched = r.claims.filter((c) => c.bucket === "REVERSED" && !c.pair);

  $("out").replaceChildren(h("div", {},
    // payment header
    h("section", { class: "card" },
      h("div", { class: "card-head" },
        h("div", {}, h("div", { class: "eyebrow" }, "Payer"), h("h2", { class: "payer" }, r.payer || "Unknown payer")),
        r.reconciled ? pill("paid", "Reconciles to check amount") : pill("denied", `Doesn't add up: off by ${usd(r.difference)}`),
      ),
      h("div", { class: "kv" },
        kv(ref[0], ref[1]), kv("Check date", r.header["CHECK DATE"] ?? "—"), kv("Check amount", usd(r.checkAmount), "strong"),
        kv("Claims", r.claims.length), kv("Billed", usd(sum(nonRev, (c) => c.billed))),
        kv("Payer paid", usd(sum(r.claims, (c) => c.paid)), "paid"), kv("Fees / provider adj.", usd(sum(r.plb, (p) => p.amount))),
        kv("Bill patients", usd(billPatients), "owes"), reversedPt !== 0 && kv("Patient charges reversed", usd(reversedPt), "reversed"),
      ),
    ),
    pipCard(r),
    r.warnings.length > 0 &&
      h("section", { class: "card warn" }, h("h2", {}, "⚠ Check these before trusting the numbers"), h("ul", {}, r.warnings.map((w) => h("li", {}, w)))),

    // bucket tiles
    h("section", { class: "tiles" }, Object.keys(BUCKETS).map((b) => tile(r, b))),

    // AI insights (+ reversals beside it on wide screens)
    h("div", { class: r.pairs.length || unmatched.length ? "cols" : "" },
      h("section", { class: "card ai" },
        h("div", { class: "card-head" },
          h("h2", {}, h("span", { class: "spark" }, "✦"), "AI insights"),
          h("span", { class: "tag" }, "Gemini · de-identified data only"),
        ),
        h("div", { id: "ai" }),
        h("details", { class: "key" },
          h("summary", {}, "Patient key (on this screen only, never sent to AI)"),
          h("ul", {}, [...new Map(r.claims.map((c) => [c.patient, c])).values()].map((c) => h("li", {}, h("b", {}, c.patient), ` = ${c.name} (acct ${c.acnt})`))),
        ),
      ),
      (r.pairs.length > 0 || unmatched.length > 0) &&
        card("Reversals & corrections",
          r.pairs.map(pairRow),
          unmatched.length > 0 &&
            h("p", { class: "muted" }, unmatched.map((c) => c.label).join(", "), ": no corrected claim in this EOB yet. It may come in a later payment."),
        ),
    ),

    // claims table
    h("section", { class: "card flush" },
      h("div", { class: "card-head pad" }, h("h2", { id: "claims-title" }, "Claims"), h("span", { class: "muted small" }, "Click a row for service lines")),
      h("div", { class: "table-wrap" }, h("table", { id: "claims" })),
    ),

    // glossary
    Object.keys(r.glossary).length > 0 &&
      card(null,
        h("details", {}, h("summary", {}, "Code meanings from this EOB"),
          h("dl", { class: "gloss" }, Object.entries(r.glossary).flatMap(([k, v]) => [h("dt", {}, k), h("dd", {}, v)])))),
  ));
  drawClaims(r);
}

const kv = (label, value, tone) => h("div", {}, h("div", { class: "eyebrow" }, label), h("div", { class: `val ${tone ?? ""}` }, value));

function tile(r, b) {
  const cs = r.claims.filter((c) => c.bucket === b);
  const amt = {
    PAID: `${usd(sum(cs, (c) => c.paid))} paid`,
    PARTIAL: `${usd(sum(cs, (c) => c.paid))} paid · ${usd(sum(cs, (c) => c.pr))} patient`,
    PATIENT_RESP: `${usd(sum(cs, (c) => c.pr))} to bill patients`,
    NEXT_PAYER: `${usd(sum(cs, (c) => c.nextPayerAmount))} to bill next payer`,
    DENIED: `${usd(sum(cs, (c) => c.billed))} billed`,
    REVERSED: `${cs.filter((c) => c.pair).length} of ${cs.length} matched to a correction`,
  }[b];
  const btn = h("button", { class: "tile", style: toneStyle(BUCKETS[b].tone), "aria-pressed": "false", title: "Filter claims" },
    h("div", { class: "tile-head" }, h("span", { class: "icon" }, BUCKETS[b].icon), h("span", { class: "eyebrow" }, BUCKETS[b].label)),
    h("div", { class: "n" }, cs.length),
    h("div", { class: "amt" }, amt),
    h("div", { class: "help" }, BUCKETS[b].help),
  );
  btn.addEventListener("click", () => {
    filter = filter === b ? null : b;
    document.querySelectorAll(".tile").forEach((t) => t.setAttribute("aria-pressed", "false"));
    if (filter) btn.setAttribute("aria-pressed", "true");
    drawClaims(r);
  });
  return btn;
}

const followUpPill = (f) =>
  !f ? pill("reversed", "No check date found: set a deadline manually")
  : f.status === "overdue" ? pill("denied", `Overdue by ${-f.daysLeft} day${f.daysLeft === -1 ? "" : "s"}`)
  : f.status === "due soon" ? pill("partial", `Due soon: ${f.daysLeft} day${f.daysLeft === 1 ? "" : "s"} left`)
  : pill("owes", `Open: ${f.daysLeft} days left`);

// Benefit maximum reached (CARC 119 / N587), e.g. Delaware auto PIP exhausted → the patient's health insurance pays next.
function pipCard(r) {
  const cs = r.claims.filter((c) => c.bucket === "NEXT_PAYER");
  if (!cs.length) return null;
  const f = r.followUp, total = sum(cs, (c) => c.nextPayerAmount);
  const byPatient = [...Map.groupBy(cs, (c) => c.patient).values()];
  return h("section", { class: "card alert" },
    h("div", { class: "card-head" },
      h("h2", {}, h("span", { class: "spark", style: toneStyle("next") }, r.pip ? "🚗" : "→"),
        r.pip ? "PIP maximum reached: Delaware auto PIP is exhausted" : "Benefit maximum reached"),
      followUpPill(f),
    ),
    h("p", { class: "lead" }, r.pip
      ? `This auto insurer's Personal Injury Protection (PIP) benefits are used up (code 119, remark N587). It will not pay any more on this accident, so ${usd(total)} must be billed to the patient's own health insurance instead.`
      : `The payer says the benefit maximum is reached (code 119). ${usd(total)} must be billed to the patient's next coverage instead.`),
    r.pip && h("p", { class: "muted small" }, `Delaware PIP covers at least ${usd(DE_PIP_MINIMUM.perPerson)} per person and ${usd(DE_PIP_MINIMUM.perAccident)} per accident (21 Del. C. § 2118). Policies can carry higher limits, so confirm the limit with the adjuster.`),
    h("div", { class: "table-wrap" }, h("table", { class: "plain" },
      h("thead", {}, h("tr", {}, ["Patient", "Claims", "Paid by this payer", "Bill to health insurance", "File by", "Follow-up"].map((t, i) => h("th", { class: i === 2 || i === 3 ? "num" : "" }, t)))),
      h("tbody", {}, byPatient.map((pcs) => h("tr", {},
        h("td", {}, h("span", { class: "name" }, pcs[0].name), h("div", { class: "muted small" }, `${pcs[0].patient} · acct ${pcs[0].acnt}`)),
        h("td", {}, pcs.map((c) => c.label).join(", ")),
        h("td", { class: "num" }, usd(sum(pcs, (c) => c.paid))),
        h("td", { class: "num" }, h("b", {}, usd(sum(pcs, (c) => c.nextPayerAmount)))),
        h("td", {}, f ? mdy(f.due) : "—"),
        h("td", {}, followUpPill(f)),
      ))),
    )),
    h("h4", {}, "What to do"),
    h("ol", { class: "steps" },
      h("li", {}, r.pip ? "Call the PIP adjuster to confirm benefits are exhausted. Save this EOB or their exhaustion letter." : "Confirm with the payer that the benefit maximum is reached and save this EOB."),
      h("li", {}, "Get the patient's health insurance details and update them in ChiroTouch."),
      h("li", {}, `Bill the health insurance ${usd(total)} with this EOB attached as proof ${r.pip ? "PIP" : "the benefit"} is exhausted.`),
      h("li", {}, f ? `File by ${mdy(f.due)}. If there's no response within ${FOLLOW_UP_AFTER_DAYS} days, follow up with the health plan.` : `Set a filing deadline and follow up within ${FOLLOW_UP_AFTER_DAYS} days.`),
      h("li", {}, "If the patient has no other coverage, talk to the patient (and their attorney, if any) about the balance."),
    ),
    h("p", { class: "muted small" }, `Deadline is an estimate: ${NEXT_PAYER_FILING_DAYS} days from this EOB's check date. Confirm the health plan's timely-filing limit; many count from the date of service.`),
  );
}

function pairRow(p) {
  const ch = p.patientChange;
  return h("div", { class: "pair" },
    h("div", { class: "pair-head" },
      h("b", {}, `${p.reversal.label} → ${p.correction.label}`),
      h("span", { class: "muted" }, `${p.correction.patient} · ${p.correction.name}`),
    ),
    h("div", { class: "pair-nums" },
      h("span", {}, "Payer net ", h("b", {}, usd(p.payerNet))),
      ch < 0 ? pill("paid", `Patient balance down ${usd(-ch)}`) : ch > 0 ? pill("denied", `Patient balance up ${usd(ch)}`) : pill("reversed", "Patient balance unchanged"),
    ),
    h("div", { class: "muted small" },
      ch < 0
        ? `Payer reprocessed the claim. The patient now owes ${usd(-ch)} less than first processed. If they were already billed the old amount, adjust or refund.`
        : ch > 0
          ? `Payer reprocessed the claim. The patient now owes ${usd(ch)} more than first processed.`
          : "Payer reprocessed the claim. Patient amount unchanged."),
  );
}

function drawClaims(r) {
  const cs = r.claims.filter((c) => !filter || c.bucket === filter);
  $("claims-title").textContent = filter ? `Claims: ${BUCKETS[filter].label} (${cs.length})` : `Claims (${cs.length})`;
  const head = h("tr", {}, ["", "Claim", "Patient", "Account", "Payer claim #", "Status", "Billed", "Allowed", "Payer paid", "Patient owes", "Next step"].map(
    (t, i) => h("th", { class: i >= 6 && i <= 9 ? "num" : "" }, t)));
  const rows = cs.flatMap((c) => {
    const detail = h("tr", { class: "detail", hidden: "" }, h("td", { colspan: 11 }, lineTable(r, c)));
    const row = h("tr", { class: "claim", title: "Show service lines" },
      h("td", { class: "chev" }, "▸"), h("td", {}, h("b", {}, c.label), c.pair && c.bucket !== "REVERSED" ? h("div", { class: "muted small" }, `corrects ${c.pair.label}`) : null),
      h("td", {}, h("span", { class: "name" }, c.name), h("div", { class: "muted small" }, c.patient)), h("td", {}, c.acnt), h("td", {}, c.claimNo),
      h("td", {}, badge(c.bucket)),
      h("td", { class: "num" }, usd(c.billed)), h("td", { class: "num" }, usd(c.allowed)),
      h("td", { class: "num" }, usd(c.paid)), h("td", { class: "num" }, usd(c.pr)),
      h("td", {}, c.action),
    );
    row.addEventListener("click", () => {
      detail.hidden = !detail.hidden;
      row.firstChild.textContent = detail.hidden ? "▸" : "▾";
    });
    return [row, detail];
  });
  $("claims").replaceChildren(h("thead", {}, head), h("tbody", {}, rows));
}

function describe(r, code) {
  const [grp, reason] = code.includes("-") ? code.split("-") : [null, code];
  const d = r.glossary[reason] ?? r.glossary[code];
  return [grp && r.glossary[grp + "-"] ? r.glossary[grp + "-"].split(".")[0] : null, d ? d.split(". ")[0] : null].filter(Boolean).join(": ");
}

function lineTable(r, c) {
  return h("table", {},
    h("thead", {}, h("tr", {}, ["Date(s)", "Proc", "Mods", "Units", "Billed", "Allowed", "Deductible", "Coins", "Adjustments", "Remarks", "Paid"].map(
      (t, i) => h("th", { class: [4, 5, 6, 7, 10].includes(i) ? "num" : "" }, t)))),
    h("tbody", {}, c.lines.map((l) => h("tr", {},
      h("td", {}, fmtDates(l)), h("td", {}, l.proc), h("td", {}, l.mods.join(" ")), h("td", {}, l.units),
      h("td", { class: "num" }, usd(l.billed)), h("td", { class: "num" }, usd(l.allowed)),
      h("td", { class: "num" }, usd(l.deduct)), h("td", { class: "num" }, usd(l.coins)),
      h("td", {}, l.adjs.map((a) => h("div", { title: describe(r, a.code) }, h("b", {}, a.code), ` ${usd(a.amount)}`, h("div", { class: "muted" }, describe(r, a.code))))),
      h("td", {}, l.remarks.map((m) => h("div", {}, h("b", {}, m), h("div", { class: "muted" }, describe(r, m))))),
      h("td", { class: "num" }, usd(l.paid), l.denied ? h("div", {}, pill("denied", "denied")) : null),
    ))),
  );
}

// ---- AI ----
async function insights(r) {
  const box = $("ai");
  box.replaceChildren(h("div", { class: "skeleton", "aria-label": "Asking Gemini" }, h("i"), h("i"), h("i")),
    h("p", { class: "muted small" }, "Asking Gemini… usually 10–20 seconds."));
  const PRI = { High: "denied", Medium: "partial", Low: "reversed" };
  try {
    const res = await fetch("/api/insights", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(deidentify(r)) });
    const j = await res.json();
    if (!res.ok) throw new Error(j.error || res.statusText);
    box.replaceChildren(h("div", {},
      h("p", { class: "summary" }, j.summary),
      j.actions?.length > 0 && [h("h4", {}, "What to do"),
        h("ul", { class: "actions" }, j.actions.map((a) => h("li", {}, h("span", { class: "pri", style: toneStyle(PRI[a.priority] ?? "reversed") }, a.priority), h("span", {}, a.text))))],
      j.reversals && [h("h4", {}, "Reversals explained"), h("p", {}, j.reversals)],
      j.watch?.length > 0 && [h("h4", {}, "Worth a second look"), h("ul", { class: "watch" }, j.watch.map((w) => h("li", {}, w)))],
    ));
  } catch (e) {
    box.replaceChildren(h("p", { class: "error" }, `AI insights unavailable: ${e.message}. Everything else on this page is computed exactly from the PDF.`));
  }
}

// ---- tabs (#explainer / #rules) ----
function showView() {
  const view = location.hash === "#rules" ? "rules" : "explainer";
  $("view-explainer").hidden = view !== "explainer";
  $("view-rules").hidden = view !== "rules";
  document.querySelectorAll(".nav-item").forEach((a) =>
    a.getAttribute("href") === `#${view}` ? a.setAttribute("aria-current", "page") : a.removeAttribute("aria-current"));
  if (view === "rules" && !$("view-rules").hasChildNodes()) renderRules();
}
addEventListener("hashchange", showView);
showView();

// ---- Rules & settings: read-only view of the constants in eob.js and the server config ----
function renderRules() {
  const chips = (xs) => [...xs].map((x) => h("span", { class: "chip" }, x));
  const where = (name, file = "public/eob.js") => h("code", {}, `${file} · ${name}`);
  const table = (rows, head = ["Setting", "Value", "Change in"]) =>
    h("div", { class: "table-wrap" }, h("table", { class: "plain rules" },
      h("thead", {}, h("tr", {}, head.map((t) => h("th", {}, t)))),
      h("tbody", {}, rows.map((cells) => h("tr", {}, cells.map((c) => h("td", {}, c))))),
    ));
  const model = h("span", { class: "chip" }, "loading…");
  const aiState = h("span", {}), passState = h("span", {}), session = h("b", {}), tries = h("b", {}), lockMin = h("b", {});
  fetch("/api/config").then((r) => r.json()).then((c) => {
    model.textContent = c.model;
    aiState.replaceChildren(c.aiEnabled ? pill("paid", "API key set") : pill("denied", "GEMINI_API_KEY missing"));
    passState.replaceChildren(c.passcode ? pill("paid", "Passcode required") : pill("denied", "No passcode: only safe on this computer"));
    session.textContent = `${c.sessionHours} hours`;
    tries.textContent = `${c.maxFails} tries`;
    lockMin.textContent = `${c.lockMinutes} minutes`;
  }).catch(() => (model.textContent = "unknown"));

  const rule = (b, when, action) => [badge(b), when, action];
  $("view-rules").replaceChildren(
    h("div", { class: "page-head" }, h("div", {},
      h("h1", {}, "Rules & settings"),
      h("p", { class: "sub" }, "Every rule and number the explainer uses. Read-only: they come straight from the code, so this page is always current."),
    )),

    card("How each claim is sorted",
      h("p", { class: "muted small" }, "Checked top to bottom. The first rule that matches decides the bucket."),
      table([
        rule("REVERSED", "Claim status is 22 (reversal of a previous payment)", "Review it with its matched correction and act on the net."),
        rule("NEXT_PAYER", ["Any line adjusted with reason ", chips(BENEFIT_MAX), " (benefit maximum reached)"], "Bill the patient's health insurance with this EOB attached. Don't appeal."),
        rule("DENIED", "Claim status is 4 (denied)", "Check the denial codes, then fix and resubmit or appeal."),
        rule("PATIENT_RESP", "Payer paid $0 and the patient owes more than $0", "Bill the patient (usually deductible). Not a denial: don't appeal."),
        rule("DENIED", "Payer paid $0 and the patient owes $0", "Check the denial codes, then fix and resubmit or appeal."),
        rule("PARTIAL", "Payer paid something, and the patient owes something or a line was denied", "Bill the patient and work any denied lines."),
        rule("PAID", "Anything else", "No action."),
      ], ["Bucket", "When", "What billing does"]),
    ),

    card("Adjustment codes",
      table([
        ["Normal write-off reasons", [chips([...CONTRACTUAL].map((c) => `CO-${c}`)), h("div", { class: "muted small" }, "A $0 line adjusted only by these is not a denial.")], where("CONTRACTUAL")],
        ["Denial groups", [chips(DENY_GROUPS), h("div", { class: "muted small" }, "A $0 line adjusted by these groups (except write-off and benefit-max reasons) counts as denied.")], where("DENY_GROUPS")],
        ["Benefit maximum reasons", [chips(BENEFIT_MAX), h("div", { class: "muted small" }, "Sends the claim to “Bill next payer”.")], where("BENEFIT_MAX")],
      ]),
    ),

    card("PIP (auto insurance)",
      table([
        ["Payer names treated as auto / PIP", [chips(PIP_PAYER_WORDS), h("div", { class: "muted small" }, "If the payer's name contains one of these words, benefit-max claims are labelled PIP.")], where("PIP_PAYER_WORDS")],
        ["Delaware PIP minimum", [h("b", {}, `${usd(DE_PIP_MINIMUM.perPerson)} per person · ${usd(DE_PIP_MINIMUM.perAccident)} per accident`), h("div", { class: "muted small" }, "21 Del. C. § 2118. Shown on the PIP card; policies can be higher.")], where("DE_PIP_MINIMUM")],
      ]),
    ),

    card("Follow-up deadlines",
      table([
        ["Filing window for the next payer", [h("b", {}, `${NEXT_PAYER_FILING_DAYS} days`), " from the EOB's check date", h("div", { class: "muted small" }, "Estimate: confirm each health plan's timely-filing limit (many count from the date of service).")], where("NEXT_PAYER_FILING_DAYS")],
        ["Status", [pill("owes", `Open: more than ${DUE_SOON_DAYS} days left`), " ", pill("partial", `Due soon: ${DUE_SOON_DAYS} days or fewer`), " ", pill("denied", "Overdue")], where("DUE_SOON_DAYS")],
        ["Follow up if no response", h("b", {}, `${FOLLOW_UP_AFTER_DAYS} days`), where("FOLLOW_UP_AFTER_DAYS")],
      ]),
    ),

    card("Checks on every upload",
      h("ul", { class: "steps" },
        h("li", {}, "Each line balances: billed − deductible − coinsurance − adjustments = paid."),
        h("li", {}, "Each claim adds up: its line payments equal its NET."),
        h("li", {}, "Patient amount matches: all PR adjustments equal PT RESP (reversals skipped)."),
        h("li", {}, "Payment reconciles: claim payments − provider adjustments = check amount."),
        h("li", {}, "Nothing missed: claim count and total paid match the EOB's TOTALS row."),
        h("li", {}, "Reversals are matched to corrections by account + procedures + dates + opposite charge (fallback: same dates)."),
      ),
      h("p", { class: "muted small" }, "Any failure shows a red “Check these before trusting the numbers” card and becomes the AI's first action."),
    ),

    card("Access",
      table([
        ["Passcode page", passState, where("APP_PASSCODE", ".env")],
        ["Signed out automatically after", [session, h("div", { class: "muted small" }, "Or click Lock in the sidebar. A server restart also signs everyone out.")], where("SESSION_HOURS", "server.js")],
        ["Wrong passcode limit", [tries, " then locked for ", lockMin], where("MAX_FAILS / LOCK_MINUTES", "server.js")],
      ]),
    ),

    card("AI (Gemini)",
      table([
        ["Model", model, where("GEMINI_MODEL", ".env")],
        ["Status", aiState, where("GEMINI_API_KEY", ".env")],
      ]),
      h("div", { class: "two", style: "margin-top:16px" },
        h("div", {}, h("h4", {}, "Sent to Gemini"), h("ul", {},
          ["Claim labels (C1, C2…) and patient labels (Patient 1…)", "Claim status, bucket and dollar amounts", "Procedure, adjustment and remark codes and their meanings", "Payer name, reversal pairs, filing status (open / due soon / overdue)"].map((t) => h("li", {}, t)))),
        h("div", {}, h("h4", {}, "Never sent"), h("ul", {},
          ["Patient names", "Member IDs, account numbers, claim numbers / ICNs", "Provider NPIs", "Any dates (service, check, deadlines)", "The PDF itself: it is read in this browser only"].map((t) => h("li", {}, t)))),
      ),
    ),

    h("p", { class: "note" }, "To change a rule: edit the constant shown in “Change in”, refresh the page, and run npm test. AI settings live in .env and need a server restart (npm start)."),
  );
}
