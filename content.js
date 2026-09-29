(function () {
  if (globalThis.__promptCollectorInstalled) return;
  globalThis.__promptCollectorInstalled = true;
  let timer;
  let observer;

  function candidates() {
    return globalThis.PromptExtractor.extract(document, String(window.getSelection?.() || ""));
  }

  function pageTitle() {
    const articleTitle = document.querySelector("article h1, main h1, .public-DraftEditor-content h1")?.textContent?.trim();
    const socialTitle = document.querySelector('meta[property="og:title"]')?.content?.trim();
    return articleTitle || (socialTitle && !["X", "Twitter"].includes(socialTitle) ? socialTitle : "") || document.title;
  }

  function sendAuto() {
    chrome.runtime.sendMessage({ type: "AUTO_SCAN", url: location.href, title: pageTitle(), candidates: globalThis.PromptExtractor.extract(document) }).catch(() => {});
  }

  function startAuto() {
    if (observer) return;
    sendAuto();
    observer = new MutationObserver(() => {
      clearTimeout(timer);
      timer = setTimeout(sendAuto, 1600);
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  function stopAuto() {
    clearTimeout(timer);
    observer?.disconnect();
    observer = undefined;
  }

  chrome.runtime.onMessage.addListener((message, _sender, respond) => {
    if (message.type === "SCAN") respond({ candidates: candidates(), url: location.href, title: pageTitle() });
    if (message.type === "START_AUTO") { startAuto(); respond({ ok: true }); }
    if (message.type === "STOP_AUTO") { stopAuto(); respond({ ok: true }); }
  });

  chrome.runtime.sendMessage({ type: "AUTO_ENABLED", url: location.href }).then(result => {
    if (result?.enabled) startAuto();
  }).catch(() => {});
})();
