// dashboard.js — the home view: totals across every uploaded EOB, "Needs attention" across every document not yet
// reviewed, where the money went, and the top denial reasons.
// Called by app.js render() for #dashboard. All numbers come from eob.js summarize / attentionItems (spec §10, §10a);
// this file only lays them out. Rows link to #doc/<id>/<claim> so staff land on the exact claim.
import { attentionItems, ATTENTION_ORDER, summarize, usd } from "./eob.js";
import { go, state, uploadButton } from "./app.js";
import { followUpPill } from "./doc.js";
import { card, h, pill, sum, toneStyle } from "./ui.js";

const TYPES = {
  mismatch: { label: "Doesn't add up", tone: "partial", tab: "mismatch" },
  denied: { label: "Denied", tone: "denied", tab: "denials" },
  denied_line: { label: "Denied line", tone: "denied", tab: "denials" },
  next_payer: { label: "Next payer", tone: "next", tab: "pip" },
  refund: { label: "Refund / adjust", tone: "paid", tab: "refunds" },
  unmatched: { label: "Unmatched reversal", tone: "reversed", tab: "mismatch" },
};
const TABS = [["all", "All"], ["denials", "Denials"], ["pip", "PIP / next payer"], ["refunds", "Refunds"], ["mismatch", "Mismatch"]];
let tab = "all";

export function renderDashboard() {
  if (!state.docs.length)
    return h("div", {}, head("No EOBs uploaded yet"),
      h("section", { class: "card empty" }, h("h2", {}, "No EOBs yet"), h("p", { class: "muted" }, "Upload demo files from POC/demo/batch-1 to start.")));
  const t = summarize(state.docs.map(({ r, stage }) => ({ r, stage })));
  const open = state.docs.filter((d) => d.stage !== "reviewed");
  const bills = sum(state.docs, ({ r }) => r.claims.filter((c) => c.bucket !== "REVERSED" && c.pr > 0).length);
  const items = open.flatMap((entry) => attentionItems(entry.r).map((i) => ({ ...i, entry })));

  return h("div", {},
    head(`${t.documents} EOB${t.documents === 1 ? "" : "s"} · ${t.claims} claims · demo data`),
    h("div", { class: "kpis" },
      kpi("documents", "Documents", t.documents, `${t.claims} claims`, "primary"),
      kpi("payerPaid", "Payer paid", usd(t.payerPaid), "what payers paid", "paid"),
      kpi("billPatients", "Bill patients", usd(t.billPatients), `${bills} claim${bills === 1 ? "" : "s"}`, "owes"),
      kpi("denied", "Denied", usd(t.denied), `${sum(items, (i) => (i.type === "denied" || i.type === "denied_line" ? 1 : 0))} open`, "denied"),
      kpi("nextPayer", "Bill next payer", usd(t.nextPayer), t.nearestDue ? followUpPill(t.nearestDue) : "nothing due", "next"),
      kpi("reviewed", "Reviewed", `${t.reviewed} / ${t.documents}`, "documents handled", "accent"),
    ),
    h("div", { class: "cols dash" }, attentionCard(items), moneyCard(t)),
  );
}

const head = (sub) => h("div", { class: "page-head" },
  h("div", {}, h("h1", {}, "Dashboard"), h("p", { class: "sub" }, sub)), uploadButton());

const kpi = (key, label, value, sub, tone) =>
  h("section", { class: "card kpi", "data-kpi": key, style: tone === "primary" || tone === "accent" ? "" : toneStyle(tone) },
    h("div", { class: "eyebrow" }, h("span", { class: "kdot" }), label),
    h("div", { class: "v" }, value),
    h("div", { class: "s" }, sub));

// "Needs attention": deadlines first (overdue, then due soon), then by type, then biggest amount.
function attentionCard(items) {
  const rank = (i) => [i.status === "overdue" ? 0 : i.status === "due soon" ? 1 : 2, ATTENTION_ORDER.indexOf(i.type), -(i.amount ?? 0)];
  const sorted = [...items].sort((a, b) => { const x = rank(a), y = rank(b); return x[0] - y[0] || x[1] - y[1] || x[2] - y[2]; });
  const shown = sorted.filter((i) => tab === "all" || TYPES[i.type].tab === tab);
  const el = h("section", { class: "card flush attention" },
    h("div", { class: "card-head pad" },
      h("h2", {}, "Needs attention"),
      h("div", { class: "tabs", role: "tablist" }, TABS.map(([key, label]) => {
        const n = key === "all" ? items.length : items.filter((i) => TYPES[i.type].tab === key).length;
        return h("button", { type: "button", role: "tab", class: key === tab ? "on" : "", "aria-selected": String(key === tab),
          onclick: () => { tab = key; el.replaceWith(attentionCard(items)); } }, `${label} ${n}`);
      })),
    ),
    !shown.length
      ? h("p", { class: "muted pad-x" }, items.length ? "Nothing in this group." : "Nothing needs attention. Mark documents reviewed once they're posted.")
      : h("div", { class: "table-wrap" }, h("table", {},
        h("thead", {}, h("tr", {}, ["Type", "Patient", "What to do", "Amount", "Due"].map((c, i) => h("th", { class: i === 3 ? "num" : "" }, c)))),
        h("tbody", {}, shown.map((i) => {
          const { row, r } = i.entry;
          const type = TYPES[i.type];
          return h("tr", { class: "claim att", "data-type": i.type, "data-doc": row.id, title: "Open this document",
            onclick: () => go(`#doc/${row.id}${i.claim ? `/${i.claim}` : ""}`) },
            h("td", {}, pill(type.tone, i.type === "next_payer" && r.pip ? "PIP exhausted" : type.label)),
            h("td", {}, h("span", { class: "name" }, i.name ?? "—"), h("div", { class: "muted small" }, `${row.file_name}${i.claim ? ` · ${i.claim}` : ""}`)),
            h("td", {}, i.text),
            h("td", { class: "num" }, i.amount == null ? "—" : usd(i.amount)),
            h("td", {}, i.status ? followUpPill(r.followUp) : "—"));
        })),
      )),
  );
  return el;
}

// Where the money went: one stacked bar (shares of the total) + legend, then the most common denial reasons.
function moneyCard(t) {
  const parts = [
    ["Payer paid", t.payerPaid, "var(--paid)"], ["Patients owe", t.billPatients, "var(--owes)"], ["Denied", t.denied, "var(--denied)"],
    ["Next payer", t.nextPayer, "var(--next)"], ["Contract write-off", t.writeOff, "#c9d2dd"],
  ];
  const total = sum(parts, (p) => Math.max(p[1], 0)) || 1;
  return card("Where the money went",
    h("div", { class: "bar", role: "img", "aria-label": parts.map(([l, v]) => `${l} ${usd(v)}`).join(", ") },
      parts.filter((p) => p[1] > 0).map(([l, v, c]) => h("span", { title: `${l}: ${usd(v)}`, style: `flex:${v / total};background:${c}` }))),
    h("div", { class: "legend" }, parts.flatMap(([l, v, c]) => [
      h("span", {}, h("span", { class: "kdot", style: `background:${c}` }), l), h("span", { class: "amt" }, usd(v))])),
    h("h4", {}, "Top denial reasons"),
    t.denialReasons.length
      ? h("div", { class: "legend" }, t.denialReasons.slice(0, 5).flatMap((d) => [
        h("span", {}, h("b", {}, d.code), " ", h("span", { class: "muted" }, d.text.split(/[.(]/)[0])), h("span", { class: "amt" }, d.count)]))
      : h("p", { class: "muted small" }, "No denials."),
  );
}
