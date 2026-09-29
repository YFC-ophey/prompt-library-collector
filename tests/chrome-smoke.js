import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, rm, cp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const extensionPath = dirname(dirname(fileURLToPath(import.meta.url)));
const profile = await mkdtemp(join(tmpdir(), "prompt-collector-smoke-"));
const testExtension = join(profile, "extension");
await cp(extensionPath, testExtension, { recursive: true, filter: source => !source.includes("node_modules") && !source.includes(".git") && !source.includes("/dist/") });
const manifestPath = join(testExtension, "manifest.json");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
manifest.host_permissions.push("http://127.0.0.1/*");
await writeFile(manifestPath, JSON.stringify(manifest));
const html = `<!doctype html><title>Example Prompts</title><article><h2>Prompt template</h2><pre>You are a helpful editor. Rewrite the following message in a clear, concise tone and return only the edited text.</pre></article>`;
const secondHtml = `<!doctype html><title>More Prompts</title><article><h2>Prompt template</h2><pre>You are a travel planner. Create a three day itinerary for a first-time visitor, with a morning and afternoon activity each day.</pre></article>`;
const articleHtml = `<!doctype html><title>Article with examples</title><article><div>${[2, 3, 1, 1, 1, 1, 1, 1].map((count, section) => `<h3>Section ${section + 1}</h3><p><b><strong>Example Prompts:</strong></b></p><ul>${Array.from({ length: count }, (_, index) => `<li><span>“Ask the assistant to study section ${section + 1} example ${index + 1} and explain the answer in plain language.”</span></li>`).join("")}</ul>`).join("")}</div></article>`;
const xArticleHtml = `<!doctype html><title>X</title><meta property="og:title" content="X"><article><h1>A Field Guide to Fable: Finding Your Unknowns</h1><div class="public-DraftEditor-content" contenteditable="false"><div>${[2, 3, 1, 1, 1, 1, 1, 1].map((count, section) => `<div><h2 class="longform-header-two" data-block="true"><div><span data-text="true">Section ${section + 1}</span></div></h2></div><div class="longform-unstyled" data-block="true"><div class="public-DraftStyleDefault-block"><span style="font-weight:bold"><span data-text="true">Example Prompts:</span></span></div></div><ul class="public-DraftStyleDefault-ul">${Array.from({ length: count }, (_, index) => `<li class="longform-unordered-list-item" data-block="true"><div><span data-text="true">“Ask the assistant to analyze section ${section + 1} example ${index + 1} and explain the result clearly.”</span></div></li>`).join("")}</ul>`).join("")}</div></article>`;
const labelsHtml = `<!doctype html><title>Prompt formats</title><main><section><h3>Sample prompts</h3><ul><li>Ask the assistant to compare these two plans and explain the most important tradeoff.</li></ul></section><section><h3>Prompt for research</h3><p>Review these sources and identify gaps in the evidence before drafting a conclusion.</p></section><table><tr><th>Prompt</th><th>Use</th></tr><tr><td>Summarize this transcript and list each decision with its owner and due date.</td><td>Notes</td></tr></table></main>`;
const server = createServer((request, response) => { response.setHeader("Content-Type", "text/html"); response.end(request.url === "/second" ? secondHtml : request.url === "/article" ? articleHtml : request.url === "/x-article" ? xArticleHtml : request.url === "/labels" ? labelsHtml : html); });
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
let context;
try {
  context = await chromium.launchPersistentContext(profile, {
    headless: true,
    executablePath: process.env.CHROME_BIN || chromium.executablePath(),
    args: [`--disable-extensions-except=${testExtension}`, `--load-extension=${testExtension}`]
  });
  const worker = context.serviceWorkers()[0] || await context.waitForEvent("serviceworker", { timeout: 10000 });
  const id = new URL(worker.url()).hostname;
  const page = await context.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  const options = await context.newPage();
  await options.goto(`chrome-extension://${id}/options.html`);
  await assert.doesNotReject(() => options.locator("h1").getByText("Settings & library").waitFor());
  const result = await options.evaluate(async (url) => {
    const tabs = await chrome.tabs.query({});
    const target = tabs.find(tab => tab.url === url);
    if (!target) throw new Error(`Page tab not found: ${url}; tabs: ${tabs.map(tab => tab.url).join(", ")}`);
    await chrome.scripting.executeScript({ target: { tabId: target.id }, files: ["extractor.js", "content.js"] });
    const scan = await chrome.tabs.sendMessage(target.id, { type: "SCAN" });
    const saved = await chrome.runtime.sendMessage({ type: "SAVE_CANDIDATES", candidates: scan.candidates, title: scan.title, url: scan.url });
    return { scan, saved };
  }, page.url());
  assert.equal(result.scan.candidates.length, 1);
  assert.equal(result.saved.items.length, 1);
  assert.equal(result.saved.items[0].fileStatus, "pending");
  const articlePage = await context.newPage();
  await articlePage.goto(`http://127.0.0.1:${server.address().port}/article`);
  const articleCount = await options.evaluate(async (url) => {
    const tab = (await chrome.tabs.query({})).find(value => value.url === url);
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["extractor.js", "content.js"] });
    return (await chrome.tabs.sendMessage(tab.id, { type: "SCAN" })).candidates.length;
  }, articlePage.url());
  assert.equal(articleCount, 11);
  const xArticlePage = await context.newPage();
  await xArticlePage.goto(`http://127.0.0.1:${server.address().port}/x-article`);
  const xArticleScan = await options.evaluate(async (url) => {
    const tab = (await chrome.tabs.query({})).find(value => value.url === url);
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["extractor.js", "content.js"] });
    return chrome.tabs.sendMessage(tab.id, { type: "SCAN" });
  }, xArticlePage.url());
  assert.equal(xArticleScan.candidates.length, 11);
  assert.equal(xArticleScan.title, "A Field Guide to Fable: Finding Your Unknowns");
  assert.equal(xArticleScan.candidates[0].label, "Section 1 · Example 1");
  assert.equal(xArticleScan.candidates[10].label, "Section 8 · Example 1");
  assert.ok(xArticleScan.candidates.every(candidate => candidate.kind === "example-list" && candidate.confidence === "high"));
  const labelsPage = await context.newPage();
  await labelsPage.goto(`http://127.0.0.1:${server.address().port}/labels`);
  const labelsCount = await options.evaluate(async (url) => {
    const tab = (await chrome.tabs.query({})).find(value => value.url === url);
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["extractor.js", "content.js"] });
    return (await chrome.tabs.sendMessage(tab.id, { type: "SCAN" })).candidates.length;
  }, labelsPage.url());
  assert.equal(labelsCount, 3);
  const fileResult = await options.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    const handle = await root.getFileHandle("prompt-library.md", { create: true });
    const { saveFileHandle } = await import(chrome.runtime.getURL("file-store.js"));
    await saveFileHandle(handle);
    const state = await chrome.runtime.sendMessage({ type: "SYNC_PENDING" });
    return { state, markdown: await (await handle.getFile()).text() };
  });
  assert.equal(fileResult.state.items[0].fileStatus, "saved");
  assert.match(fileResult.markdown, /You are a helpful editor/);
  assert.match(fileResult.markdown, /<!-- prompt-id:/);
  assert.match(fileResult.markdown, /> \[!summary\]- Example Prompts \(1 prompt\)/);
  assert.match(fileResult.markdown, /> > \[!example\]- Prompt template \(1\)/);
  await options.reload();
  await options.locator(".title-group .title-row").first().locator("input").fill("Useful editing prompts");
  await options.locator(".title-group .title-row").first().getByRole("button", { name: "Save title" }).click();
  const titled = await options.evaluate(async () => {
    const state = await chrome.runtime.sendMessage({ type: "GET_STATE" });
    const handle = await (await navigator.storage.getDirectory()).getFileHandle("prompt-library.md");
    return { state, markdown: await (await handle.getFile()).text() };
  });
  assert.equal(titled.state.items[0].displayPageTitle, "Useful editing prompts");
  assert.match(titled.markdown, /> \[!summary\]- Useful editing prompts \(1 prompt\)/);
  await options.evaluate(async (url) => {
    const origin = new URL(url).origin;
    await chrome.scripting.registerContentScripts([{ id: "smoke-auto", matches: [`${origin}/*`], js: ["extractor.js", "content.js"], runAt: "document_idle" }]);
    await chrome.runtime.sendMessage({ type: "ADD_AUTO_SITE", url });
  }, page.url());
  const secondPage = await context.newPage();
  await secondPage.goto(`http://127.0.0.1:${server.address().port}/second`);
  await options.waitForFunction(async () => (await chrome.runtime.sendMessage({ type: "GET_STATE" })).items.length === 2);
  const autoResult = await options.evaluate(async () => {
    const state = await chrome.runtime.sendMessage({ type: "GET_STATE" });
    const handle = await (await navigator.storage.getDirectory()).getFileHandle("prompt-library.md");
    return { state, markdown: await (await handle.getFile()).text() };
  });
  assert.equal(autoResult.state.items[1].fileStatus, "saved");
  assert.match(autoResult.markdown, /You are a travel planner/);
  assert.equal((autoResult.markdown.match(/<!-- prompt-library:begin -->/g) || []).length, 1);
  assert.equal((autoResult.markdown.match(/\[!summary\]-/g) || []).length, 2);
  await options.reload();
  await options.locator("#library-count").getByText("2").waitFor();
  if (process.env.SCREENSHOT_PATH) await options.screenshot({ path: process.env.SCREENSHOT_PATH, fullPage: true });
  console.log("Chrome smoke test passed: X Draft.js extraction, manual and auto capture, Markdown writes, and library display.");
} finally {
  await context?.close();
  await new Promise(resolve => server.close(resolve));
  await rm(profile, { recursive: true, force: true });
}
