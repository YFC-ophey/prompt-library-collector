export function normalizePrompt(value) {
  return String(value || "").replace(/\r\n?/g, "\n").replace(/[\t ]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

export function sitePattern(url) {
  const parsed = new URL(url);
  if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("Only web pages are supported.");
  return `${parsed.protocol}//${parsed.hostname}/*`;
}

export function pageIdFromInput(value) {
  const match = String(value || "").match(/[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}/i);
  if (!match) throw new Error("Enter a Notion page URL or page ID.");
  const raw = match[0].replaceAll("-", "").toLowerCase();
  return `${raw.slice(0, 8)}-${raw.slice(8, 12)}-${raw.slice(12, 16)}-${raw.slice(16, 20)}-${raw.slice(20)}`;
}

function safeHeading(value) {
  return String(value || "Untitled page").replace(/[\r\n]+/g, " ").replace(/[\\*_`\[\]#<>]/g, "").trim().slice(0, 120) || "Untitled page";
}

export function caseName(item) {
  const title = String(item.title || "Prompt").trim();
  return title.replace(/\s*·\s*(?:Example|Prompt)\s+\d+$/i, "").trim() || "Other prompts";
}

export function caseLabel(item) {
  return String(item.caseDisplayTitle || caseName(item)).replace(/\s+/g, " ").trim().slice(0, 180) || caseName(item);
}

export function promptName(item) {
  const title = String(item.title || "Prompt").trim();
  return title.match(/(?:Example|Prompt)\s+\d+$/i)?.[0] || "Prompt";
}

export function pageLabel(item) {
  const title = String(item.displayPageTitle || item.pageTitle || "").replace(/\s+/g, " ").trim();
  if (title && !["X", "Twitter"].includes(title)) return title.slice(0, 180);
  try {
    const url = new URL(item.url);
    return `${url.hostname}${url.pathname}`.slice(0, 180);
  } catch { return "Unknown webpage"; }
}

export const MANAGED_START = "<!-- prompt-library:begin -->";
export const MANAGED_END = "<!-- prompt-library:end -->";

function quote(text) {
  return String(text).split("\n").map(line => `> ${line}`).join("\n");
}

export function groupedMarkdown(items) {
  const pages = new Map();
  for (const item of items) {
    if (!pages.has(item.url)) pages.set(item.url, []);
    pages.get(item.url).push(item);
  }
  const sections = [];
  for (const [url, pageItems] of pages) {
    const cases = new Map();
    for (const item of pageItems) {
      const name = caseName(item);
      if (!cases.has(name)) cases.set(name, []);
      cases.get(name).push(item);
    }
    const source = encodeURI(url || "").replaceAll("<", "%3C").replaceAll(">", "%3E");
    const caseSections = [];
    for (const [name, caseItems] of cases) {
      const prompts = caseItems.map(item => {
        const prompt = String(item.text || "").trim();
        const longestTicks = Math.max(2, ...Array.from(prompt.matchAll(/`+/g), m => m[0].length));
        const fence = "`".repeat(longestTicks + 1);
        return `<!-- prompt-id: ${item.id} -->\n**${safeHeading(promptName(item))}** · Collected: ${item.createdAt}\n\n${fence}text\n${prompt}\n${fence}`;
      }).join("\n\n");
      caseSections.push(quote(`[!example]- ${safeHeading(caseLabel(caseItems[0]))} (${caseItems.length})\n\n${prompts}`));
    }
    sections.push(quote(`[!summary]- ${safeHeading(pageLabel(pageItems[0]))} (${pageItems.length} prompt${pageItems.length === 1 ? "" : "s"})\n\nSource: <${source}>\n\n${caseSections.join("\n\n")}`));
  }
  return `${MANAGED_START}\n${sections.join("\n\n")}\n${MANAGED_END}\n`;
}

export function entryMarkdown(item) {
  const prompt = String(item.text || "").trim();
  const longestTicks = Math.max(2, ...Array.from(prompt.matchAll(/`+/g), m => m[0].length));
  const fence = "`".repeat(longestTicks + 1);
  const source = encodeURI(item.url || "").replaceAll("<", "%3C").replaceAll(">", "%3E");
  return `\n<!-- prompt-id: ${item.id} -->\n## ${safeHeading(item.title)}\n\n- Source: <${source}>\n- Collected: ${item.createdAt}\n\n${fence}text\n${prompt}\n${fence}\n`;
}

export function isDuplicate(items, candidate) {
  const normalized = normalizePrompt(candidate.text);
  return items.some(item => normalizePrompt(item.text) === normalized);
}
