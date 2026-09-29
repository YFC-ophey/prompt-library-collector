import { caseLabel, normalizePrompt, pageIdFromInput, pageLabel, promptName } from "./shared.js";

const VERSION = "2026-03-11";

function rich(content, link) {
  return { type: "text", text: { content: String(content).slice(0, 1900), ...(link ? { link: { url: link } } : {}) } };
}

function chunks(text, size = 1800) {
  const output = [];
  for (let i = 0; i < text.length; i += size) output.push(text.slice(i, i + size));
  return output;
}

function paragraph(content, link) {
  return { object: "block", type: "paragraph", paragraph: { rich_text: [rich(content, link)] } };
}

function codeBlocks(text) {
  return chunks(String(text || "").trim()).map(part => ({
    object: "block", type: "code", code: { rich_text: [rich(part)], language: "plain text" }
  }));
}

export function promptBlocks(item) {
  return [paragraph(`${promptName(item)} · Collected: ${item.createdAt} · ID: ${item.id}`), ...codeBlocks(item.text)];
}

export function caseToggle(item) {
  return { object: "block", type: "toggle", toggle: { rich_text: [rich(caseLabel(item))], children: promptBlocks(item) } };
}

export function pageToggle(item) {
  return { object: "block", type: "toggle", toggle: { rich_text: [rich(pageLabel(item))], children: [paragraph(`Source: ${item.url}`)] } };
}

// Used only to identify the flat blocks written by versions before 0.1.5.
export function blocksForItem(item) {
  const title = String(item.title || "Untitled page").replace(/\s+/g, " ").slice(0, 180);
  return [
    { object: "block", type: "heading_3", heading_3: { rich_text: [rich(title)] } },
    { object: "block", type: "paragraph", paragraph: { rich_text: [rich("Source: "), rich(item.url, item.url)] } },
    paragraph(`Collected: ${item.createdAt} · ID: ${item.id}`),
    ...codeBlocks(item.text)
  ];
}

async function request(settings, path, method, body, fetchFn = fetch) {
  if (!settings?.notionToken || !settings?.notionPageId) throw new Error("Connect a Notion page in Settings.");
  for (let attempt = 0; attempt < 5; attempt++) {
    const response = await fetchFn(`https://api.notion.com/v1/${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${settings.notionToken}`,
        "Notion-Version": VERSION,
        "Content-Type": "application/json"
      },
      ...(body ? { body: JSON.stringify(body) } : {})
    });
    if (response.status === 429 && attempt < 4) {
      const seconds = Number(response.headers?.get?.("Retry-After")) || 1;
      await new Promise(resolve => setTimeout(resolve, Math.min(seconds, 10) * 1000));
      continue;
    }
    if (!response.ok) {
      let result;
      try { result = await response.json(); } catch { result = {}; }
      throw new Error(`Notion HTTP ${response.status}: ${result.message || "Request failed"}`);
    }
    return response.json();
  }
}

export function notionPageId(settings) {
  return pageIdFromInput(settings.notionPageId);
}

export function appendNotionBlocks(parentId, blocks, settings, fetchFn = fetch) {
  return request(settings, `blocks/${parentId}/children`, "PATCH", { children: blocks }, fetchFn);
}

export async function listNotionChildren(parentId, settings, fetchFn = fetch) {
  const blocks = [];
  let cursor;
  do {
    const query = new URLSearchParams({ page_size: "100" });
    if (cursor) query.set("start_cursor", cursor);
    const result = await request(settings, `blocks/${parentId}/children?${query}`, "GET", null, fetchFn);
    blocks.push(...result.results);
    cursor = result.has_more ? result.next_cursor : null;
  } while (cursor);
  return blocks;
}

export function setNotionBlockTrash(blockId, inTrash, settings, fetchFn = fetch) {
  return request(settings, `blocks/${blockId}`, "PATCH", { in_trash: inTrash }, fetchFn);
}

export function updateNotionToggleTitle(blockId, title, settings, fetchFn = fetch) {
  return request(settings, `blocks/${blockId}`, "PATCH", { toggle: { rich_text: [rich(title)] } }, fetchFn);
}

function blockText(block) {
  return (block?.[block.type]?.rich_text || []).map(part => part.plain_text ?? part.text?.content ?? "").join("");
}

export function legacyBlockIds(blocks, items) {
  const ids = [];
  const used = new Set();
  for (const item of items) {
    const index = blocks.findIndex(block => block.type === "paragraph" && blockText(block).includes(`ID: ${item.id}`));
    if (index < 2) throw new Error(`Could not find the original Notion blocks for ${item.title}. No Notion changes were made.`);
    const sequence = blocks.slice(index - 2, index + 1 + chunks(String(item.text || "").trim()).length);
    const [heading, source, metadata, ...codes] = sequence;
    const valid = heading?.type === "heading_3" && blockText(heading) === item.title
      && source?.type === "paragraph" && blockText(source) === `Source: ${item.url}`
      && metadata?.type === "paragraph" && blockText(metadata).includes(`ID: ${item.id}`)
      && codes.every(block => block.type === "code")
      && normalizePrompt(codes.map(blockText).join("")) === normalizePrompt(item.text);
    if (!valid || sequence.some(block => !block?.id || used.has(block.id))) {
      throw new Error(`The original Notion blocks for ${item.title} have changed. No Notion changes were made.`);
    }
    sequence.forEach(block => { used.add(block.id); ids.push(block.id); });
  }
  return ids;
}
