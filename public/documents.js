// documents.js — the Documents view: every uploaded EOB as a board (4 columns) or a list, with Mark reviewed / Reopen.
// Called by app.js render() for #documents and #documents/list. Columns come from each Entry's stage
// (eob.js autoStage, or "reviewed"); badges come from eob.js attentionItems. Changes go through app.js setStage.
import { attentionItems, mdy, STAGES, usd } from "./eob.js";
import { go, setStage, state, uploadButton } from "./app.js";
import { h, pill, STAGE_TONES, sum } from "./ui.js";

export function renderDocuments(mode) {
  return h("div", {},
    h("div", { class: "page-head" },
      h("div", {},
        h("h1", {}, "Documents"),
        h("p", { class: "sub" }, "New uploads are sorted automatically. Click Mark reviewed when a document is handled (Ready to Review: once it's posted)."),
      ),
      h("div", { class: "doc-actions" },
        h("nav", { class: "tabs", "aria-label": "View" },
          h("a", { href: "#documents/list", ...(mode === "list" ? { class: "on", "aria-current": "page" } : {}) }, "List"),
          h("a", { href: "#documents", ...(mode === "board" ? { class: "on", "aria-current": "page" } : {}) }, "Board")),
        uploadButton(),
      ),
    ),
    !state.docs.length
      ? h("section", { class: "card empty" }, h("h2", {}, "No EOBs yet"), h("p", { class: "muted" }, "Upload demo files from POC/demo/batch-1 to start."))
      : mode === "list" ? list() : board(),
  );
}

function board() {
  return h("div", { class: "board-wrap" }, h("div", { class: "board" }, Object.keys(STAGES).map((stage) => {
    const entries = state.docs.filter((d) => d.stage === stage);
    return h("section", { class: "col", "data-stage": stage },
      h("div", { class: "colh" }, STAGES[stage], stage !== "reviewed" && h("span", { class: "auto" }, "auto"), h("span", { class: "c" }, entries.length)),
      entries.map(card));
  })));
}

function card(entry) {
  const { row, r } = entry;
  return h("article", {
    class: "kcard", tabindex: "0", "data-file": row.file_name, title: "Open document",
    onclick: () => go(`#doc/${row.id}`), onkeydown: (e) => e.key === "Enter" && e.target === e.currentTarget && go(`#doc/${row.id}`), // not when Enter is on a button inside
  },
    h("div", { class: "t" }, r.payer, h("span", {}, usd(r.checkAmount))),
    h("div", { class: "m" }, `${row.file_name} · ${r.claims.length} claims`),
    h("div", { class: "bd" }, issueBadges(entry), row.ai_status === "pending" && pill("reversed", "AI…")),
    reviewControl(entry),
  );
}

// Mark reviewed / Reopen. Buttons sit inside clickable cards and rows, so they must not also open the document.
function reviewControl({ row, stage }) {
  const act = (next) => (e) => { e.stopPropagation(); setStage(row.id, next); };
  return stage === "reviewed"
    ? h("div", { class: "kfoot" }, h("span", { class: "muted small" }, `Reviewed ${new Date(row.stage_at).toLocaleDateString()}`),
        h("button", { class: "link reopen", type: "button", onclick: act(null) }, "Reopen"))
    : h("button", { class: "btn small-btn mark-reviewed", type: "button", onclick: act("reviewed") }, "✓ Mark reviewed");
}

// What's inside a document, at a glance (same items as the Dashboard's "Needs attention", plus patient bills).
export function issueBadges({ r }) {
  const items = attentionItems(r);
  const of = (...types) => items.filter((i) => types.includes(i.type));
  const out = [];
  for (const i of of("mismatch")) out.push(pill("partial", i.amount == null ? "doesn't balance" : `off by ${usd(i.amount)}`));
  const denials = of("denied", "denied_line").length;
  if (denials) out.push(pill("denied", `${denials} denial${denials > 1 ? "s" : ""}`));
  for (const i of of("next_payer")) {
    const days = i.due == null ? "" : i.status === "overdue" ? " · overdue" : ` · due ${mdy(i.due)}`;
    out.push(pill(i.status === "overdue" ? "denied" : i.status === "due soon" ? "partial" : "next", `${r.pip ? "PIP" : "Next payer"}${days}`));
  }
  const refunds = sum(of("refund"), (i) => i.amount);
  if (refunds) out.push(pill("paid", `refund ${usd(refunds)}`));
  const unmatched = of("unmatched").length;
  if (unmatched) out.push(pill("reversed", `${unmatched} unmatched`));
  const bills = r.claims.filter((c) => c.bucket !== "REVERSED" && c.pr > 0).length;
  if (bills) out.push(pill("owes", `${bills} patient bill${bills > 1 ? "s" : ""}`));
  if (!out.length) out.push(pill("paid", "all paid"));
  return out;
}

function list() {
  const head = ["Payer", "File", "Check date", "Check amount", "Claims", "Issues", "Stage", "", "Uploaded"];
  return h("section", { class: "card flush" }, h("div", { class: "table-wrap" }, h("table", { class: "doclist" },
    h("thead", {}, h("tr", {}, head.map((t, i) => h("th", { class: i === 3 || i === 4 ? "num" : "" }, t)))),
    h("tbody", {}, state.docs.map((e) => h("tr", { class: "claim", "data-file": e.row.file_name, onclick: () => go(`#doc/${e.row.id}`) },
      h("td", {}, h("span", { class: "name" }, e.r.payer)),
      h("td", {}, e.row.file_name),
      h("td", {}, e.r.header["CHECK DATE"] ?? "—"),
      h("td", { class: "num" }, usd(e.r.checkAmount)),
      h("td", { class: "num" }, e.r.claims.length),
      h("td", {}, h("div", { class: "bd" }, issueBadges(e))),
      h("td", {}, pill(STAGE_TONES[e.stage], STAGES[e.stage])),
      h("td", {}, reviewControl(e)),
      h("td", { class: "muted small" }, new Date(e.row.uploaded_at).toLocaleString()),
    ))),
  )));
}
