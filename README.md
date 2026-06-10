# Interlinear

**English** · [简体中文](README.zh-CN.md)

Reading-mode **interlinear translation** for [Obsidian](https://obsidian.md). Open a
foreign-language note in reading view, click one button, and Interlinear renders a
Chinese (or any target language) translation **alongside** the original — paragraph
by paragraph, as bilingual or translation-only.

## Why it's safe by design

- **Never modifies your notes.** Translations are injected as render-layer DOM only
  (via `registerMarkdownPostProcessor`). Close and reopen the note and the file on
  disk is byte-for-byte unchanged.
- **Never auto-translates.** Opening or switching notes does nothing. Translation
  runs **only** when you explicitly click the floating / status-bar button (or run
  the command).
- **BYOK, zero telemetry.** Your API key lives only in the vault-local `data.json`
  (git-ignored). It is never hard-coded, never logged, and never sent anywhere
  except to the translation endpoint you configure.
- **Reading view only** (MVP). No edit/Live-Preview translation.

## Features

- **One-click whole-note translation**, triggered from either surface:
  - the **floating button** in the lower-right of the reading view — the entry
    point on **mobile** (which has no status bar), optional on desktop;
  - the **status-bar buttons** (desktop) or the command palette.
  Both show live batch progress (`3/12`) while translating. Click again to toggle
  **translation ↔ original** (a CSS class swap — no new requests).
- **Two display modes** — **bilingual** (original + translation) ↔
  **translation-only** — switched instantly with no re-translation. In
  translation-only mode, **hover a translation (or tap it on mobile) to peek at
  its original** inline.
- **Five translation styles** (pure CSS, switchable live): border, quote block,
  muted text, dashed underline, and a **learning mask** that blurs translations
  until you hover — for language practice.
- **Persistent translation cache** — content-hash keyed, LRU-capped, saved as
  `cache.json` in the plugin folder. Reopening a note after a restart costs
  nothing; only hashes and translations are stored, never your source text.
- **Whole-note translation, virtualization-aware.** Obsidian's reading view only
  keeps on-screen blocks in the live DOM, so one click translates the visible
  blocks immediately, pre-translates the rest into the cache, and a
  `MutationObserver` injects cached translations into each block the instant it
  renders as you scroll.
- **Skips what shouldn't be translated:** code blocks, math, image-only blocks,
  bare URLs, pure symbol/number blocks, and blocks **already written in the target
  language** (no request is sent for those).
- **Pluggable backend** behind a `TranslationProvider` interface, with **service
  presets** (DeepSeek by default; OpenAI, SiliconFlow, Ollama, or any custom
  OpenAI-compatible endpoint) and a **Test connection** button in settings.
  Requests use Obsidian's `requestUrl` (not `fetch`).

## Network use, accounts & privacy

- **Remote service.** When — and only when — you trigger a translation or click
  **Test connection**, the plugin sends the translatable paragraph text of the
  active note to the **endpoint you configured** (default
  `https://api.deepseek.com`). Nothing is sent at any other time.
- **Account required.** Bring your own API key (BYOK) for the configured service;
  usage is billed by that provider, not by this plugin.
- **No telemetry.** The plugin collects nothing and phones home nowhere.
- **Local files only.** Settings (including your API key) live in the plugin's
  `data.json`; the translation cache lives in `cache.json` next to it (content
  hashes + translations only). Your notes are never modified.

## Install

Not yet in the community plugin store. Until then:

### Via BRAT (recommended — auto-updates)

1. Install and enable **[BRAT](https://github.com/TfTHacker/obsidian42-brat)**
   from **Settings → Community plugins → Browse** (search "BRAT").
2. Run the command **BRAT: Add a beta plugin for testing**.
3. Enter the repository `linyp/obsidian-interlinear` and confirm.
4. Enable **Interlinear** in **Settings → Community plugins**.

BRAT pulls the latest GitHub release and keeps the plugin updated as new
versions ship.

### Manual

1. Download `main.js`, `manifest.json`, and `styles.css` from the
   [latest release](https://github.com/linyp/obsidian-interlinear/releases/latest).
2. Put the three files in `<your-vault>/.obsidian/plugins/interlinear/`.
3. Enable **Interlinear** in **Settings → Community plugins**.

(To build from source instead, see [Develop](#develop).)

## Configure

Open **Settings → Interlinear**:

| Setting | Default | Notes |
| --- | --- | --- |
| Service preset | DeepSeek | Pre-fills base URL + model: DeepSeek / OpenAI / SiliconFlow / Ollama / custom. |
| API key | _(empty)_ | Required (BYOK). Stored only in `data.json`. |
| Base URL | `https://api.deepseek.com` | Any OpenAI-compatible endpoint. |
| Model | `deepseek-v4-flash` | |
| Test connection | — | Sends one tiny request to verify the key and endpoint. |
| Target language | `zh-CN` | e.g. `zh-CN`, `en`, `ja`. |
| Default display mode | Bilingual | |
| Translation style | Border | Border / quote / muted / dashed underline / learning mask. |
| Floating button | Always | Always / mobile only / never. |
| Concurrency | 10 | Max in-flight requests (1–16). |
| Min interval (ms) | 0 | Spacing between request starts. |
| Max retries | 3 | On 429 / transient errors. |
| Batch char budget | 4000 | Characters packed per request. |
| Max segments per request | 12 | Blocks packed per request, alongside the char budget (1–100). |
| Custom instructions | _(empty)_ | Optional text appended to the system prompt — glossary, tone, or domain. |
| Persistent cache | On | Keep translations across restarts; shows size and offers one-click clear. |

> DeepSeek's flash tier rate-limits by **concurrent connections**, not by RPM/TPM,
> so the defaults run several requests in parallel with no spacing.

## Use

1. Open a note and switch to **reading view**.
2. Click the **floating button** in the lower-right (or **Translate** in the
   status bar). It collects the translatable paragraphs, translates the whole
   note, and shows live progress while batches are in flight.
3. Click again to toggle the **translation ↔ original**.
4. Use the small **mode** button (or the status-bar one) to toggle
   **bilingual ↔ translation-only** (instant — no new requests). In
   translation-only mode, hover (desktop) or tap (mobile) a translation to peek
   at its original.

Commands (Command Palette, shown under the **Interlinear:** prefix). No default
hotkey is set (per community guidelines) — bind your own under
**Settings → Hotkeys**:

- **Translate / show original** — translate the note, or toggle
  translation ↔ original once translated. Re-running is idempotent: cached blocks
  are reused, so it also retries any batches that failed.
- **Toggle display mode (bilingual / translation-only)**
- **Clear translations**

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

### Release

```bash
npm version patch|minor|major  # syncs package.json, manifest.json, versions.json
git push && git push --tags
```

Pushing the tag triggers the GitHub Actions workflow, which tests, builds, and
creates a **draft** release with `main.js` / `manifest.json` / `styles.css`
attached as individual assets — review the draft, then publish.

## Architecture

The hard part of this plugin is that its UI/rendering can only be verified inside
Obsidian, so the design pushes **all decidable logic into pure, tested modules**
and keeps the Obsidian/DOM/network surface thin.

```
src/
  core/         pure logic (no obsidian): hash, segmentation + batch pack/unpack,
                block skip-rules + same-language detection, rate limiter
                (concurrency/backoff)
  translator/   provider.ts (interface + typed errors), deepseek.ts (pure request
                builder / response parser + DeepSeekProvider), cache.ts (LRU +
                serialization for the persistent cache);
                requestUrlClient.ts is the only requestUrl adapter
  render/       postProcessor.ts — DOM adapter + collect/inject/clear/display-mode
                + style helpers
  ui/           translateButton.ts (status bar + FAB + translation flow),
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

## License

MIT
