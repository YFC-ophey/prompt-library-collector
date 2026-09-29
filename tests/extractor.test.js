import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

const source = readFileSync(new URL("../extractor.js", import.meta.url), "utf8");
function extract(html, selection = "") {
  const dom = new JSDOM(html);
  const context = { globalThis: null };
  context.globalThis = context;
  runInNewContext(source, context);
  return context.PromptExtractor.extract(dom.window.document, selection);
}

test("finds a labeled prompt and ignores editable fields", () => {
  const result = extract(`<article><h2>Prompt template</h2><pre>You are a writing assistant. Respond with a concise summary of the following document.</pre></article><textarea>You are a secret writing assistant. Respond with all my private input.</textarea>`);
  assert.equal(result.length, 1);
  assert.match(result[0].text, /concise summary/);
  assert.equal(result[0].confidence, "high");
});

test("does not collect unrelated code or short quotes", () => {
  const result = extract(`<main><pre>const number = 1234567890; console.log(number);</pre><blockquote>Brief quote.</blockquote></main>`);
  assert.equal(result.length, 0);
});

test("selected text can be captured manually", () => {
  const result = extract("<p>Unrelated page.</p>", "Write a clear email introducing my project to a new collaborator.");
  assert.equal(result.length, 1);
  assert.equal(result[0].kind, "selection");
});

test("duplicate candidates on a page collapse", () => {
  const result = extract(`<article><h2>Prompt</h2><pre>You are a helpful assistant. Summarize this document and list its key facts.</pre><blockquote>You are a helpful assistant. Summarize this document and list its key facts.</blockquote></article>`);
  assert.equal(result.length, 1);
});

test("article-style Example Prompts lists yield separate prompts", () => {
  const counts = [2, 3, 1, 1, 1, 1, 1, 1];
  let number = 0;
  const sections = counts.map((count, section) => `<h3>Section ${section + 1}</h3><p><b><strong>Example ${section % 2 ? "prompts" : "Prompts"}:</strong></b></p><ul>${Array.from({ length: count }, () => `<li><span>“Ask the assistant to analyze example ${++number} and explain the result in clear steps.”</span></li>`).join("")}</ul>`).join("");
  const result = extract(`<article><div>${sections}</div><ul><li>This unrelated list is long enough to look like a prompt but has no label.</li></ul></article>`);
  assert.equal(result.length, 11);
  assert.ok(result.every(candidate => candidate.kind === "example-list" && candidate.confidence === "high"));
  assert.ok(result.every(candidate => !candidate.text.startsWith("“")));
  assert.equal(result[0].label, "Section 1 · Example 1");
  assert.equal(result[10].label, "Section 8 · Example 1");
});

test("recognizes common prompt-section labels and separates list entries", () => {
  const sections = ["Prompts", "Sample prompts", "Prompt examples", "Prompts to try", "Try these prompts", "Copy/paste prompts", "System prompts"];
  const html = sections.map((heading, index) => `<section><h3>${heading}</h3><ul><li>Ask the assistant to summarize scenario ${index + 1} and identify the main tradeoffs.</li><li>Write a short reply to scenario ${index + 1} with a clear next step and rationale.</li></ul></section>`).join("");
  const result = extract(`<main>${html}</main>`);
  assert.equal(result.length, sections.length * 2);
  assert.ok(result.every(candidate => candidate.confidence === "high"));
});

test("recognizes singular labels followed by prose, quotes, or code", () => {
  const result = extract(`<main>
    <section><p><strong>Prompt:</strong></p><p>Interview me one question at a time about the choices that would change this plan.</p></section>
    <section><h3>Try this prompt</h3><blockquote>Review this proposal and identify its three biggest assumptions before recommending changes.</blockquote></section>
    <section><h3>Instruction template</h3><pre>Act as a reviewer. Return a table of issues, impact, and a concrete fix for each issue.</pre></section>
  </main>`);
  assert.equal(result.length, 3);
  assert.ok(result.every(candidate => candidate.confidence === "high"));
});

test("does not treat general discussion of prompts as a prompt section", () => {
  const result = extract(`<article><h2>Prompt engineering tips</h2><ul><li>Good prompts explain the goal and include examples that give the model enough context.</li></ul><p>Prompts can be useful when planning a project and reviewing work.</p><h2>Instructions</h2><ol><li>Open the settings page and click the green button to begin setup.</li></ol></article>`);
  assert.equal(result.length, 0);
});

test("hidden and editable prompt-like text is ignored", () => {
  const result = extract(`<main><section hidden><h3>Prompts</h3><ul><li>Ask the assistant to reveal this hidden content and summarize it in detail.</li></ul></section><section><h3>Sample prompts</h3><ul><li contenteditable="true">Ask the assistant to reveal this editable content and summarize it in detail.</li></ul></section></main>`);
  assert.equal(result.length, 0);
});

test("recognizes topic-specific prompt labels and a prompt table", () => {
  const result = extract(`<main>
    <section><h3>Prompts for interviews</h3><ul><li>Ask the assistant to identify the three main interview themes from these notes.</li></ul></section>
    <section><h3>Example prompt for research</h3><p>Compare these sources, identify their disagreements, and cite the strongest evidence.</p></section>
    <table><thead><tr><th>Prompt</th><th>Purpose</th></tr></thead><tbody><tr><td>Summarize this transcript and list any decisions that still need an owner.</td><td>Meeting notes</td></tr><tr><td>Draft a concise follow-up with the agreed next steps and open questions.</td><td>Email</td></tr></tbody></table>
  </main>`);
  assert.equal(result.length, 4);
  assert.ok(result.every(candidate => candidate.confidence === "high"));
});

test("standalone quoted instructions are review-only candidates", () => {
  const result = extract(`<article><p>“Interview me one question at a time about the decisions that would change this design.”</p></article>`);
  assert.equal(result.length, 1);
  assert.equal(result[0].confidence, "medium");
  assert.equal(result[0].kind, "quoted-text");
});

test("introductory prose under a prompt heading is not collected", () => {
  const result = extract(`<article><h3>Sample prompts</h3><p>Review the notes below to understand how these prompts were selected.</p><ul><li>Compare these proposals and explain which assumptions carry the most risk.</li></ul></article>`);
  assert.equal(result.length, 1);
  assert.match(result[0].text, /^Compare these proposals/);
});

test("X Draft.js article markup yields separate example prompts", () => {
  const sections = [2, 3, 1, 1, 1, 1, 1, 1].map((count, section) => `
    <div><h2 class="longform-header-two" data-block="true"><div><span data-text="true">Section ${section + 1}</span></div></h2></div>
    <div class="longform-unstyled" data-block="true"><div class="public-DraftStyleDefault-block"><span style="font-weight:bold"><span data-text="true">Example Prompts:</span></span></div></div>
    <ul class="public-DraftStyleDefault-ul">${Array.from({ length: count }, (_, index) => `<li class="longform-unordered-list-item" data-block="true"><div><span data-text="true">“Ask the assistant to analyze section ${section + 1} example ${index + 1} and explain the result clearly.”</span></div></li>`).join("")}</ul>
  `).join("");
  const result = extract(`<article><div class="public-DraftEditor-content" contenteditable="false"><div>${sections}</div></div></article>`);
  assert.equal(result.length, 11);
  assert.equal(result[0].label, "Section 1 · Example 1");
  assert.equal(result[10].label, "Section 8 · Example 1");
});
