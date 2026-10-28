// ui.js — small shared UI helpers and the bucket / stage vocabulary used by every view.
// Imported by app.js, doc.js, rules.js (and later documents.js, dashboard.js). No state, no network.
// h() builds DOM from text nodes only: nothing from a PDF, the database or the AI is ever parsed as HTML.
// tone = CSS color pair in index.html (--paid / --paid-bg, …)
export const BUCKETS = {
  PAID: { label: "Paid", icon: "✓", tone: "paid", help: "Payer paid. Only contractual write-off." },
  PARTIAL: { label: "Partial", icon: "½", tone: "partial", help: "Payer paid part. Patient owes the rest." },
  PATIENT_RESP: { label: "Patient owes", icon: "$", tone: "owes", help: "$0 from payer: deductible/copay. Not a denial." },
  NEXT_PAYER: { label: "Bill next payer", icon: "→", tone: "next", help: "Benefit maximum reached (e.g. PIP). Bill the health insurance." },
  DENIED: { label: "Denied", icon: "✕", tone: "denied", help: "Nobody pays. Fix and resubmit or appeal." },
  REVERSED: { label: "Reversed", icon: "↺", tone: "reversed", help: "Payer undid an earlier claim. See its correction." },
};
export const toneStyle = (t) => `--c:var(--${t});--c-bg:var(--${t}-bg)`;

// Builds DOM with text nodes only: nothing from the PDF or the AI is ever parsed as HTML.
export const h = (tag, props = {}, ...kids) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k === "style") el.style.cssText = v;
    else el.setAttribute(k, v);
  }
  el.append(...kids.flat(Infinity).filter((k) => k != null && k !== false).map((k) => (k instanceof Node ? k : String(k))));
  return el;
};
export const $ = (id) => document.getElementById(id);
export const sum = (xs, f) => xs.reduce((t, x) => t + f(x), 0);
export const pill = (tone, text) => h("span", { class: "badge", style: toneStyle(tone) }, h("span", { class: "dot" }), text);
export const badge = (b) => pill(BUCKETS[b].tone, BUCKETS[b].label);
export const card = (title, ...body) => h("section", { class: "card" }, title && h("h2", {}, title), body);
export const fmtDates = (l) => {
  const to = `${l.to.slice(0, 2)}/${l.to.slice(2, 4)}/${l.to.slice(4)}`;
  return l.from === l.to.slice(0, 4) ? to : `${l.from.slice(0, 2)}/${l.from.slice(2)}–${to}`;
};
export const kv = (label, value, tone) => h("div", {}, h("div", { class: "eyebrow" }, label), h("div", { class: `val ${tone ?? ""}` }, value));

// Board column → badge colour (labels come from eob.js STAGES).
export const STAGE_TONES = { mismatch: "partial", action: "denied", ready: "owes", reviewed: "paid" };
