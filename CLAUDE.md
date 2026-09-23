# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

`@machfivetechchicago/machvive-webmcp-ai` — a published npm library of vanilla Web Components for WebMCP/AI-agent-enabled web pages. Consumers install it and `import` the modules; there is no app shell, no bundler, and no framework in this repo.

## Commands

```bash
npm test                 # whole suite
npm run test:watch       # re-runs on change

# one file
node --test --import ./test/setup.js test/machvive-webmcp-polyfill.test.js
# one test by name
node --test --import ./test/setup.js "test/*.test.js" --test-name-pattern "provideContext"
```

Tests use the built-in Node test runner plus `jsdom` (the only dependency, dev-only). There is no build step and no linter — files are published as-authored ESM, so whatever is on disk is what consumers load.

`--import ./test/setup.js` is required, not optional: the component modules self-register and the polyfill self-installs at import time, so the DOM has to exist before any of them load. The runner gives each test file its own process, so each starts from a clean document, registry, and navigator.

Publishing is otherwise the only workflow — `npm publish` (`publishConfig.access` is already `public`).

### Coverage numbers are not trustworthy here

`--experimental-test-coverage` badly under-reports this repo, for two unrelated reasons, so don't chase the percentage or add tests to "fix" it:
- Lifecycle callbacks invoked through jsdom's custom element registry are not attributed to the source file. `machvive-lorum-ipsum.js` reports 36% / 0% functions while fully tested; instantiating the class directly instead reports 100%.
- [helpers.js](test/helpers.js) imports the polyfill with a `?bust=N` query string to defeat the ESM cache, and each distinct URL is counted as its own module.

## Architecture

**Entry points.** Three public entry points, all declared in `package.json` `exports`:
- `.` → [index.js](index.js) — bulk import; imports every component (triggering its self-registration) and re-exports the classes.
- `./lorum-ipsum` and `./webmcp-polyfill` → the individual component modules, for cherry-picking.

Adding a component means touching three places: the component file under `src/wc/<tag-name>/`, the import/export pair in [index.js](index.js), and a new subpath in `package.json` `exports`. Missing any one of them breaks either the bulk import or the cherry-pick path.

**Component convention** (see [machvive-lorum-ipsum.js](src/wc/machvive-lorum-ipsum/machvive-lorum-ipsum.js) as the reference implementation):
- One directory per component at `src/wc/<tag-name>/<tag-name>.js`, matching the custom element tag.
- Named `export class` in PascalCase; the module is imported for side effects *and* the class is re-exported from `index.js`.
- Constructor calls `attachShadow({ mode: 'open' })`; markup and scoped `<style>` are written in `connectedCallback`.
- Each module self-registers at the bottom, guarded by `if (!customElements.get('<tag-name>'))` so that bulk and cherry-pick imports can both run without a double-define error.

All tags are prefixed `machvive-`.

**These modules are browser-only by construction.** `class X extends HTMLElement` is evaluated at module load, so importing any entry point where no DOM exists throws `ReferenceError: HTMLElement is not defined`. That is why the test suite installs jsdom globals via `--import ./test/setup.js` before anything loads, and why [README.md](README.md) documents a client-only import path for SSR frameworks. Don't "fix" this by lazily declaring the classes — self-registration on import is the feature; the constraint is inherent to custom elements.

## The WebMCP polyfill

[machvive-webmcp-polyfill.js](src/wc/machvive-webmcp-polyfill/machvive-webmcp-polyfill.js) is the one component that does more than render. It shims `navigator.modelContext` per the [W3C WebMCP proposal](https://webmachinelearning.github.io/webmcp/docs/proposal.html) — `registerTool` / `unregisterTool` / `provideContext`, with tool descriptors carrying `name`, `description`, `inputSchema`, and an `execute(params, agent)` handler that resolves to `{ content: [...] }`.

Three behaviors to preserve when editing it:
- **Never clobber a native implementation.** `installWebmcpPolyfill()` returns early if `'modelContext' in navigator`, and again if `window.isSecureContext` is false (the native API is `[SecureContext]`).
- **Install on import, not on element upgrade.** The module calls `installWebmcpPolyfill()` at load so pages can register tools before the custom element is parsed. The element's `connectedCallback` calls it again; it is idempotent.
- **`callTool` never throws.** Unknown tools and handler rejections both come back as `{ content: [...], isError: true }`, matching MCP's error convention. `provideContext` validates every descriptor before mutating, so a bad tool can't leave a half-replaced registry.

`tools`, `callTool`, and the `machvive-webmcp-change` event (exported as `TOOLS_CHANGED_EVENT`) are **non-standard additions** — the spec defines registration only. They exist because the polyfill is a registry with no transport; bridge code needs a way to discover and invoke. Keep them clearly marked as extensions so they aren't mistaken for spec surface.

## The inspector and analytics components

**[machvive-webmcp-inspect](src/wc/machvive-webmcp-inspect/machvive-webmcp-inspect.js)** builds its form from a tool's `inputSchema` and coerces each control back to the declared JSON type before calling. Both halves matter: a `number` input yields a string, so without `readControl` a tool receives `"3"` where it declared `integer`. It depends on `tools` and `callTool` — our non-standard additions — so it detects a native `modelContext` that lacks them and renders an explanation instead of throwing.

**[machvive-webmcp-analytics](src/wc/machvive-webmcp-analytics/machvive-webmcp-analytics.js)** wraps each tool's `execute` at registration time rather than hooking `callTool`. That choice is load-bearing: handler-level wrapping captures invocations from every caller, including a native implementation and real agents, neither of which pass through our code. Consequences to preserve:

- **It captures the handler's raw return**, not the `{content:[...]}` shape `callTool` normalizes into afterwards. A test pins this.
- **Tools registered before the module loads cannot be captured** — the polyfill hides handlers from `tools` by design, so there is nothing to re-wrap. The component warns rather than pretending coverage.
- **Recording must never reach the tool call.** Two independent guards enforce this: a per-listener `catch` in `#changed`, and a `catch` around `log.add` in the wrapper. They are deliberately redundant — a bug that made recording throw once produced a phantom `error` entry for a call that actually succeeded.
- **`CallLog` does not extend `EventTarget`.** It did, and dispatching a jsdom `CustomEvent` through Node's `EventTarget` threw on the realm mismatch. The hand-rolled listener set is realm-free and works in plain Node.
- **IndexedDB persistence is async**, so `ready` must be awaited before the first read, and every write is fire-and-forget — storage failing is never allowed to break capture.

Neither component may auto-emit to `window.dataLayer`; that is opt-in via the `datalayer` attribute so importing the module never produces tracking traffic.

## Theming

[shared/theme.js](src/wc/shared/theme.js) holds the only copy of the palette; both UI components interpolate `THEME_CSS` at the top of their stylesheet. Rules to keep:

- **Cascade order is load-bearing.** Light tokens on bare `:host`, then the `prefers-color-scheme: dark` block guarded by `:host(:not([theme="light"]))`, then `:host([theme="dark"])` *after* the media query so an explicit choice wins in a light OS. A test asserts that ordering.
- **A component that themes its own text must paint its own background.** Analytics once set a light `color` under a dark theme without a `background`, so inside a light page its text rendered at 1.21:1 — light on light. `:host` now paints `var(--mv-bg)`; the floating inspector is the deliberate exception, staying transparent because its `.panel` and `.fab` paint themselves.
- **No hardcoded hex outside the token blocks.** A test strips `THEME_CSS` from each component's stylesheet and fails on any remaining literal.
- **`color-scheme: light dark`** must stay declared, or the browser paints light scrollbars, select popups and checkboxes onto a dark panel.

Contrast is not something to eyeball. `design/webmcp-playground` measures WCAG ratios across all six OS-preference × `theme` combinations; that audit is what caught `--mv-faint: #888` sitting at 3.54:1 on white, which had already shipped.

## Publishing

`npm publish` — `prepublishOnly` runs the suite first, so a failing test blocks the release.

Two overlapping mechanisms control tarball contents: the `files` allowlist in `package.json` (authoritative) and [.npmignore](.npmignore) (belt-and-braces). Editing only `.npmignore` will appear to do nothing when the path isn't in `files`. The `published tarball` tests in [package.test.js](test/package.test.js) assert the real `npm pack` output, so drift surfaces there rather than after a release.

Things that will break a publish or a consumer, all currently satisfied — keep them that way:
- **`sideEffects` must never be `false`.** Components register via `customElements.define()` on import; a `false` lets bundlers drop `import "pkg/lorum-ipsum"` and silently skip the tag.
- **`types` must be the first condition in each `exports` subpath.** TypeScript resolves conditions in order and will miss declarations placed after `default`.
- **Every `.js` entry point needs a sibling `.d.ts`**, and `index.d.ts` must not declare exports [index.js](index.js) lacks — declarations that outrun runtime fail only in the consumer.
- **The declared `Apache-2.0` license requires [LICENSE](LICENSE) to ship.**

Publishing also needs `npm login`, and the `@machfivetechchicago` scope must be a user scope or an org the publisher belongs to. `publishConfig.access` is already `public`, which scoped public packages require.

## Claude Code plugin

The repo doubles as a plugin marketplace so consumers can install a skill that teaches Claude to use these components:

```
.claude-plugin/marketplace.json          # marketplace manifest, must be at repo root
plugins/machvive-webmcp/
  .claude-plugin/plugin.json
  skills/machvive-webmcp/SKILL.md
```

Users install with `/plugin marketplace add Mach-Five-Group/machvive-webmcp-ai` then `/plugin install machvive-webmcp@machvive`.

- **Claude Code does not scan `node_modules`.** Shipping the skill in the npm tarball would give consumers nothing; the plugin route is the only one with real discovery. The `files` allowlist already keeps `plugins/` out of the tarball — leave it that way.
- **Two versions to keep in sync.** `plugin.json` and the marketplace entry both carry a `version` that currently tracks the npm version. If the skill's guidance changes, bump it, or installed copies stay stale.
- **The SKILL.md restates constraints documented here.** When a constraint changes — import order, secure context, SSR, `sideEffects` — update the skill too, or it will teach something that is no longer true.

## Excluded from the repo

`.gitignore` excludes `design/` (local design assets) and `.env`. The published tarball additionally omits `test/` and this file.
