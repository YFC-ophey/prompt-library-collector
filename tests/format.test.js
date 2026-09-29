import test from "node:test";
import assert from "node:assert/strict";
import { blocksForItem } from "../notion.js";
import { entryMarkdown, groupedMarkdown, isDuplicate, pageIdFromInput, sitePattern } from "../shared.js";
import { organizeFile } from "../file-store.js";

const item = {
  id: "capture-1", title: "Prompt #1", url: "https://example.com/prompts", createdAt: "2026-09-28T10:00:00.000Z",
  text: "You are an assistant. Return a concise summary."
};

test("Markdown preserves metadata and uses a safe code fence", () => {
  const result = entryMarkdown({ ...item, text: "Use ``` inside this prompt." });
  assert.match(result, /<!-- prompt-id: capture-1 -->/);
  assert.match(result, /Source: <https:\/\/example.com\/prompts>/);
  assert.match(result, /````text\nUse ``` inside this prompt\.\n````/);
});

test("Markdown groups pages and cases into nested Obsidian callouts", () => {
  const result = groupedMarkdown([
    { ...item, title: "Blind Spot Pass · Example 1", pageTitle: "A Field Guide", text: "Use ``` inside this prompt." },
    { ...item, id: "capture-2", title: "Blind Spot Pass · Example 2" },
    { ...item, id: "capture-3", title: "Interviews · Example 1" },
    { ...item, id: "capture-4", url: "https://other.example/notes", pageTitle: "Other page" }
  ]);
  assert.equal((result.match(/\[!summary\]-/g) || []).length, 2);
  assert.match(result, /> \[!summary\]- A Field Guide \(3 prompts\)/);
  assert.match(result, /> > \[!example\]- Blind Spot Pass \(2\)/);
  assert.match(result, /> \[!summary\]- Other page \(1 prompt\)/);
  assert.match(result, /> > ````text\n> > Use ``` inside this prompt\.\n> > ````/);
});

test("custom titles label webpage and case callouts", () => {
  const result = groupedMarkdown([{ ...item, title: "Blind Spot Pass · Example 1", pageTitle: "X", displayPageTitle: "A Field Guide to Fable", caseDisplayTitle: "Find hidden assumptions" }]);
  assert.match(result, /> \[!summary\]- A Field Guide to Fable \(1 prompt\)/);
  assert.match(result, /> > \[!example\]- Find hidden assumptions \(1\)/);
});

test("legacy Markdown migration preserves unrelated text and is repeatable", async () => {
  let contents = `# Prompt Library\n\nA note I wrote myself.\n${entryMarkdown(item)}`;
  const handle = {
    queryPermission: async () => "granted",
    getFile: async () => ({ text: async () => contents }),
    createWritable: async () => ({ write: async value => { contents = value; }, close: async () => {}, abort: async () => {} })
  };
  await organizeFile(handle, [item]);
  assert.match(contents, /A note I wrote myself/);
  assert.equal((contents.match(/<!-- prompt-id: capture-1 -->/g) || []).length, 1);
  assert.match(contents, /\[!summary\]-/);
  const first = contents;
  await organizeFile(handle, [item]);
  assert.equal(contents, first);
});

test("Notion blocks split long prompts below text limits", () => {
  const blocks = blocksForItem({ ...item, text: "a".repeat(4100) });
  assert.equal(blocks.filter(block => block.type === "code").length, 3);
  assert.ok(blocks.every(block => (block[block.type].rich_text || []).every(part => part.text.content.length <= 1900)));
});

test("deduplication uses normalized text", () => {
  assert.equal(isDuplicate([item], { text: "  You are an assistant.  Return a concise summary. " }), true);
});

test("Notion page URLs and IDs normalize", () => {
  assert.equal(pageIdFromInput("https://www.notion.so/Prompt-Library-1234567890abcdef1234567890abcdef"), "12345678-90ab-cdef-1234-567890abcdef");
  assert.equal(sitePattern("https://example.com/one?q=2"), "https://example.com/*");
});
