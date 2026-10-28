// doc.js — the document view: one stored EOB's full breakdown (payment card, PIP card, bucket tiles, AI box,
// reversals, claims table, glossary) plus Back / stage / Mark reviewed / Reopen / Open PDF.
// Called by app.js render() for #doc/<id>[/<claimLabel>]. Reads only the Entry it's given (row + analysed r);
// changes go through app.js (setStage, retryAi). Never computes money itself: everything comes from eob.js analyze().
import { DE_PIP_MINIMUM, FOLLOW_UP_AFTER_DAYS, mdy, NEXT_PAYER_FILING_DAYS, STAGES, usd } from "./eob.js";
import { $, badge, BUCKETS, card, fmtDates, h, kv, pill, STAGE_TONES, sum, toneStyle } from "./ui.js";
import { retryAi, setStage } from "./app.js";

let filter = null; // bucket tile filter, reset each time a document opens

export function renderDoc(entry, claimLabel) {
  const { row, r, stage } = entry;
  filter = null;
  const reviewed = stage === "reviewed";
  const action = reviewed
    ? [h("span", { class: "muted small" }, `Reviewed ${new Date(row.stage_at).toLocaleDateString()}`),
       h("button", { class: "btn ghost reopen", type: "button", onclick: () => setStage(row.id, null) }, "Reopen")]
    : h("button", { class: "btn mark-reviewed", type: "button", onclick: () => setStage(row.id, "reviewed") }, "✓ Mark reviewed");
  const view = h("div", {},
    h("div", { class: "page-head" },
      h("div", {},
        h("a", { class: "back", href: "#documents" }, "← Documents"),
        h("h1", {}, row.file_name),
        h("p", { class: "sub" }, `${r.payer} · uploaded ${new Date(row.uploaded_at).toLocaleString()}`),
      ),
      h("div", { class: "doc-actions" },
        h("span", { class: "badge stage-badge", style: toneStyle(STAGE_TONES[stage]) }, h("span", { class: "dot" }), STAGES[stage]),
        action,
        h("a", { class: "btn ghost open-pdf", href: `/api/docs/${row.id}/pdf`, target: "_blank", rel: "noopener" }, "Open PDF ↗"),
      ),
    ),
    breakdown(r, entry),
  );
  // Draw the claims table once the view is in the page, then jump to the claim a link pointed at.
  queueMicrotask(() => {
    drawClaims(r);
    const target = claimLabel && document.querySelector(`#claims tr.claim[data-claim="${CSS.escape(claimLabel)}"]`);
    if (target) { target.click(); target.scrollIntoView({ block: "center" }); }
  });
  return view;
}

function breakdown(r, entry) {
  const nonRev = r.claims.filter((c) => c.bucket !== "REVERSED");
  const billPatients = sum(nonRev.filter((c) => c.pr > 0), (c) => c.pr);
  const reversedPt = sum(r.claims.filter((c) => c.bucket === "REVERSED"), (c) => c.pr);
  const ref = r.header.EFT ? ["EFT #", r.header.EFT] : ["Check #", r.header["CHECK #"] ?? r.header["CHECK NO"] ?? "—"];
  filter = null;

  const unmatched = r.claims.filter((c) => c.bucket === "REVERSED" && !c.pair);

  return h("div", {},
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
        h("div", { id: "ai" }, aiContent(entry)),
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
  );
}


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

export const followUpPill = (f) =>
  !f ? pill("reversed", "No check date found: set a deadline manually")
  : f.status === "overdue" ? pill("denied", `Overdue by ${-f.daysLeft} day${f.daysLeft === -1 ? "" : "s"}`)
  : f.status === "due soon" ? pill("partial", `Due soon: ${f.daysLeft} day${f.daysLeft === 1 ? "" : "s"} left`)
  : pill("owes", `Open: ${f.daysLeft} days left`);

// Benefit maximum reached (code 119), e.g. Delaware auto PIP exhausted → the patient's health insurance pays next.
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
      ? `This auto insurer's Personal Injury Protection (PIP) benefits are used up (code 119). It will not pay any more on this accident, so ${usd(total)} must be billed to the patient's own health insurance instead.`
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
    const detail = h("tr", { class: "detail", hidden: "" }, h("td", { colspan: 11 }, lineTable(r, c), playbookBox(c)));
    const row = h("tr", { class: "claim", title: "Show service lines", "data-claim": c.label },
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

// The billing team's fix steps for this claim's denial codes (eob.js DENIAL_PLAYBOOK, matched in analyze()).
// Several rows for one code (e.g. CO-16) means the remark code decides which applies, so all are shown.
const playbookBox = (c) => c.playbook.length > 0 &&
  h("div", { class: "playbook" },
    h("h4", {}, "How to fix (billing team playbook)"),
    c.playbook.length > 1 && h("p", { class: "muted small" }, "More than one reason in the playbook fits this code: check the EOB and payer notes to see which applies."),
    h("dl", {}, c.playbook.flatMap((p) => [
      h("dt", {}, p.reason, " ", h("span", { class: "muted small" }, p.codes.join(", "))), h("dd", {}, p.resolution)])));

const PRI = { High: "denied", Medium: "partial", Low: "reversed" };
// AI box from the stored row: the server writes ai / ai_status / ai_error after upload (background queue).
function aiContent({ row }) {
  if (row.ai_status === "pending")
    return [h("div", { class: "skeleton", "aria-label": "AI is reading this EOB" }, h("i"), h("i"), h("i")),
      h("p", { class: "muted small" }, "AI is reading this EOB… usually 10–20 seconds.")];
  if (row.ai_status === "error") {
    const retry = h("button", { class: "btn small-btn", type: "button" }, "↻ Try again");
    retry.addEventListener("click", () => retryAi(row.id));
    return h("div", { class: "ai-error", role: "alert" },
      h("b", {}, "AI insights unavailable"), h("p", {}, row.ai_error),
      h("p", { class: "muted small" }, "Everything else on this page is computed exactly from the PDF."), retry);
  }
  const j = row.ai;
  return h("div", {},
    h("p", { class: "summary" }, j.summary),
    j.actions?.length > 0 && [h("h4", {}, "What to do"),
      h("ul", { class: "actions" }, j.actions.map((a) => h("li", {}, h("span", { class: "pri", style: toneStyle(PRI[a.priority] ?? "reversed") }, a.priority), h("span", {}, a.text))))],
    j.reversals && [h("h4", {}, "Reversals explained"), h("p", {}, j.reversals)],
    j.watch?.length > 0 && [h("h4", {}, "Worth a second look"), h("ul", { class: "watch" }, j.watch.map((w) => h("li", {}, w)))],
    h("p", { class: "muted small ai-meta" }, `✦ Written by Gemini (${j.model}) in ${(j.ms / 1000).toFixed(1)} s from de-identified data. AI can make mistakes: the numbers and buckets above come from the PDF itself.`),
  );
}

