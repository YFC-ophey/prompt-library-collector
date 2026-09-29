import { getFileHandle, saveFileHandle } from "./file-store.js";
import { caseLabel, caseName, pageIdFromInput, pageLabel } from "./shared.js";

const $ = selector => document.querySelector(selector);
function message(type, payload = {}) {
  return chrome.runtime.sendMessage({ type, ...payload }).then(result => {
    if (result?.error) throw new Error(result.error);
    return result;
  });
}
function status(text, error = false) { $("#status").textContent = text; $("#status").classList.toggle("error", error); }

async function updateFileName() {
  const handle = await getFileHandle();
  $("#file-name").textContent = handle ? `${handle.name} · ${(await handle.queryPermission({ mode: "readwrite" })) === "granted" ? "connected" : "access needs renewal"}` : "No file selected";
  $("#reconnect-file").disabled = !handle;
}

function render(state) {
  $("#notion-page").value = state.notionPageId || "";
  $("#notion-state").textContent = state.notionConnected ? "Notion connection saved" : "Not connected";
  $("#library-count").textContent = String(state.items.length);
  renderGroupTitles(state.items);
  const list = $("#library");
  list.replaceChildren();
  if (!state.items.length) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = "No prompts collected yet. Open a page and click the extension icon.";
    list.append(empty);
  }
  for (const item of [...state.items].reverse().slice(0, 50)) {
    const row = document.createElement("article");
    row.className = "library-item";
    const title = document.createElement("h3");
    title.textContent = item.title;
    const source = document.createElement("a");
    source.href = item.url;
    source.target = "_blank";
    source.rel = "noreferrer";
    source.textContent = new URL(item.url).hostname;
    const preview = document.createElement("p");
    preview.textContent = item.text;
    const badges = document.createElement("div");
    badges.className = "badges";
    for (const [name, value, error] of [["File", item.fileStatus, item.fileError], ["Notion", item.notionStatus, item.notionError]]) {
      const badge = document.createElement("span");
      badge.className = `badge ${value === "saved" ? "saved" : "pending"}`;
      badge.textContent = `${name}: ${value}${error ? ` · ${error}` : ""}`;
      badges.append(badge);
    }
    row.append(title, source, preview, badges);
    list.append(row);
  }
}

function titleEditor(label, value, payload) {
  const row = document.createElement("div");
  row.className = "title-row";
  const caption = document.createElement("label");
  caption.textContent = label;
  const input = document.createElement("input");
  input.type = "text";
  input.maxLength = 120;
  input.value = value;
  input.setAttribute("aria-label", `${label} title`);
  const save = document.createElement("button");
  save.className = "secondary";
  save.textContent = "Save title";
  const apply = async () => {
    save.disabled = true;
    try {
      const state = await message("SET_GROUP_TITLE", { ...payload, title: input.value });
      render(state);
      status(state.titleErrors?.length ? `Title saved in library. ${state.titleErrors.join(" ")}` : "Title updated in Markdown and Notion.", Boolean(state.titleErrors?.length));
    } catch (error) { status(error.message, true); }
    finally { save.disabled = false; }
  };
  save.addEventListener("click", apply);
  input.addEventListener("keydown", event => { if (event.key === "Enter") apply(); });
  row.append(caption, input, save);
  return row;
}

function renderGroupTitles(items) {
  const container = $("#group-titles");
  container.replaceChildren();
  if (!items.length) return;
  const heading = document.createElement("h3");
  heading.textContent = "Expandable group titles";
  const help = document.createElement("p");
  help.textContent = "Give each webpage and case a clear title. Saved titles appear in the Markdown callouts and Notion toggles.";
  container.append(heading, help);
  const pages = new Map();
  for (const item of items) {
    if (!pages.has(item.url)) pages.set(item.url, []);
    pages.get(item.url).push(item);
  }
  for (const [url, pageItems] of pages) {
    const group = document.createElement("div");
    group.className = "title-group";
    const source = document.createElement("a");
    source.href = url;
    source.target = "_blank";
    source.rel = "noreferrer";
    source.textContent = url;
    group.append(source, titleEditor("Webpage", pageLabel(pageItems[0]), { scope: "page", url }));
    const cases = new Map();
    for (const item of pageItems) if (!cases.has(caseName(item))) cases.set(caseName(item), item);
    for (const [caseKey, item] of cases) {
      group.append(titleEditor("Case", caseLabel(item), { scope: "case", url, caseKey }));
    }
    container.append(group);
  }
}

async function chooseFile() {
  try {
    const handle = await window.showSaveFilePicker({
      suggestedName: "prompt-library.md",
      types: [{ description: "Markdown", accept: { "text/markdown": [".md"] } }]
    });
    await saveFileHandle(handle);
    await updateFileName();
    const state = await message("SYNC_PENDING");
    render(state);
    status("Markdown file connected. Pending prompts were added.");
  } catch (error) {
    if (error.name !== "AbortError") status(error.message, true);
  }
}

async function reconnectFile() {
  try {
    const handle = await getFileHandle();
    if (!handle) return;
    const permission = await handle.requestPermission({ mode: "readwrite" });
    if (permission !== "granted") throw new Error("File access was not granted.");
    await updateFileName();
    render(await message("SYNC_PENDING"));
    status("File access renewed and pending prompts synced.");
  } catch (error) { status(error.message, true); }
}

async function saveNotion() {
  try {
    const pageId = pageIdFromInput($("#notion-page").value);
    const token = $("#notion-token").value.trim();
    const current = await message("GET_STATE");
    if (!token && !current.notionConnected) throw new Error("Enter the connection token.");
    render(await message("SET_NOTION", { pageId, token }));
    $("#notion-token").value = "";
    status("Notion settings saved. Check the badges below for sync results.");
  } catch (error) { status(error.message, true); }
}

async function initialize() {
  $("#choose-file").addEventListener("click", chooseFile);
  $("#reconnect-file").addEventListener("click", reconnectFile);
  $("#save-notion").addEventListener("click", saveNotion);
  $("#clear-notion").addEventListener("click", async () => {
    render(await message("CLEAR_NOTION"));
    status("Notion connection removed from this extension.");
  });
  $("#retry").addEventListener("click", async () => {
    status("Retrying pending prompts…");
    try { render(await message("SYNC_PENDING")); status("Sync attempt finished. Check the badges below."); }
    catch (error) { status(error.message, true); }
  });
  $("#organize").addEventListener("click", async () => {
    $("#organize").disabled = true;
    status("Grouping prompts by webpage and section…");
    try {
      render(await message("ORGANIZE_LIBRARY"));
      status("Markdown and Notion prompts are grouped by webpage and section.");
    } catch (error) { status(error.message, true); }
    finally { $("#organize").disabled = false; }
  });
  await updateFileName();
  render(await message("GET_STATE"));
}

initialize().catch(error => status(error.message, true));
