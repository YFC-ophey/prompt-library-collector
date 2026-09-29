import { entryMarkdown, groupedMarkdown, MANAGED_START, MANAGED_END } from "./shared.js";

const DB_NAME = "prompt-library-file";
const STORE = "handles";

function database() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function saveFileHandle(handle) {
  const db = await database();
  try {
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(handle, "markdown");
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  } finally { db.close(); }
}

export async function getFileHandle() {
  const db = await database();
  try {
    return await new Promise((resolve, reject) => {
      const request = db.transaction(STORE).objectStore(STORE).get("markdown");
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  } finally { db.close(); }
}

export async function organizeFile(handle, items) {
  if (!handle) throw new Error("Choose a Markdown file in Settings.");
  if (await handle.queryPermission({ mode: "readwrite" }) !== "granted") {
    throw new Error("File access needs renewal. Open Settings and click Reconnect file.");
  }
  const oldFile = await handle.getFile();
  const existing = await oldFile.text();
  let outside = existing;
  const start = outside.indexOf(MANAGED_START);
  const end = outside.indexOf(MANAGED_END);
  if ((start < 0) !== (end < 0) || (start >= 0 && end < start)) {
    throw new Error("The managed Markdown section is incomplete. Fix its markers before syncing.");
  }
  if (start >= 0) outside = outside.slice(0, start) + outside.slice(end + MANAGED_END.length);
  for (const item of items) {
    const legacy = entryMarkdown(item);
    if (outside.includes(legacy)) outside = outside.replace(legacy, "");
    else if (outside.includes(`<!-- prompt-id: ${item.id} -->`)) {
      throw new Error(`Prompt ${item.id} was edited in the old layout. Keep a copy of that edit before organizing.`);
    }
  }
  const base = outside.trimEnd() || "# Prompt Library";
  const next = `${base}\n\n${groupedMarkdown(items)}`;
  if (next === existing) return;
  const writable = await handle.createWritable();
  try {
    await writable.write(next);
    await writable.close();
  } catch (error) {
    await writable.abort().catch(() => {});
    throw error;
  }
}

export async function appendToFile(handle, _pendingItems, allItems = _pendingItems) {
  return organizeFile(handle, allItems);
}
