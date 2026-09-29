import { getFileHandle, appendToFile, organizeFile } from "./file-store.js";
import { appendNotionBlocks, caseToggle, legacyBlockIds, listNotionChildren, notionPageId, pageToggle, promptBlocks, setNotionBlockTrash, updateNotionToggleTitle } from "./notion.js";
import { caseName, isDuplicate, normalizePrompt, sitePattern } from "./shared.js";

const STORAGE_KEY = "collectorState";
let serial = Promise.resolve();

function queue(task) {
  const next = serial.then(task, task);
  serial = next.catch(() => {});
  return next;
}

async function getState() {
  const result = await chrome.storage.local.get(STORAGE_KEY);
  return { items: [], autoSites: [], notionToken: "", notionPageId: "", notionGroups: {}, archiveQueue: [], ...(result[STORAGE_KEY] || {}) };
}

async function putState(state) {
  await chrome.storage.local.set({ [STORAGE_KEY]: state });
}

function publicState(state) {
  const { notionToken, notionGroups, archiveQueue, ...rest } = state;
  return { ...rest, notionConnected: Boolean(notionToken && state.notionPageId) };
}

async function appendGroupedNotionItem(item, state) {
  const targetPageId = notionPageId(state);
  state.notionGroups ||= {};
  state.notionGroups[targetPageId] ||= {};
  let group = state.notionGroups[targetPageId][item.url];
  if (!group) {
    const response = await appendNotionBlocks(targetPageId, [pageToggle(item)], state);
    group = { id: response.results[0].id, cases: {} };
    state.notionGroups[targetPageId][item.url] = group;
    await putState(state);
  }
  const name = caseName(item);
  if (!group.cases[name]) {
    const response = await appendNotionBlocks(group.id, [caseToggle(item)], state);
    group.cases[name] = response.results[0].id;
  } else {
    await appendNotionBlocks(group.cases[name], promptBlocks(item), state);
  }
  item.notionStatus = "saved";
  item.notionFormat = "grouped";
  item.notionError = "";
  await putState(state);
}

async function organizeLibrary(state) {
  const legacy = state.items.filter(item => item.notionStatus === "saved" && item.notionFormat !== "grouped");
  if (state.notionToken && state.notionPageId && legacy.length && !state.archiveQueue.length) {
    const blocks = await listNotionChildren(notionPageId(state), state);
    state.archiveQueue = legacyBlockIds(blocks, legacy);
    // Check update access before creating any grouped blocks.
    await setNotionBlockTrash(state.archiveQueue[0], false, state);
    await putState(state);
  }
  await organizeFile(await getFileHandle(), state.items);
  for (const item of state.items) { item.fileStatus = "saved"; item.fileError = ""; }
  await putState(state);
  if (state.notionToken && state.notionPageId) {
    for (const item of state.items.filter(value => value.notionStatus === "saved" && value.notionFormat !== "grouped")) {
      await appendGroupedNotionItem(item, state);
    }
    while (state.archiveQueue.length) {
      await setNotionBlockTrash(state.archiveQueue[0], true, state);
      state.archiveQueue.shift();
      await putState(state);
      if (state.archiveQueue.length) await new Promise(resolve => setTimeout(resolve, 350));
    }
  }
  return publicState(state);
}

async function syncPending(state) {
  const fileItems = state.items.filter(item => item.fileStatus !== "saved");
  if (fileItems.length) {
    try {
      await appendToFile(await getFileHandle(), fileItems, state.items);
      for (const item of fileItems) { item.fileStatus = "saved"; item.fileError = ""; }
      await putState(state);
    } catch (error) {
      for (const item of fileItems) { item.fileStatus = "pending"; item.fileError = error.message; }
      await putState(state);
    }
  }
  if (state.notionToken && state.notionPageId) {
    for (const item of state.items.filter(value => value.notionStatus !== "saved")) {
      try {
        await appendGroupedNotionItem(item, state);
      } catch (error) {
        item.notionStatus = "pending";
        item.notionError = error.message;
        await putState(state);
        if (/HTTP 429/.test(error.message) || /rate limit/i.test(error.message)) break;
        continue;
      }
      await putState(state);
    }
  }
  return publicState(state);
}

async function setGroupTitle(message) {
  const state = await getState();
  const title = String(message.title || "").replace(/\s+/g, " ").trim();
  if (!title || title.length > 120) throw new Error("Enter a title of 1–120 characters.");
  const pageItems = state.items.filter(item => item.url === message.url);
  if (!pageItems.length) throw new Error("This webpage is not in your library.");
  let items;
  let blockId;
  if (message.scope === "page") {
    items = pageItems;
    blockId = state.notionGroups?.[notionPageIdIfConnected(state)]?.[message.url]?.id;
    for (const item of items) item.displayPageTitle = title;
  } else if (message.scope === "case") {
    items = pageItems.filter(item => caseName(item) === message.caseKey);
    if (!items.length) throw new Error("This case is not in your library.");
    blockId = state.notionGroups?.[notionPageIdIfConnected(state)]?.[message.url]?.cases?.[message.caseKey];
    for (const item of items) item.caseDisplayTitle = title;
  } else throw new Error("Unknown title type.");
  for (const item of items) item.fileStatus = "pending";
  await putState(state);
  const errors = [];
  try {
    await organizeFile(await getFileHandle(), state.items);
    for (const item of items) { item.fileStatus = "saved"; item.fileError = ""; }
  } catch (error) {
    for (const item of items) item.fileError = error.message;
    errors.push(`Markdown: ${error.message}`);
  }
  if (blockId && state.notionToken && state.notionPageId) {
    try { await updateNotionToggleTitle(blockId, title, state); }
    catch (error) { errors.push(`Notion: ${error.message}`); }
  }
  await putState(state);
  return { ...publicState(state), titleErrors: errors };
}

function notionPageIdIfConnected(state) {
  return state.notionPageId ? notionPageId(state) : "";
}

async function collect(message, auto = false) {
  const state = await getState();
  if (auto && !state.autoSites.includes(sitePattern(message.url))) return publicState(state);
  const raw = Array.isArray(message.candidates) ? message.candidates : [];
  const candidates = auto ? raw.filter(candidate => candidate.confidence === "high") : raw;
  let added = 0;
  for (const candidate of candidates.slice(0, 30)) {
    const text = normalizePrompt(candidate.text);
    if (text.length < 32 || text.length > 8000 || isDuplicate(state.items, { text })) continue;
    const previousPage = state.items.find(item => item.url === message.url);
    const previousCase = state.items.find(item => item.url === message.url && caseName(item) === caseName({ title: candidate.label || message.title }));
    state.items.push({
      id: crypto.randomUUID(), text, title: String(candidate.label || message.title || "Prompt").slice(0, 180),
      pageTitle: String(message.title || "").slice(0, 180),
      displayPageTitle: previousPage?.displayPageTitle || "", caseDisplayTitle: previousCase?.caseDisplayTitle || "",
      url: message.url, createdAt: new Date().toISOString(), fileStatus: "pending", notionStatus: "pending",
      fileError: "", notionError: ""
    });
    added++;
  }
  if (!added) return publicState(state);
  await putState(state);
  return syncPending(state);
}

async function handle(message) {
  if (message.type === "GET_STATE") return publicState(await getState());
  if (message.type === "AUTO_ENABLED") {
    const state = await getState();
    try { return { enabled: state.autoSites.includes(sitePattern(message.url)) }; }
    catch { return { enabled: false }; }
  }
  if (message.type === "AUTO_SCAN") return collect(message, true);
  if (message.type === "SAVE_CANDIDATES") return collect(message, false);
  if (message.type === "SYNC_PENDING") return syncPending(await getState());
  if (message.type === "ORGANIZE_LIBRARY") return organizeLibrary(await getState());
  if (message.type === "SET_GROUP_TITLE") return setGroupTitle(message);
  if (message.type === "PAGE_METADATA") {
    const state = await getState();
    const title = String(message.title || "").trim().slice(0, 180);
    if (title && !["X", "Twitter"].includes(title)) {
      for (const item of state.items.filter(value => value.url === message.url)) item.pageTitle = title;
      await putState(state);
    }
    return publicState(state);
  }
  if (message.type === "SET_NOTION") {
    const state = await getState();
    if (message.token) state.notionToken = String(message.token).trim();
    if (message.pageId) state.notionPageId = String(message.pageId).trim();
    await putState(state);
    return syncPending(state);
  }
  if (message.type === "CLEAR_NOTION") {
    const state = await getState();
    state.notionToken = "";
    state.notionPageId = "";
    await putState(state);
    return publicState(state);
  }
  if (message.type === "ADD_AUTO_SITE") {
    const pattern = sitePattern(message.url);
    const state = await getState();
    if (!state.autoSites.includes(pattern)) state.autoSites.push(pattern);
    await putState(state);
    return publicState(state);
  }
  if (message.type === "REMOVE_AUTO_SITE") {
    const pattern = sitePattern(message.url);
    const state = await getState();
    state.autoSites = state.autoSites.filter(value => value !== pattern);
    await putState(state);
    return publicState(state);
  }
  throw new Error("Unknown request.");
}

chrome.runtime.onInstalled.addListener(() => chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" }));
chrome.runtime.onStartup.addListener(() => chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" }));
chrome.runtime.onMessage.addListener((message, _sender, respond) => {
  queue(() => handle(message)).then(respond, error => respond({ error: error.message }));
  return true;
});
