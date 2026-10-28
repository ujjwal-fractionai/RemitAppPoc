// app.js — the shell: hash routes, loading documents from the server, and the few actions that change them.
// Loaded by index.html as a module. Views live in dashboard.js, documents.js, doc.js, rules.js; they call back
// into setStage / retryAi / go exported here. Every document is re-analysed in the browser from its stored text
// (eob.js analyze + autoStage), so deadlines and rule changes are always current. Talks only to our own server (/api/*).
import * as pdfjs from "./vendor/pdf.min.mjs";
import { analyze, autoStage, DEMO_MARKER, NOT_DEMO, parseEob, readPdf } from "./eob.js";
import { $, h } from "./ui.js";
import { renderDashboard } from "./dashboard.js";
import { renderDoc } from "./doc.js";
import { renderDocuments } from "./documents.js";
import { renderRules } from "./rules.js";

pdfjs.GlobalWorkerOptions.workerSrc = "./vendor/pdf.worker.min.mjs";

// Entry = { row: stored documents row, r: analyze() result, stage: "mismatch" | "action" | "ready" | "reviewed" }
export const state = { docs: [] };

// Fetch our API. A 401 means the session ended (12 h, Lock, or a server restart): say so instead of failing silently.
export async function api(path, opts = {}) {
  const res = await fetch(path, opts);
  const body = await res.json().catch(() => ({}));
  if (res.status === 401) banner("Locked. Reload and enter the passcode.");
  if (!res.ok) throw Object.assign(new Error(body.error ?? res.statusText), { status: res.status });
  return body;
}
export function banner(text) {
  $("banner").replaceChildren(...(text ? [h("div", { class: "banner", role: "alert" }, text)] : []));
}

const toEntry = (row) => {
  const r = analyze(parseEob(row.lines.flat()));
  return { row, r, stage: row.stage === "reviewed" ? "reviewed" : autoStage(r) };
};

// Reload all documents. While any AI summary is pending, check again every 4 s (one timer at a time).
let timer = null, lastSig = "";
export async function refresh() {
  clearTimeout(timer);
  try {
    state.docs = (await api("/api/docs")).map(toEntry);
  } catch (e) {
    if (e.status === 401) return; // api() already showed "Locked…"; polling again can't help until the passcode is re-entered
    banner(`Couldn't load documents (${e.message}). Retrying…`); // network blip or server restart: keep trying
    timer = setTimeout(refresh, 4000);
    return;
  }
  if ($("banner").textContent.startsWith("Couldn't load documents")) banner(); // recovered
  // Only redraw when something visible changed, so polling doesn't reset an open document's expanded rows.
  const sig = state.docs.map((d) => `${d.row.id}:${d.stage}:${d.row.ai_status}`).join(",");
  if (sig !== lastSig) { lastSig = sig; render(); }
  if (state.docs.some((d) => d.row.ai_status === "pending")) timer = setTimeout(refresh, 4000);
}

export async function setStage(id, stage) {
  try { await api(`/api/docs/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ stage }) }); }
  catch (e) { return banner(e.message); }
  await refresh();
}
export async function retryAi(id) {
  try { await api(`/api/docs/${id}/ai`, { method: "POST" }); } catch (e) { return banner(e.message); }
  await refresh();
}
export const go = (hash) => { location.hash = hash; };

// ---- Upload: many PDFs at once, one by one, so cards appear as each lands and one bad file never stops the rest ----
let storeOk = false, uploading = false;
const queued = []; // files waiting; files dropped while an upload is running join this queue instead of being ignored
const input = $("file");
input.addEventListener("change", () => { uploadFiles([...input.files]); input.value = ""; });

// The "Upload EOBs" button used on the Dashboard and Documents views (a label for the single hidden file input).
export const uploadButton = () => h("label", {
  for: "file", class: `btn${storeOk ? "" : " disabled"}`, title: storeOk ? "Upload demo EOB PDFs" : "Supabase is not configured",
}, "⤒ Upload EOBs");

export async function uploadFiles(files) {
  if (!storeOk || !files.length) return;
  queued.push(...files);
  if (uploading) return; // the running loop below picks them up
  uploading = true;
  const t = { done: 0, dup: [], bad: [] };
  let i = 0;
  while (queued.length) {
    const f = queued.shift();
    i++;
    progress(`Processing ${i} of ${i + queued.length} · ${t.dup.length} duplicate skipped · ${t.bad.length} rejected`);
    try {
      const bytes = new Uint8Array(await f.arrayBuffer());
      let read;
      try { read = await readPdf(pdfjs, bytes.slice()); } catch { throw new Error("Not a readable PDF"); } // copy: pdf.js detaches its input
      if (read.subject !== DEMO_MARKER) throw new Error(NOT_DEMO); // fast check here; the server checks again (authoritative)
      await api("/api/docs", { method: "POST", headers: { "content-type": "application/pdf", "x-file-name": encodeURIComponent(f.name) }, body: bytes });
      t.done++;
      await refresh();
    } catch (e) {
      if (e.status === 409) t.dup.push(f.name);
      else t.bad.push([f.name, e.message]);
    }
  }
  progress(`Uploaded ${t.done} of ${i} · ${t.dup.length} duplicate skipped · ${t.bad.length} rejected`, t, true);
  uploading = false;
  await refresh();
}

function progress(text, t, finished) {
  $("progress").replaceChildren(h("section", { class: `card progress${finished ? " finished" : ""}`, role: "status" },
    h("div", { class: "card-head" }, h("b", {}, text),
      finished ? h("button", { class: "link", type: "button", onclick: () => $("progress").replaceChildren() }, "Dismiss") : h("span", { class: "spin", "aria-hidden": "true" })),
    finished && t.dup.length > 0 && h("p", { class: "muted small" }, `Already uploaded: ${t.dup.join(", ")}`),
    finished && t.bad.length > 0 && h("ul", { class: "rejected" }, t.bad.map(([name, why]) => h("li", {}, h("b", {}, name), ` — ${why}`))),
  ));
}

// Drop PDFs anywhere on the Dashboard or Documents view.
const main = document.querySelector("main");
main.addEventListener("dragover", (e) => { if (droppable()) { e.preventDefault(); main.classList.add("dropping"); } });
main.addEventListener("dragleave", (e) => { if (!main.contains(e.relatedTarget)) main.classList.remove("dropping"); });
main.addEventListener("drop", (e) => {
  main.classList.remove("dropping");
  if (!droppable()) return;
  e.preventDefault();
  uploadFiles([...e.dataTransfer.files]);
});
const droppable = () => storeOk && (!$("view-dashboard").hidden || !$("view-documents").hidden);

// Routes: #dashboard (default) · #documents · #documents/list · #doc/<id>[/<claimLabel>] · #rules
const VIEWS = ["dashboard", "documents", "doc", "rules"];
const reloadedFor = new Set(); // doc ids we already re-fetched the list for
function render() {
  const [view = "dashboard", id, sub] = location.hash.slice(1).split("/").map((s) => s || undefined);
  const current = VIEWS.includes(view) ? view : "dashboard";
  for (const v of VIEWS) $(`view-${v}`).hidden = v !== current;
  const navFor = current === "doc" ? "documents" : current;
  document.querySelectorAll(".nav-item[href^='#']").forEach((a) =>
    a.getAttribute("href") === `#${navFor}` ? a.setAttribute("aria-current", "page") : a.removeAttribute("aria-current"));
  $("nav-count").textContent = state.docs.length;

  if (current === "doc") {
    const entry = state.docs.find((d) => d.row.id === id);
    // A link to a document uploaded after our last load (e.g. by someone else): reload once before giving up.
    const firstMiss = !entry && !reloadedFor.has(id);
    if (firstMiss) { reloadedFor.add(id); refresh().then(render); }
    $("view-doc").replaceChildren(entry ? renderDoc(entry, sub)
      : h("p", { class: "muted" }, firstMiss ? "Loading document…" : "Document not found. It may have been cleared."));
  } else if (current === "rules") {
    renderRules(); // re-rendered each time so the stored-document count is current
  } else if (current === "documents") {
    $("view-documents").replaceChildren(renderDocuments(id === "list" ? "list" : "board"));
  } else {
    $("view-dashboard").replaceChildren(renderDashboard());
  }
}

addEventListener("hashchange", render);
render();
// Storage first: without Supabase there is nothing to load, so explain instead of erroring.
api("/api/config").then((c) => {
  storeOk = c.supabase === "ok";
  input.disabled = !storeOk;
  if (!storeOk) { banner(c.supabase === "not configured" ? "Supabase is not configured: see POC/supabase/schema.sql and .env"
    : "Supabase is unreachable: check the project is running and supabase/schema.sql was run"); render(); return; }
  render(); // enable the Upload buttons
  refresh();
}).catch((e) => banner(e.message));
