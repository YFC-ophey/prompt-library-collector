# Prompt Library Collector

A Chrome Manifest V3 extension that finds prompt text on web pages and collects it into a local Markdown file and a Notion page. It uses page structure and wording heuristics; it does not send page contents to an AI service.

## Install

1. Open `chrome://extensions`, turn on **Developer mode**, and click **Load unpacked**.
2. Select this folder (`prompt-library-collector`). Pin the extension to the toolbar.
3. Open **Settings** from the extension popup. Choose a Markdown file. The extension appends new entries to this file.
4. To sync Notion, create an [internal connection](https://www.notion.so/profile/integrations), give it permission to insert and update content, and share the target page with it. Enter the connection token and the page URL or ID in Settings.

## Use

- Click **Scan this page** to review candidates. Select prompts and click **Collect selected**.
- Select text on the page before scanning to capture a prompt that the detector misses.
- Click **Enable auto-collect** for a site to save high-confidence prompts when its pages load or change. Chrome asks for access to that site. Disable it from the same button.
- Settings shows each entry's local file and Notion sync status. **Expandable group titles** lets you name each webpage and case; saving updates the local Markdown callout and the existing Notion toggle. **Retry pending sync** handles temporary errors. **Organize existing prompts** converts captures from older extension versions into webpage and section groups.

The local file is selected through Chrome's file picker. Chrome may require renewed access after a restart; use **Reconnect file** in Settings. Captures remain in extension storage until the file is writable again. Notion is optional; captures wait locally until it is configured.

The Markdown file uses nested, collapsed Obsidian callouts: one per source webpage and one per prompt section or use case. The extension maintains the region between `<!-- prompt-library:begin -->` and `<!-- prompt-library:end -->`; edits inside that region are replaced when new prompts sync. Put your own notes outside the markers. Notion uses nested toggle blocks. Organizing previously saved Notion entries requires the connection's read and update content capabilities; only matching old prompt blocks are moved to Notion's trash after the new groups are created.

The connection token stays in Chrome extension storage and is used only by the extension service worker for `api.notion.com`. Chrome's storage access is restricted to trusted extension contexts. Use a dedicated Notion connection with access only to the target page.

## Detection rules

The detector considers code blocks, quotes, prompt-marked elements, prompt tables, and individual items under labels such as “Prompts,” “Example Prompts,” “Sample prompts,” “Prompt examples,” “Prompts to try,” and “Prompt for research.” It can also find a standalone quoted instruction for manual review. Generic discussions of prompts and ordinary “Instructions” sections are excluded. Forms, editable fields, hidden content, and text shorter than 32 or longer than 8,000 characters are ignored. The scan returns at most 30 candidates and deduplicates by normalized prompt text. Auto-collect saves only high-confidence candidates; manual scanning lets you review all candidates.

X articles use a read-only Draft.js article container. The detector supports its “Example Prompts:” sections and collects each list item separately. After updating the extension, reload the X article before scanning so Chrome injects the current script.

## Development

Run `npm install` and `npm test` for the extractor, formatting, and Notion request tests. `npm run smoke` loads the extension in Chrome for Testing; set `CHROME_BIN` if Playwright's bundled browser is not installed. The extension itself requires no build step or runtime dependencies.
