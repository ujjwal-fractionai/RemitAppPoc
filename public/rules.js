// rules.js — the Rules & settings tab: every rule constant from eob.js plus server settings (/api/config), read-only,
// and the one write action of the demo: "Clear demo data" (DELETE /api/docs after an in-page confirmation).
// Called by app.js render() each time #rules opens (so the document count is current).
import {
  BENEFIT_MAX, CONTRACTUAL, DE_PIP_MINIMUM, DEMO_FOOTER, DEMO_MARKER, DENIAL_PLAYBOOK, DENY_GROUPS, DUE_SOON_DAYS, FOLLOW_UP_AFTER_DAYS,
  NEXT_PAYER_FILING_DAYS, PIP_PAYER_WORDS, STAGES, TERMS, usd,
} from "./eob.js";
import { api, banner, refresh, state } from "./app.js";
import { $, badge, card, h, pill, STAGE_TONES } from "./ui.js";

export function renderRules() {
  const chips = (xs) => [...xs].map((x) => h("span", { class: "chip" }, x));
  const where = (name, file = "public/eob.js") => h("code", {}, `${file} · ${name}`);
  const table = (rows, head = ["Setting", "Value", "Change in"]) =>
    h("div", { class: "table-wrap" }, h("table", { class: "plain rules" },
      h("thead", {}, h("tr", {}, head.map((t) => h("th", {}, t)))),
      h("tbody", {}, rows.map((cells) => h("tr", {}, cells.map((c) => h("td", {}, c))))),
    ));
  const model = h("span", { class: "chip" }, "loading…");
  const aiState = h("span", {}), passState = h("span", {}), session = h("b", {}), tries = h("b", {}), lockMin = h("b", {});
  const storeState = h("span", { class: "storage-status" }, "checking…");
  fetch("/api/config").then((r) => r.json()).then((c) => {
    model.textContent = c.model;
    aiState.replaceChildren(c.aiEnabled ? pill("paid", "API key set") : pill("denied", "GEMINI_API_KEY missing"));
    passState.replaceChildren(c.passcode ? pill("paid", "Passcode required") : pill("denied", "No passcode: only safe on this computer"));
    session.textContent = `${c.sessionHours} hours`;
    tries.textContent = `${c.maxFails} tries`;
    lockMin.textContent = `${c.lockMinutes} minutes`;
    storeState.replaceChildren(c.supabase === "ok" ? pill("paid", "Connected") : pill("denied", c.supabase === "not configured" ? "Not configured" : "Unreachable"));
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

    card("Board columns",
      h("p", { class: "muted small" }, "Every uploaded EOB is placed automatically in one of the first three columns; it moves to Reviewed only when someone clicks Mark reviewed."),
      table([
        [pill(STAGE_TONES.mismatch, STAGES.mismatch), "The check doesn't match the claims, or the EOB's own numbers don't balance.", where("autoStage")],
        [pill(STAGE_TONES.action, STAGES.action), "Any denial, PIP / next-payer claim, refund after reprocessing, unmatched reversal or denied line.", where("autoStage")],
        [pill(STAGE_TONES.ready, STAGES.ready), "Everything else: payments to post and patient bills.", where("autoStage")],
        [pill(STAGE_TONES.reviewed, STAGES.reviewed), "Set by Mark reviewed (for Ready to Review: once posted). Reopen sends it back.", "Mark reviewed / Reopen"],
      ], ["Column", "When", "Change in"]),
    ),

    storageCard(storeState, table, where),

    card("Adjustment codes",
      table([
        ["Normal write-off reasons", [chips([...CONTRACTUAL].map((c) => `CO-${c}`)), h("div", { class: "muted small" }, "A $0 line adjusted only by these is not a denial.")], where("CONTRACTUAL")],
        ["Denial groups", [chips(DENY_GROUPS), h("div", { class: "muted small" }, "A $0 line adjusted by these groups (except write-off and benefit-max reasons) counts as denied.")], where("DENY_GROUPS")],
        ["Benefit maximum reasons", [chips(BENEFIT_MAX), h("div", { class: "muted small" }, "Sends the claim to “Bill next payer”.")], where("BENEFIT_MAX")],
      ]),
    ),

    card("Denial playbook (billing team)",
      h("p", { class: "muted small" }, "Shown under each denied claim and given to the AI. A CO code here also covers the same reason under OA or PI. CO-45 and PR rows aren't denials: they explain write-offs and patient bills."),
      h("div", { class: "playbook-rules" }, table(DENIAL_PLAYBOOK.map((p) => [h("b", {}, p.reason), [chips(p.codes), p.notes.length > 0 && h("div", { class: "muted small" }, p.notes.join(" · "))], p.resolution]),
        ["Denial reason", "Codes", "Resolution"])),
      h("p", { class: "muted small" }, where("denial_resolution_guide", "public/denial-playbook.json")),
    ),

    card("Terms",
      table(TERMS.map(([k, v]) => [h("b", {}, k), v]), ["Term", "Meaning"]),
      h("p", { class: "muted small" }, where("terms", "public/denial-playbook.json")),
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
        ["Signed out automatically after", [session, h("div", { class: "muted small" }, "Or click Lock in the sidebar. Changing the passcode signs everyone out.")], where("SESSION_HOURS", "server.js")],
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
          ["Claim labels (C1, C2…) and patient labels (Patient 1…)", "Claim status, bucket and dollar amounts", "Procedure, adjustment and remark codes and their meanings", "The billing team's playbook steps for those codes","Payer name, reversal pairs, filing status (open / due soon / overdue)"].map((t) => h("li", {}, t)))),
        h("div", {}, h("h4", {}, "Never sent"), h("ul", {},
          ["Patient names", "Member IDs, account numbers, claim numbers / ICNs", "Provider NPIs", "Any dates (service, check, deadlines)", "The PDF itself"].map((t) => h("li", {}, t)))),
      ),
    ),

    h("p", { class: "note" }, "To change a rule: edit the constant shown in “Change in”, refresh the page, and run npm test. AI settings live in .env and need a server restart (npm start)."),
  );
}

// Storage + the demo's only destructive action. Confirmation is in the page (no browser dialog), and names the count.
function storageCard(storeState, table, where) {
  const n = state.docs.length;
  const confirmBox = h("div", { class: "confirm-slot" });
  // The refresh below can redraw this whole tab, so always write into the slot that's on the page now.
  const slot = () => $("view-rules").querySelector(".confirm-slot");
  // DELETE removes every stored document, including any uploaded since this page loaded: reload first so the count is true.
  const ask = async () => { await refresh(); slot().replaceChildren(h("div", { class: "confirm", role: "alertdialog" },
    h("p", {}, h("b", {}, `Delete all ${state.docs.length} demo documents and their PDFs?`), " This can't be undone."),
    h("button", { class: "btn ghost", type: "button", onclick: () => slot().replaceChildren() }, "Cancel"),
    h("button", { class: "btn danger", type: "button", onclick: clear }, "Delete"),
  )); };
  async function clear() {
    try {
      const { deleted } = await api("/api/docs", { method: "DELETE" });
      await refresh();
      slot().replaceChildren(h("p", { class: "muted" }, `Deleted ${deleted} document${deleted === 1 ? "" : "s"}.`));
    } catch (e) { banner(e.message); }
  }
  return card("Storage",
    table([
      ["Supabase (demo documents only)", storeState, where("SUPABASE_URL / SUPABASE_SECRET_KEY", ".env")],
      ["Stored demo documents", h("b", {}, n), "Upload EOBs"],
      ["Demo stamp (real EOBs are refused)", [h("span", { class: "chip" }, DEMO_MARKER), " ", h("span", { class: "chip" }, DEMO_FOOTER)], where("DEMO_MARKER / DEMO_FOOTER")],
    ]),
    h("div", { class: "clear-row" },
      h("button", { class: "btn danger clear-demo", type: "button", ...(n ? {} : { disabled: "" }), onclick: ask }, "Clear demo data"),
      h("span", { class: "muted small" }, "Deletes every uploaded demo document and its PDF, for a fresh demo.")),
    confirmBox,
  );
}
