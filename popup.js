import { sitePattern } from "./shared.js";

const $ = selector => document.querySelector(selector);
let tab;
let candidates = [];
let autoEnabled = false;
let scannedTitle = "";
const KIND_LABELS = {
  selection: "Selected text", "example-list": "Example list", "labeled-list": "Prompt list",
  "labeled-text": "Prompt text", "prompt-table": "Prompt table", "quoted-text": "Quoted text",
  pre: "Code block", blockquote: "Quote"
};

function message(type, payload = {}) {
  return chrome.runtime.sendMessage({ type, ...payload }).then(result => {
    if (result?.error) throw new Error(result.error);
    return result;
  });
}

function status(value, error = false) {
  $("#status").textContent = value;
  $("#status").classList.toggle("error", error);
}

function siteId(pattern) {
  let hash = 2166136261;
  for (const char of pattern) { hash ^= char.charCodeAt(0); hash = Math.imul(hash, 16777619); }
  return `auto-${hash >>> 0}`;
}

function updateAuto() {
  $("#auto").textContent = autoEnabled ? "Disable auto-collect" : "Enable auto-collect";
  $("#auto").classList.toggle("active", autoEnabled);
}

function renderCandidates() {
  $("#count").textContent = String(candidates.length);
  $("#select-all").hidden = candidates.length === 0;
  const list = $("#candidates");
  list.replaceChildren();
  if (!candidates.length) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = "No clear prompts found. Try selecting prompt text on the page and scanning again.";
    list.append(empty);
  }
  candidates.forEach((candidate, index) => {
    const label = document.createElement("label");
    label.className = "candidate";
    const check = document.createElement("input");
    check.type = "checkbox";
    check.checked = true;
    check.dataset.index = String(index);
    check.addEventListener("change", updateSave);
    const body = document.createElement("div");
    const heading = document.createElement("strong");
    heading.textContent = candidate.label;
    const detail = document.createElement("span");
    detail.className = "candidate-detail";
    detail.textContent = `${KIND_LABELS[candidate.kind] || "Page text"} · ${candidate.text.length} characters`;
    const preview = document.createElement("p");
    preview.textContent = candidate.text;
    body.append(heading, detail, preview);
    label.append(check, body);
    list.append(label);
  });
  updateSave();
}

function updateSave() {
  $("#save").disabled = !document.querySelector(".candidate input:checked");
}

async function ensureScript() {
  await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["extractor.js", "content.js"] });
}

async function scan() {
  $("#scan").disabled = true;
  try {
    status("Scanning page…");
    await ensureScript();
    let result;
    for (let attempt = 0; attempt < 3; attempt++) {
      result = await chrome.tabs.sendMessage(tab.id, { type: "SCAN" });
      if (result?.candidates?.length || attempt === 2) break;
      await new Promise(resolve => setTimeout(resolve, 700));
    }
    candidates = result?.candidates || [];
    scannedTitle = result?.title || tab.title;
    if (result?.url && scannedTitle) await message("PAGE_METADATA", { url: result.url, title: scannedTitle });
    renderCandidates();
    status(`${candidates.length} candidate${candidates.length === 1 ? "" : "s"} found.`);
  } catch (error) { status(error.message || "This page cannot be scanned.", true); }
  finally { $("#scan").disabled = false; }
}

async function toggleAuto() {
  try {
    const pattern = sitePattern(tab.url);
    const id = siteId(pattern);
    if (autoEnabled) {
      await chrome.tabs.sendMessage(tab.id, { type: "STOP_AUTO" }).catch(() => {});
      await chrome.scripting.unregisterContentScripts({ ids: [id] }).catch(() => {});
      await message("REMOVE_AUTO_SITE", { url: tab.url });
      await chrome.permissions.remove({ origins: [pattern] });
      autoEnabled = false;
      status("Auto-collect disabled for this site.");
    } else {
      const granted = await chrome.permissions.request({ origins: [pattern] });
      if (!granted) { status("Site access was not granted.", true); return; }
      const registered = await chrome.scripting.getRegisteredContentScripts({ ids: [id] });
      if (!registered.length) {
        await chrome.scripting.registerContentScripts([{ id, matches: [pattern], js: ["extractor.js", "content.js"], runAt: "document_idle", persistAcrossSessions: true }]);
      }
      await message("ADD_AUTO_SITE", { url: tab.url });
      autoEnabled = true;
      await ensureScript();
      await chrome.tabs.sendMessage(tab.id, { type: "START_AUTO" });
      status("Auto-collect enabled for this site.");
    }
    updateAuto();
  } catch (error) { status(error.message, true); }
}

async function saveSelected() {
  const selected = [...document.querySelectorAll(".candidate input:checked")].map(input => candidates[Number(input.dataset.index)]);
  if (!selected.length) return;
  try {
    $("#save").disabled = true;
    status("Collecting prompts…");
    const before = await message("GET_STATE");
    const result = await message("SAVE_CANDIDATES", { candidates: selected, url: tab.url, title: scannedTitle || tab.title });
    const added = result.items.length - before.items.length;
    status(added ? `${added} new prompt${added === 1 ? "" : "s"} collected.` : "These prompts are already in your library.");
    renderSummary(result);
  } catch (error) { status(error.message, true); }
  finally { updateSave(); }
}

function renderSummary(state) {
  const pendingFile = state.items.filter(item => item.fileStatus !== "saved").length;
  const pendingNotion = state.items.filter(item => item.notionStatus !== "saved").length;
  $("#summary").textContent = `${state.items.length} in library · ${pendingFile} awaiting file · ${pendingNotion} awaiting Notion`;
}

async function initialize() {
  $("#settings").addEventListener("click", () => chrome.runtime.openOptionsPage());
  $("#scan").addEventListener("click", scan);
  $("#auto").addEventListener("click", toggleAuto);
  $("#save").addEventListener("click", saveSelected);
  $("#select-all").addEventListener("click", () => {
    document.querySelectorAll(".candidate input").forEach(input => { input.checked = true; });
    updateSave();
  });
  const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
  tab = active;
  if (!tab?.url || !/^https?:/.test(tab.url)) {
    $("#page").textContent = "Open a web page to collect prompts";
    $("#scan").disabled = true;
    $("#auto").disabled = true;
    return;
  }
  $("#page").textContent = new URL(tab.url).hostname;
  const state = await message("GET_STATE");
  autoEnabled = state.autoSites.includes(sitePattern(tab.url));
  updateAuto();
  renderSummary(state);
}

initialize().catch(error => status(error.message, true));
