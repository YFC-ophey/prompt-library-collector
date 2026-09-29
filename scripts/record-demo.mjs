import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const framesDir = join(root, "output", "playwright", "demo");
const mediaDir = join(root, "docs", "demo");
const profile = await mkdtemp(join(tmpdir(), "prompt-collector-demo-"));
const extension = join(profile, "extension");
await mkdir(framesDir, { recursive: true });
await mkdir(mediaDir, { recursive: true });
await cp(root, extension, {
  recursive: true,
  filter: source => !source.includes("node_modules") && !source.includes(".git") && !source.includes("/dist/")
    && !source.includes("/output/") && !source.includes("/docs/demo/")
});
const manifestPath = join(extension, "manifest.json");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
manifest.host_permissions.push("http://127.0.0.1/*");
await writeFile(manifestPath, JSON.stringify(manifest));

// These are short examples from the public X article. The page is local so this
// recording never needs a signed-in browser, a Notion token, or network access.
const examples = [
  ["Blind Spot Pass", [
    "I'm working on adding a new auth provider but I know nothing about the auth modules in this codebase. Can you do a blindspot pass to help me figure out my relevant unknown unknowns and help me prompt you better.",
    "I don’t know what color grading is but I need to grade this video. Can you teach me to understand my unknown unknowns about color grading, so that I can prompt better?"
  ]],
  ["Brainstorms and prototypes", [
    "I want a dashboard for this data but I have no visual taste and don't know what's possible. Make me an HTML page with 4 wildly different design directions so I can react to them."
  ]],
  ["Interviews", [
    "Interview me one question at a time about anything ambiguous, prioritize questions where my answer would change the architecture."
  ]]
];
const escapeHtml = value => String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
const articleHtml = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>A Field Guide to Fable: Finding Your Unknowns</title>
<style>
*{box-sizing:border-box}body{margin:0;background:#f6f7f3;color:#20322c;font:15px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}header{height:56px;background:#fff;border-bottom:1px solid #e3e9e2;display:flex;align-items:center;gap:12px;padding:0 31px;color:#376f55;font-size:12px;font-weight:750;letter-spacing:.08em}header b{font-size:24px;line-height:1}.wrap{max-width:700px;margin:0 auto;padding:28px 32px 80px}.eyebrow{color:#5d8869;font-size:11px;letter-spacing:.13em;font-weight:800;text-transform:uppercase}h1{font-size:32px;line-height:1.15;letter-spacing:-.04em;margin:9px 0 7px}h2{font-size:19px;letter-spacing:-.02em;margin:24px 0 7px}.sub{color:#688273;font-size:13px;margin:0 0 21px}.source{display:inline-block;color:#397457;font-size:11px;background:#e9f2e8;padding:5px 10px;border-radius:100px}.label{font-size:12px;color:#53745d;margin:6px 0 9px;font-weight:800}ul{list-style:none;margin:0;padding:0;display:grid;gap:9px}li{background:white;border:1px solid #e2e9df;border-radius:10px;padding:12px 14px;box-shadow:0 2px 10px #17312b09;font-size:12px;line-height:1.45}li:before{content:'“';font-size:20px;color:#77aa84;vertical-align:middle;margin-right:4px}
</style></head><body><header><b>✳</b> EXAMPLE ARTICLE</header><article class="wrap"><div class="eyebrow">Prompt patterns · public article example</div><h1>A Field Guide to Fable: <br>Finding Your Unknowns</h1><p class="sub">A repeatable local copy of prompt examples from the article by trq212.</p><a class="source" href="https://x.com/trq212/article/2073100352921215386?lang=en">View the original article ↗</a>${examples.map(([section, prompts]) => `<section><h2>${escapeHtml(section)}</h2><p class="label"><strong>Example Prompts:</strong></p><ul>${prompts.map(prompt => `<li>${escapeHtml(prompt)}</li>`).join("")}</ul></section>`).join("")}</article></body></html>`;
const server = createServer((_request, response) => {
  response.setHeader("Content-Type", "text/html; charset=utf-8");
  response.end(articleHtml);
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));

let context;
try {
  context = await chromium.launchPersistentContext(profile, {
    headless: true,
    executablePath: process.env.CHROME_BIN || chromium.executablePath(),
    viewport: { width: 760, height: 610 },
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`]
  });
  const worker = context.serviceWorkers()[0] || await context.waitForEvent("serviceworker", { timeout: 10000 });
  const extensionId = new URL(worker.url()).hostname;
  const article = await context.newPage();
  await article.goto(`http://127.0.0.1:${server.address().port}/`);
  const options = await context.newPage();
  await options.goto(`chrome-extension://${extensionId}/options.html`);
  await options.evaluate(async () => {
    const handle = await (await navigator.storage.getDirectory()).getFileHandle("prompt-library.md", { create: true });
    const { saveFileHandle } = await import(chrome.runtime.getURL("file-store.js"));
    await saveFileHandle(handle);
  });

  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  await article.bringToFront();
  await popup.reload();
  await assert.doesNotReject(() => popup.locator("#scan:not([disabled])").waitFor());
  await article.screenshot({ path: join(framesDir, "article.png") });
  await popup.locator("body").screenshot({ path: join(framesDir, "popup-before.png") });

  await popup.locator("#scan").click();
  await popup.locator("#status").getByText("4 candidates found.").waitFor();
  assert.equal(await popup.locator("#count").textContent(), "4");
  await popup.locator("body").screenshot({ path: join(framesDir, "popup-scanned.png") });

  await popup.locator("#save").click();
  await popup.locator("#status").getByText("4 new prompts collected.").waitFor();
  await popup.locator("body").screenshot({ path: join(framesDir, "popup-collected.png") });
  const { state, markdown } = await options.evaluate(async () => {
    const state = await chrome.runtime.sendMessage({ type: "GET_STATE" });
    const handle = await (await navigator.storage.getDirectory()).getFileHandle("prompt-library.md");
    return { state, markdown: await (await handle.getFile()).text() };
  });
  assert.equal(state.items.length, 4);
  assert.ok(state.items.every(item => item.fileStatus === "saved"));
  assert.match(markdown, /A Field Guide to Fable: Finding Your Unknowns \(4 prompts\)/);
  assert.equal((markdown.match(/\[!example\]-/g) || []).length, 3);
  await writeFile(join(framesDir, "generated-markdown.md"), markdown);

  const present = await context.newPage();
  await present.setViewportSize({ width: 1280, height: 830 });
  const articlePng = (await readFile(join(framesDir, "article.png"))).toString("base64");
  const popupPng = await Promise.all(["before", "scanned", "collected"].map(async name =>
    (await readFile(join(framesDir, `popup-${name}.png`))).toString("base64")));
  const source = `data:image/png;base64,${articlePng}`;
  const outputs = markdown.split("\n")
    .filter(line => /^> (?:> )?\[!(?:summary|example)\]-/.test(line))
    .map(line => line.replace(/^> (?:> )?/, ""));
  assert.equal(outputs.length, 4);
  const scenes = [
    { step: "01 / OPEN", title: "Find prompts on a page", caption: "Example sections from the public X article, reproduced locally for a safe demo.", popup: popupPng[0], active: 0 },
    { step: "02 / SCAN", title: "Scan this page", caption: "The extension finds four reviewable prompts across three cases.", popup: popupPng[1], active: 1 },
    { step: "03 / COLLECT", title: "Collect selected", caption: "Four prompts are saved to a local Markdown file. Notion sync is optional.", popup: popupPng[2], active: 2 },
    { step: "04 / ORGANIZE", title: "One page. Three collapsible cases.", caption: "Markdown callouts are grouped by webpage and case; Notion uses the same toggle structure when connected.", popup: popupPng[2], active: 3 }
  ];
  for (const [index, scene] of scenes.entries()) {
    const outputCard = `<div class="output"><div class="filebar"><span class="dot"></span> prompt-library.md <span class="saved">● SAVED</span></div><div class="tree">${outputs.map((line, lineIndex) => `<div class="tree-line ${lineIndex ? "indent" : ""}"><span class="chevron">▸</span>${escapeHtml(line.replace(/^\s*/, ""))}</div>`).join("")}</div><div class="footnote">4 prompts · 3 cases · 1 webpage</div></div>`;
    await present.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>
*{box-sizing:border-box}body{margin:0;background:#f3f6f0;color:#17312b;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}.canvas{width:1280px;height:720px;padding:26px 39px 24px;background:radial-gradient(circle at 12% 0%,#ecf5e5 0,transparent 45%),#f3f6f0;position:relative}.brand{display:flex;align-items:center;gap:9px;color:#215d43;font-size:12px;font-weight:800;letter-spacing:.13em}.mark{background:#205d47;color:#e6ffdf;width:26px;height:26px;border-radius:8px;display:grid;place-items:center;font-size:19px;letter-spacing:0}.step{position:absolute;right:40px;top:32px;font-size:12px;font-weight:800;letter-spacing:.14em;color:#6a8c72}.headline{font-size:35px;font-weight:800;letter-spacing:-.045em;margin:15px 0 5px}.caption{font-size:15px;color:#5d7563;margin:0}.stage{display:grid;grid-template-columns:742px 430px;gap:24px;margin-top:20px;height:490px}.window{background:#fff;border:1px solid #dae6d9;border-radius:15px;overflow:hidden;box-shadow:0 17px 40px #2449311d}.chrome{height:31px;border-bottom:1px solid #e3e9e4;background:#fbfcfa;display:flex;align-items:center;gap:5px;padding:0 13px;color:#7b9180;font-size:11px}.chrome .circle{height:7px;width:7px;border-radius:50%;background:#cfddcf}.chrome .url{margin-left:8px}.article{height:459px;width:742px;object-fit:cover;object-position:top left}.popup-wrap{padding:0;background:#f8faf7}.popup-shot{width:420px;height:auto;display:block}.popup-title{height:31px}.output{height:459px;background:#fbfdf9;padding:21px 18px}.filebar{background:#fff;border:1px solid #e2ebe0;border-radius:10px;padding:12px 14px;color:#254c37;font-size:14px;font-weight:750}.dot{display:inline-block;width:8px;height:8px;border-radius:50%;background:#68a578;margin-right:7px}.saved{float:right;color:#49935f;font-size:10px;letter-spacing:.1em}.tree{margin-top:17px;border-left:2px solid #dcebdc;padding-left:12px}.tree-line{padding:13px 10px;border-bottom:1px solid #e5ece3;font-size:13px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.tree-line.indent{margin-left:21px;font-weight:600;color:#42644f}.chevron{color:#4d8a5f;margin-right:8px}.footnote{margin:25px 0 0;color:#72927a;font-size:12px}.timeline{display:flex;gap:8px;position:absolute;left:40px;right:40px;bottom:23px}.pill{flex:1;height:5px;border-radius:10px;background:#dbe7d9}.pill.active{background:#287052}
.canvas{height:830px}.stage{height:600px}.article,.output{height:569px}.popup-shot{width:385px;margin:0 auto}
</style></head><body><div class="canvas"><div class="brand"><span class="mark">✳</span> PROMPT LIBRARY COLLECTOR</div><div class="step">${scene.step}</div><h1 class="headline">${escapeHtml(scene.title)}</h1><p class="caption">${escapeHtml(scene.caption)}</p><div class="stage"><div class="window"><div class="chrome"><i class="circle"></i><i class="circle"></i><i class="circle"></i><span class="url">${index === 3 ? "Local Markdown output" : "Example article · based on x.com/trq212"}</span></div>${index === 3 ? outputCard : `<img class="article" src="${source}" alt="Public article example">`}</div><div class="window popup-wrap"><div class="chrome popup-title"><i class="circle"></i><i class="circle"></i><i class="circle"></i><span class="url">Prompt Library Collector</span></div><img class="popup-shot" src="data:image/png;base64,${scene.popup}" alt="Actual extension popup"></div></div><div class="timeline">${scenes.map((_, n) => `<span class="pill ${n <= scene.active ? "active" : ""}"></span>`).join("")}</div></div></body></html>`);
    await present.screenshot({ path: join(framesDir, `scene-${index + 1}.png`) });
  }
} finally {
  await context?.close();
  await new Promise(resolve => server.close(resolve));
  await rm(profile, { recursive: true, force: true });
}

// Frame holds make the GIF legible in GitHub's README while keeping it small.
const framePaths = [1, 2, 3, 4].map(n => join(framesDir, `scene-${n}.png`));
const concat = framePaths.map((path, index) => `file '${path}'\nduration ${[1.6, 2.2, 2.0, 2.8][index]}`).join("\n") + `\nfile '${framePaths.at(-1)}'\n`;
await writeFile(join(framesDir, "frames.txt"), concat);
const mp4 = join(mediaDir, "prompt-library-demo.mp4");
const gif = join(mediaDir, "prompt-library-demo.gif");
for (const [args, label] of [
  [["-y", "-f", "concat", "-safe", "0", "-i", join(framesDir, "frames.txt"), "-vf", "fps=12,format=yuv420p", "-movflags", "+faststart", "-pix_fmt", "yuv420p", mp4], "MP4"],
  [["-y", "-f", "concat", "-safe", "0", "-i", join(framesDir, "frames.txt"), "-vf", "fps=6,split[a][b];[a]palettegen=max_colors=256[p];[b][p]paletteuse=dither=none", "-loop", "0", gif], "GIF"]
]) {
  const result = spawnSync("ffmpeg", args, { encoding: "utf8" });
  if (result.status !== 0) throw new Error(`${label} export failed: ${result.stderr.slice(-3000)}`);
}
console.log(`Demo recorded from the extension.\n${gif}\n${mp4}`);
