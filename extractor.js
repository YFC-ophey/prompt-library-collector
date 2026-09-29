(function (root) {
  const MIN = 32;
  const MAX = 8000;
  const CODE_HINT = /\b(act as|you are|your task|system prompt|write a|create a|generate a|respond with|answer as|given the|output format|summarize|review|interview me|compare|help me)\b/i;
  const PROMPT_START = /^(?:you are|act as|your task|ask|write|create|generate|explain|analyze|analyse|summarize|review|compare|interview me|draft|make|build|list|give me|help me|please|i want|i need|i'm working|i am working|here's my|given the|before|what if)\b/i;
  const LABEL_PATTERNS = [
    /^(?:(?:example|sample|suggested|starter|ready[- ]to[- ]use)\s+)?(?:prompts?|prompt templates?)(?:\s+(?:to try|to use|for (?:claude|chatgpt|the assistant)))?$/i,
    /^(?:(?:example|sample|suggested|system|user|developer)\s+)?instruction templates?$/i,
    /^(?:example|sample|suggested|system|user|developer) instructions?$/i,
    /^(?:prompt|instruction) examples?$/i,
    /^examples? of (?:prompts?|instructions?)$/i,
    /^(?:(?:example|sample|suggested|starter)\s+)?prompts?\s+(?:for|about|to)\s+.{3,50}$/i,
    /^try (?:this|these) prompts?$/i,
    /^try asking(?: (?:claude|chatgpt|the assistant))?$/i,
    /^copy\s*(?:\/|and|-)\s*paste prompts?$/i,
    /^(?:system|user|developer) (?:prompts?|messages?)$/i,
    /^(?:here(?:'s| is)|use) (?:this|a|the) prompt$/i,
    /^prompt\s*#?\d+$/i
  ];
  const EXCLUDED = "input, textarea, select, option, button, [contenteditable='true'], [contenteditable=''], [contenteditable='plaintext-only'], [role='textbox'], [role='button'], script, style, noscript, nav, footer, header";

  function clean(text) {
    return String(text || "").replace(/\r\n?/g, "\n").replace(/[\t ]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  }

  function visible(element) {
    if (!element || element.closest(EXCLUDED)) return false;
    for (let current = element; current; current = current.parentElement) {
      if (current.hasAttribute("hidden") || current.getAttribute("aria-hidden") === "true") return false;
      const style = current.ownerDocument.defaultView?.getComputedStyle(current);
      if (style && (style.display === "none" || style.visibility === "hidden")) return false;
    }
    return true;
  }

  function labelText(value) {
    const label = clean(value).replace(/[:：]\s*$/, "").trim();
    return label.length <= 90 && !label.includes("\n") && LABEL_PATTERNS.some(pattern => pattern.test(label)) ? label : "";
  }

  function promptLike(value) {
    const text = withoutOuterQuotes(value);
    return PROMPT_START.test(text);
  }

  function labelFor(element) {
    const parent = element.closest("section, article, li, div") || element.parentElement;
    const nearby = parent?.querySelector("h1, h2, h3, h4, strong, b, label");
    const label = clean(nearby?.textContent).slice(0, 100);
    return label;
  }

  function sectionFor(element, fallback) {
    for (let previous = element.previousElementSibling; previous; previous = previous.previousElementSibling) {
      const heading = /^H[1-6]$/.test(previous.tagName) ? previous : previous.querySelector("h1, h2, h3, h4, h5, h6");
      if (heading) return clean(heading.textContent).slice(0, 90);
    }
    return fallback;
  }

  function withoutOuterQuotes(value) {
    const text = clean(value);
    const pairs = [["“", "”"], ["‘", "’"], ['"', '"']];
    const pair = pairs.find(([start, end]) => text.startsWith(start) && text.endsWith(end));
    return pair ? text.slice(1, -1).trim() : text;
  }

  function extract(doc, selectionText = "") {
    const found = [];
    const seen = new Set();
    function add(text, label, confidence, kind) {
      const value = clean(text);
      if (value.length < MIN || value.length > MAX || seen.has(value)) return;
      seen.add(value);
      found.push({ text: value, label: clean(label).slice(0, 100) || "Prompt on page", confidence, kind });
    }

    if (selectionText) add(selectionText, "Selected text", "manual", "selection");
    const scannedLabels = new Set();
    for (const label of doc.querySelectorAll("p, h1, h2, h3, h4, h5, h6, strong, b, dt, summary, div[data-block='true']")) {
      const labelName = labelText(label.textContent);
      if (!visible(label) || !labelName) continue;
      const block = label.closest("[data-block='true']") || label.closest("p, h1, h2, h3, h4, h5, h6") || label;
      if (scannedLabels.has(block)) continue;
      scannedLabels.add(block);
      const section = sectionFor(block, labelName);
      const example = /\bexamples?\b/i.test(labelName);
      const singular = /^(?:prompt|system prompt|user prompt|developer prompt|prompt template|instruction template|try this prompt|here(?:'s| is) a prompt|use this prompt|prompt\s*#?\d+)$/i.test(labelName) || /^(?:(?:example|sample|suggested|starter)\s+)?prompt\s+(?:for|about|to)\s+/i.test(labelName);
      let sibling = block.nextElementSibling;
      for (let scanned = 0; sibling && scanned < 5; scanned++, sibling = sibling.nextElementSibling) {
        if (/^H[1-6]$/.test(sibling.tagName) || labelText(sibling.textContent)) break;
        if (!visible(sibling)) continue;
        if (["UL", "OL"].includes(sibling.tagName)) {
          [...sibling.children].filter(child => child.tagName === "LI" && visible(child)).forEach((child, index) => {
            add(withoutOuterQuotes(child.textContent), `${section} · ${example ? "Example" : "Prompt"} ${index + 1}`, "high", example ? "example-list" : "labeled-list");
          });
          break;
        }
        if (["PRE", "BLOCKQUOTE"].includes(sibling.tagName)) {
          add(withoutOuterQuotes(sibling.textContent), section, "high", "labeled-text");
          break;
        }
        const introducesList = !singular && ["UL", "OL"].includes(sibling.nextElementSibling?.tagName);
        if (sibling.tagName === "P" && !introducesList && (singular || promptLike(sibling.textContent))) {
          add(withoutOuterQuotes(sibling.textContent), section, "high", "labeled-text");
          if (singular) break;
        }
        if (["DIV", "SECTION"].includes(sibling.tagName) && sibling.children.length <= 12) {
          const before = found.length;
          for (const child of sibling.children) {
            if (!visible(child)) continue;
            if (["UL", "OL"].includes(child.tagName)) {
              [...child.children].filter(item => item.tagName === "LI" && visible(item)).forEach((item, index) => {
                add(withoutOuterQuotes(item.textContent), `${section} · ${example ? "Example" : "Prompt"} ${index + 1}`, "high", example ? "example-list" : "labeled-list");
              });
            } else if (["P", "PRE", "BLOCKQUOTE"].includes(child.tagName) && (singular || promptLike(child.textContent))) {
              add(withoutOuterQuotes(child.textContent), section, "high", "labeled-text");
            }
          }
          if (found.length > before) break;
        }
      }
    }
    for (const table of doc.querySelectorAll("table")) {
      if (!visible(table)) continue;
      const rows = [...table.querySelectorAll("tr")];
      if (!rows.length) continue;
      const headers = [...rows[0].children].filter(cell => ["TH", "TD"].includes(cell.tagName));
      headers.forEach((header, column) => {
        const name = labelText(header.textContent);
        if (!name || !/\bprompts?\b/i.test(name)) return;
        rows.slice(1).forEach((row, index) => {
          const cells = [...row.children].filter(cell => ["TH", "TD"].includes(cell.tagName));
          const cell = cells[column];
          if (cell && visible(cell)) add(withoutOuterQuotes(cell.textContent), `${name} · Row ${index + 1}`, "high", "prompt-table");
        });
      });
      for (const row of rows) {
        const cells = [...row.children].filter(cell => ["TH", "TD"].includes(cell.tagName));
        if (cells.length < 2 || !labelText(cells[0].textContent)) continue;
        if (visible(cells[1])) add(withoutOuterQuotes(cells[1].textContent), clean(cells[0].textContent), "high", "prompt-table");
      }
    }
    for (const element of doc.querySelectorAll("pre, blockquote, [data-prompt], [class*='prompt' i], [id*='prompt' i]")) {
      if (!visible(element)) continue;
      if (element.closest("pre, blockquote") && !["PRE", "BLOCKQUOTE"].includes(element.tagName)) continue;
      if (element.querySelector("li, pre, blockquote")) continue;
      const raw = clean(element.textContent);
      const heading = labelFor(element);
      const explicitlyMarked = element.hasAttribute("data-prompt") || (element.matches("[class*='prompt' i], [id*='prompt' i]") && promptLike(raw)) || Boolean(labelText(heading));
      if (explicitlyMarked || CODE_HINT.test(raw)) add(raw, heading, explicitlyMarked ? "high" : "medium", element.tagName.toLowerCase());
    }
    for (const paragraph of doc.querySelectorAll("p")) {
      if (!visible(paragraph)) continue;
      const raw = clean(paragraph.textContent);
      if (/^[“"‘].+[”"’]$/.test(raw) && promptLike(raw)) {
        add(withoutOuterQuotes(raw), labelFor(paragraph), "medium", "quoted-text");
      }
    }
    return found.slice(0, 30);
  }

  root.PromptExtractor = { extract };
  if (typeof module !== "undefined" && module.exports) module.exports = { extract };
})(globalThis);
