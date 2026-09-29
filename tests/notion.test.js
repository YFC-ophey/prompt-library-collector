import test from "node:test";
import assert from "node:assert/strict";
import { appendNotionBlocks, blocksForItem, caseToggle, legacyBlockIds, listNotionChildren, pageToggle, promptBlocks, setNotionBlockTrash, updateNotionToggleTitle } from "../notion.js";

const item = {
  id: "abc", title: "Blind Spot Pass · Example 1", pageTitle: "A Field Guide",
  url: "https://example.com/prompt", createdAt: "2026-09-28T10:00:00Z",
  text: "You are a helpful editor. Rewrite this email clearly."
};
const settings = { notionToken: "test-token", notionPageId: "1234567890abcdef1234567890abcdef" };

test("Notion page and case toggles nest prompts under one source", async () => {
  const calls = [];
  const fetchFn = async (url, options) => {
    calls.push({ url, options });
    return { ok: true, json: async () => ({ results: [{ id: "new-block" }] }) };
  };
  await appendNotionBlocks("12345678-90ab-cdef-1234-567890abcdef", [pageToggle(item)], settings, fetchFn);
  await appendNotionBlocks("new-block", [caseToggle(item)], settings, fetchFn);
  assert.equal(calls[0].url, "https://api.notion.com/v1/blocks/12345678-90ab-cdef-1234-567890abcdef/children");
  assert.equal(calls[0].options.headers["Notion-Version"], "2026-03-11");
  assert.equal(JSON.parse(calls[0].options.body).children[0].toggle.rich_text[0].text.content, "A Field Guide");
  const nested = JSON.parse(calls[1].options.body).children[0];
  assert.equal(nested.toggle.rich_text[0].text.content, "Blind Spot Pass");
  assert.match(nested.toggle.children[0].paragraph.rich_text[0].text.content, /ID: abc/);
  assert.equal(nested.toggle.children[1].code.rich_text[0].text.content, item.text);
});

test("Notion toggle titles can be updated in place", async () => {
  const calls = [];
  const fetchFn = async (url, options) => {
    calls.push({ url, options });
    return { ok: true, json: async () => ({ id: "case-1" }) };
  };
  assert.equal(pageToggle({ ...item, displayPageTitle: "A Field Guide to Fable" }).toggle.rich_text[0].text.content, "A Field Guide to Fable");
  assert.equal(caseToggle({ ...item, caseDisplayTitle: "Find hidden assumptions" }).toggle.rich_text[0].text.content, "Find hidden assumptions");
  await updateNotionToggleTitle("case-1", "Find hidden assumptions", settings, fetchFn);
  assert.equal(calls[0].url, "https://api.notion.com/v1/blocks/case-1");
  assert.equal(calls[0].options.method, "PATCH");
  assert.deepEqual(JSON.parse(calls[0].options.body), { toggle: { rich_text: [{ type: "text", text: { content: "Find hidden assumptions" } }] } });
});

test("long prompt blocks respect Notion text limits", () => {
  const blocks = promptBlocks({ ...item, text: "a".repeat(4100) });
  assert.equal(blocks.filter(block => block.type === "code").length, 3);
  assert.ok(blocks.every(block => (block[block.type].rich_text || []).every(part => part.text.content.length <= 1900)));
});

test("migration selects only exact legacy blocks and leaves unrelated blocks", () => {
  const blocks = [
    { id: "unrelated", type: "paragraph", paragraph: { rich_text: [{ plain_text: "My own note" }] } },
    ...blocksForItem(item).map((block, index) => ({ ...block, id: `old-${index}` }))
  ];
  assert.deepEqual(legacyBlockIds(blocks, [item]), ["old-0", "old-1", "old-2", "old-3"]);
  assert.throws(() => legacyBlockIds(blocks, [{ ...item, text: "Changed text" }]), /changed/);
});

test("Notion child listing paginates and errors are surfaced", async () => {
  let calls = 0;
  const fetchFn = async (url, options) => {
    calls++;
    assert.equal(options.method, "GET");
    return { ok: true, json: async () => calls === 1
      ? { results: [{ id: "one" }], has_more: true, next_cursor: "cursor" }
      : { results: [{ id: "two" }], has_more: false, next_cursor: null } };
  };
  assert.deepEqual((await listNotionChildren("page", settings, fetchFn)).map(block => block.id), ["one", "two"]);
  assert.equal(calls, 2);
  await assert.rejects(() => setNotionBlockTrash("old-0", true, settings, async () => ({
    ok: false, status: 403, json: async () => ({ message: "Update content capability required" })
  })), /Update content capability required/);
});
