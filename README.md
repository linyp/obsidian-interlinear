# Interlinear

Reading-mode **immersive translation** for [Obsidian](https://obsidian.md). Open a
foreign-language note in reading view, click one button, and Interlinear renders a
Chinese (or any target language) translation **alongside** the original — paragraph
by paragraph, as bilingual or translation-only.

> Inspired by the "immersive translation" reading experience. Not affiliated with,
> and not using the name of, any commercial product.

## Why it's safe by design

- **Never modifies your notes.** Translations are injected as render-layer DOM only
  (via `registerMarkdownPostProcessor`). Close and reopen the note and the file on
  disk is byte-for-byte unchanged.
- **Never auto-translates.** Opening or switching notes does nothing. Translation
  runs **only** when you explicitly click the floating button (or run the command).
- **BYOK, zero telemetry.** Your API key lives only in the vault-local `data.json`
  (git-ignored). It is never hard-coded, never logged, and never sent anywhere
  except to the translation endpoint you configure.
- **Reading view only** (MVP). No edit/Live-Preview translation.

## Features

- Floating button in the bottom-right of the reading view — the single trigger.
- Two display modes, switched by CSS class only (no re-translation):
  - **Bilingual** — original above, translation below.
  - **Translation-only** — originals hidden.
- Skips what shouldn't be translated: code blocks, math, frontmatter, image-only
  blocks, bare URLs, and pure symbol/number blocks.
- Content-hash translation cache (in-memory, per session) — repeat clicks and
  re-renders reuse results instead of paying for them again.
- Pluggable backend behind a `TranslationProvider` interface; **DeepSeek** is the
  default implementation. Requests use Obsidian's `requestUrl` (not `fetch`).

## Install (manual / dev)

1. `npm install`
2. `npm run build` — produces `main.js`.
3. Copy `main.js`, `manifest.json`, and `styles.css` into
   `<your-vault>/.obsidian/plugins/interlinear/`, then enable the plugin.

## Configure

Open **Settings → Interlinear**:

| Setting | Default | Notes |
| --- | --- | --- |
| DeepSeek API key | _(empty)_ | Required. Stored only in `data.json`. |
| Base URL | `https://api.deepseek.com` | OpenAI-compatible endpoint. |
| Model | `deepseek-v4-flash` | |
| Target language | `zh-CN` | e.g. `zh-CN`, `en`. |
| Default display mode | Bilingual | |
| Concurrency | 3 | Max in-flight requests. |
| Min interval (ms) | 300 | Spacing between request starts. |
| Max retries | 3 | On 429 / transient errors. |
| Batch char budget | 4000 | Characters packed per request. |

## Use

1. Open a note and switch to **reading view**.
2. Click the **floating button** (bottom-right). It collects translatable
   paragraphs, translates them, and injects the results.
3. Once translated, **click the button again to toggle** bilingual ↔
   translation-only (instant — no new requests).

Commands (Command Palette):

- **Interlinear: Translate current note** — idempotent; cached blocks are reused,
  so it also retries any batches that failed.
- **Interlinear: Toggle translation display mode**
- **Interlinear: Clear translations**

## Develop

Point the build output straight at a **test vault** (use a throwaway vault, not
your daily one) via an environment variable, and rebuild on save:

```bash
INTERLINEAR_OUTDIR="/path/to/test-vault/.obsidian/plugins/interlinear" npm run dev
```

`npm run dev` runs esbuild in watch mode with inline sourcemaps and copies
`manifest.json`, `styles.css`, and `.hotreload` next to `main.js`. Install pjeby's
**Hot Reload** plugin in the test vault and the `.hotreload` marker makes it
auto-reload on every rebuild. (Reading-mode rendering only re-runs when you toggle
edit ↔ reading or reopen the note.)

Useful scripts:

```bash
npm run build      # tsc --noEmit + production bundle -> main.js
npm run typecheck  # tsc --noEmit
npm test           # vitest run
npm run test:watch # vitest (watch)
```

## Architecture

The hard part of this plugin is that its UI/rendering can only be verified inside
Obsidian, so the design pushes **all decidable logic into pure, tested modules**
and keeps the Obsidian/DOM/network surface thin.

```
src/
  core/         pure logic (no obsidian): hash, segmentation + batch pack/unpack,
                block skip-rules, rate limiter (concurrency/backoff)
  translator/   provider.ts (interface + typed errors), deepseek.ts (pure request
                builder / response parser + DeepSeekProvider), cache.ts;
                requestUrlClient.ts is the only requestUrl adapter
  render/       postProcessor.ts — DOM adapter + inject/clear/display-mode helpers
  ui/           fabState.ts (pure reducer), translateButton.ts (FAB + flow),
                settingsTab.ts
  settings.ts   pure settings types + defaults + normalize/validate
  main.ts       composition root
```

**Iron rule:** modules imported by tests never import the `obsidian` runtime
(it's a types-only package). Only five shell files touch obsidian: `main.ts`,
`ui/translateButton.ts`, `ui/settingsTab.ts`, `render/postProcessor.ts`,
`translator/requestUrlClient.ts`. The HTTP call sits behind an injectable
`HttpClient` seam, so the provider is fully testable without the network.

Batches are packed with numbered `<<<SEG k>>>` sentinels; if the model returns the
wrong number of segments, the provider falls back to one request per segment so
every translation still maps 1:1 to its source block.

## Limitations (MVP)

- Reading view only — no editing/Live-Preview translation.
- Lists and tables are translated as a single block (best-effort).
- Cache is in-memory and cleared when Obsidian restarts.

## License

MIT
