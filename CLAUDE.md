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
node --test --import ./test/setup.js "test/*.test.js" --test-name-pattern "registerTool"
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

## The lorum ipsum component

[generator.js](src/wc/machvive-lorum-ipsum/generator.js) is pure and DOM-free; the element is a thin renderer over it. Both are exported from [index.js](index.js), because fixtures and mock conversations want the string, not an element.

The word banks are ported from the [Lorem Ipsum Generator](https://www.thescottkrause.com/devtoys/lorem_ipsum_generator/) — Latin from Cicero's *De finibus*, and English business-speak. Keep both; the English bank is the point. Latin's word lengths and letter frequencies are not English's, so a column that survives Cicero can still break on the register real copy is written in.

Behaviours to preserve:
- **Slotted content always wins.** The element has projected light DOM since its first release and pages depend on it; generated copy is only the fallback.
- **Dedupe is per sentence, not global.** The original deduped against the whole output with a *substring* match, which silently starved later sentences — once `dolorem` appeared, `dolor` could never follow, and short words like `a` were excluded outright. Real prose repeats words; only a sentence reads badly when it does.
- **The attempt loop is capped.** Exact-word dedupe with a target larger than the bank would otherwise never terminate. A test asserts a 400-word sentence completes and is bounded by the bank size.
- **`theme` does not regenerate.** It is pure CSS here. Re-rendering for it would mean toggling dark mode silently rewrote every placeholder on the page — and a test that seeds the element cannot see that bug, so that test is deliberately unseeded.
- **Copy renders with `textContent`.** Today that is indistinguishable from `innerHTML` because no bank word contains `<` or `&` — which is exactly why a test asserts that invariant. The day a word bank gains one, it fails and points at the right place.
- **Bare `:host` sets `color: inherit` and paints nothing; only an explicit `theme` attribute paints both.** This was shipped the other way round for three releases and measured **1.21:1** in three of six OS-preference x theme combinations — the same number analytics once hit. The reasoning that produced it sounded right ("placeholder copy should sit on whatever surface hosts it, like the floating inspector") but the inspector's exception works because its `.panel` paints itself. The real lesson is narrower and worth keeping: **a text element must not follow `prefers-color-scheme` independently of its container**, because a page decides its own palette and the element is wrong exactly whenever they disagree. Two tests now assert the structure; the number itself only shows up in a browser.

- **A connected element publishes `generate_placeholder_text`.** It exists so a page has a real tool for the inspector to exercise on day one, and it is safe to hand out: pure text, no network, no storage. Tool names are a page-wide namespace, so ownership is module-scoped — the first connected element registers, and hands over to a survivor when removed. Counting registrations cannot test this (the registry is keyed by name, so three registrations collapse to one entry); the test asserts *which* element the call drives.
- **Releasing is guarded to the owner.** A non-owner unregistering and re-registering fires the change event twice, and the inspector re-renders on it — so removing an unrelated placeholder block would wipe a form someone was filling in.
- **Withdrawal is the page's call, not the component's.** `withdrawTool()` aborts the registration and `publishTool()` takes the name back; neither reacts to `toolchange` automatically, because a component that re-registered whenever it noticed its tool missing would fight whoever withdrew it and ping-pong against the event it caused. The guard in `#claimTool` checks ownership *and* liveness, because the two come apart in both directions: a withdrawn owner is still a connected element, and an owner that dropped its controller would otherwise re-register with `signal: undefined` — which the spec treats as "for the document's lifetime", so the tool could never be withdrawn again.
- **The module imports the polyfill.** Registering against a registry that might not exist yet is exactly how analytics shipped capturing nothing. The cost is that the `/lorum-ipsum` subpath now installs the polyfill; that is the intended trade.

Seeds are not a convenience. Without one a page regenerates different copy on every render, which turns a visual diff into noise and makes a screenshot worthless as a regression check.

## The WebMCP polyfill

[machvive-webmcp-polyfill.js](src/wc/machvive-webmcp-polyfill/machvive-webmcp-polyfill.js) is the one component that does more than render. It shims **`document.modelContext`** per the [W3C WebMCP proposal](https://webmachinelearning.github.io/webmcp/docs/proposal.html) — `registerTool(tool, { signal })`, `getTools()` and `executeTool(tool, input, options)` on an `EventTarget`, with tool descriptors carrying `name`, a **required** `description`, `inputSchema`, optional `annotations`, and an `execute(input, { signal })` handler whose fulfilled value the platform JSON-serializes.

**It is `document`, not `navigator`.** The `navigator.modelContext` explainer is stale; Chrome 149 and Edge 150 ship it on the document. 7.0 moved to match and installs nowhere else — a `navigator` copy would give a page two registries that disagree about what is published, and the native check looks at `document` *first* for the same reason: an existing `navigator.modelContext` may be an older copy of this very polyfill.

**Unregistration is by `AbortSignal`.** `unregisterTool` and `provideContext` are gone from the spec, so the controller a registrant holds is the only way to take a tool back. A registration made without a signal lasts as long as the document — which is a leak, not a convenience, and the magnet has a test pinning exactly that.

Three behaviors to preserve when editing it:
- **Never clobber a native implementation.** `installWebmcpPolyfill()` returns early if `'modelContext' in navigator`, and again if `window.isSecureContext` is false (the native API is `[SecureContext]`).
- **Install on import, not on element upgrade.** The module calls `installWebmcpPolyfill()` at load so pages can register tools before the custom element is parsed. The element's `connectedCallback` calls it again; it is idempotent.
- **Failure is a rejection, not a result.** `executeTool` rejects for an unknown tool (`NotFoundError`) and propagates a handler's own throw. There is no `isError` in the spec, so a component that returned one would be inventing surface. `registerTool` likewise *rejects* rather than throwing synchronously — it is documented to return a promise, and a synchronous throw would break every caller that only awaited it.
- **A duplicate name is refused, not replaced.** Registering over a live name rejects with `InvalidStateError`. Silently replacing it was the 6.x behaviour and it hid ownership bugs: two components would each believe they published the page's tools.

**7.0 has no non-standard surface left.** 6.x added `tools`, `callTool` and a `machvive-webmcp-change` event because the spec defined registration only; the spec now defines discovery and invocation too, so all three are retired in favour of `getTools()`, `executeTool()` and the spec's `toolchange`. `TOOL_CHANGE_EVENT` is exported as a convenience for the literal `'toolchange'`, not as an extension. Resist re-adding a synchronous `tools` accessor: it reads as the obvious fix whenever an async `getTools()` is awkward, and it is the one thing a native implementation will not have.

## The inspector and analytics components

**[machvive-webmcp-inspect](src/wc/machvive-webmcp-inspect/machvive-webmcp-inspect.js)** builds its form from a tool's `inputSchema` and coerces each control back to the declared JSON type before calling. Both halves matter: a `number` input yields a string, so without `readControl` a tool receives `"3"` where it declared `integer`. It drives the registry through `getTools()` and `executeTool()`, which are spec surface, so it now works against a native implementation rather than explaining why it cannot. The "unavailable" path survives for a registry that can register but not enumerate, and its tool list is rebuilt on `toolchange` — a listener on the context, not on `window`.

**[machvive-webmcp-analytics](src/wc/machvive-webmcp-analytics/machvive-webmcp-analytics.js)** wraps each tool's `execute` at registration time rather than hooking `executeTool`. That choice is load-bearing: handler-level wrapping captures invocations from every caller, including a native implementation and real agents, neither of which pass through our code. Consequences to preserve:

- **It captures the handler's raw return**, not the JSON string `executeTool` serializes it into afterwards. A test pins this, and `replay` returns the string an agent would get.
- **Tools registered before the module loads cannot be captured** — the polyfill hides handlers from `tools` by design, so there is nothing to re-wrap. The component warns rather than pretending coverage.
- **Recording must never reach the tool call.** Two independent guards enforce this: a per-listener `catch` in `#changed`, and a `catch` around `log.add` in the wrapper. They are deliberately redundant — a bug that made recording throw once produced a phantom `error` entry for a call that actually succeeded.
- **`CallLog` does not extend `EventTarget`.** It did, and dispatching a jsdom `CustomEvent` through Node's `EventTarget` threw on the realm mismatch. The hand-rolled listener set is realm-free and works in plain Node.
- **IndexedDB persistence is async**, so `ready` must be awaited before the first read, and every write is fire-and-forget — storage failing is never allowed to break capture.

Neither component may auto-emit to `window.dataLayer`; that is opt-in via the `datalayer` attribute so importing the module never produces tracking traffic.

## The products component

[machvive-webmcp-products](src/wc/machvive-webmcp-products/machvive-webmcp-products.js) reads the page's schema.org JSON-LD and publishes `search_products`, `get_product` and `list_product_facets`. Its pitch is that the markup already exists for SEO, so there is no backend to build — which means the component is only as good as its tolerance for markup it did not write.

[jsonld.js](src/wc/machvive-webmcp-products/jsonld.js) is where that lives, and it ships as its own `./jsonld` subpath — **not merely re-exported from the component**. That distinction is the whole reason the subpath exists: `./webmcp-products` reaches the same code but imports the polyfill, which evaluates `class extends HTMLElement` at module load, so any Node consumer gets `ReferenceError: HTMLElement is not defined`. A CI check, a build step or a linter could not touch the normalizer at all. Two tests pin this: one asserts `./jsonld` loads in a child process with no DOM, the other asserts the component subpath still *fails* there — if that ever stops being true, the separate subpath may no longer be needed. Things it must keep handling, each one real:
- Containers: `@graph`, `ItemList`/`itemListElement`/`ListItem`, bare arrays, a lone `Product`, and a `Product` nested somewhere nobody anticipated. **It walks recursively rather than enumerating known shapes** — enumerating is a losing game.
- `@type` as a string, an array, or a full URL. `brand`, `category` and `seller` as a string or a node. `image` as a URL, an array or an `ImageObject`.
- `offers` as an object or an array, where **the first entry is not always the usable one** — a stub offer carrying only a url is common. `AggregateOffer` reports `lowPrice`, because "from $198" is actionable and a midpoint nobody can pay is not.
- Prices as decorated strings (`"$1,299.00"`), and `availability`/`itemCondition` as schema.org URLs that must be reduced to bare tokens or the enum is unusable.
- Any `gtin` flavour collapsed into one field; dedupe by sku → gtin → url → name, **keeping the richer record** when the same product appears in both an ItemList and a BreadcrumbList.
- A malformed JSON-LD block must be skipped, not fatal. Pages carry generated blocks beside a hand-written one, and the hand-written one has the trailing comma.

**`ProductGroup` is the shape that matters most.** Shopify emits it for anything with options, so it is probably the most common Product JSON-LD on the web. A real storefront produced **50 nameless rows** before this was handled: the variants are `{ "@type": "Product", "url": … }` and every describing property lives on the group. Rules:
- The group **is** the product. Fold it: variants inherit `name`/`brand`/`description`/`image`/`category`/`url`/`offers` where they state none, and are summarised as `{ count, variesBy, inStock, skus, gtins }` rather than emitted as rows.
- **Never descend into `hasVariant`** during the walk, or they come back as separate products — the original bug.
- `isVariantOf` is checked **before** collecting, not after. A node carrying both `@type: Product` and `isVariantOf` would otherwise be collected before the guard fires.
- Dedupe has a **second pass by name**, because `aggregateRating.itemReviewed: { "@type": "Product", "name": … }` describes the same product with no identifier, keys differently from the rich record, and survived as a ghost row beside it.

Behaviours to preserve in the component:
- **Read-only.** No tool it registers may mutate anything; a test fails on a registered name containing add/buy/order/cart/checkout/update/delete/set. That is what makes auto-publishing safe and why it holds no credentials.
- **Filter enums are derived from the page's own data**, and must be rebuilt by `load()`. Stale enums offer choices that match nothing. An empty facet emits *no* enum rather than `enum: []`, which would render a select with nothing in it.
- **Results are capped** (default 10, max 50) with an explicit `truncated` flag. An agent that cannot tell a page from a complete answer will report "there are 10 products". Search returns a summary; only `get_product` returns the full record and the raw JSON-LD.
- **A price filter excludes unpriced products.** An unknown price is not "cheap enough", and `null > max` being false is the easy way to get this wrong.
- **Every bound the code enforces is declared on the schema**, and the two must agree. `limit` promised "max 50" in prose while the schema said nothing, and a third-party scan reported exactly that: a size not defined in the schema. A constraint stated only in a description is invisible to a validator and to an agent planning a call — it finds out by having its input silently changed.
- **Over-long `query` and `id` are refused with a reason, not truncated.** Shortening a query answers a question the agent did not ask, and it has no way to notice. `limit` is clamped rather than refused because a too-large page size still has an obvious correct answer; a different search string does not.
- **Ownership is module-scoped with a liveness check**, like the lorem component, and for the same reason.

Two tests in this area were originally passing for the wrong reason and are worth not re-breaking: the `limit` clamp needs a catalogue larger than `MAX_LIMIT` to be observable at all, and the unpriced-product test must reload the *owning* element — mounting a second one leaves the first in charge of the tools, so the call answers from stale data.

## The magnet component's tool tiers and namespace

`magnet_start` is the only one of the four with a visible side effect — it opens and prefills a widget on someone's screen. The `tools` attribute (`all` | `read` | `none`) gates it, falling back to the magnet's own `mag_agent_tools`, so a merchant setting travels with the magnet rather than the markup. **Default stays `all`**: narrowing it would silently remove `magnet_start` from pages already publishing it, machvive.com included.

`magnet_*` is a page-wide namespace and ownership is module-scoped, like the lorem and products components. The case that forced it: the Magnet runtime is expected to mount one of these on hundreds of customer sites, and any site that also carries its own tag would get two registrations, the second silently replacing the first — possibly describing a different magnet. The claim checks ownership **and** liveness, because a withdrawn owner is still a connected element — and because an owner holding no live controller must mint a new one rather than register without a signal.

Three tests here exist because the mutations survived without them: narrowing the tier must actually *withdraw* `magnet_start` rather than leave it from the previous tier; a later element must claim the namespace a withdrawn owner left empty; and re-publishing must keep the tools **withdrawable**, which is what caught `#claim` short-circuiting on ownership and re-registering with no signal. None is visible from the happy path, and the last one is invisible until something tries to withdraw.

`observedAttributes` listed four attributes with no `attributeChangedCallback` at all until `tools` needed one. Only `tools` is handled; the others are read at boot, and making them re-boot now would be a behaviour change nobody asked for.

## Theming

[shared/theme.js](src/wc/shared/theme.js) holds the only copy of the palette; both UI components interpolate `THEME_CSS` at the top of their stylesheet. Rules to keep:

- **Cascade order is load-bearing.** Light tokens on bare `:host`, then the `prefers-color-scheme: dark` block guarded by `:host(:not([theme="light"]))`, then `:host([theme="dark"])` *after* the media query so an explicit choice wins in a light OS. A test asserts that ordering.
- **A component that themes its own text must paint its own background.** Analytics once set a light `color` under a dark theme without a `background`, so inside a light page its text rendered at 1.21:1 — light on light. `:host` now paints `var(--mv-bg)`; the floating inspector is the deliberate exception, staying transparent because its `.panel` and `.fab` paint themselves.
- **No hardcoded hex outside the token blocks.** A test strips `THEME_CSS` from each component's stylesheet and fails on any remaining literal.
- **`color-scheme: light dark`** must stay declared, or the browser paints light scrollbars, select popups and checkboxes onto a dark panel.

Contrast is not something to eyeball. `design/webmcp-playground` measures WCAG ratios across all six OS-preference × `theme` combinations; that audit is what caught `--mv-faint: #888` sitting at 3.54:1 on white, which had already shipped.

## Publishing

Releases publish from CI, not a laptop. Push a tag and [publish.yml](.github/workflows/publish.yml) does the rest:

```bash
npm version <patch|minor|major>
git commit -am "…" && git tag -a v<x.y.z> -m "…"
git push origin main --follow-tags
```

The workflow uses **npm trusted publishing** — OIDC, no token anywhere — which also makes npm generate a provenance attestation automatically (the `--provenance` flag is only for the token path). `permissions: id-token: write` is what mints the OIDC token; remove it and publishing fails with no token able to substitute.

Two guards run before the publish: the tag must match `package.json`'s version (a mismatch would publish the wrong version under the right name, which cannot be undone), and the full suite must pass. `prepublishOnly` runs the suite again as a backstop for any local `npm publish`.

The trusted publisher is configured on npmjs.com against this repo **and this workflow filename** — renaming `publish.yml` breaks publishing until the config is updated to match.

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
- **The plugin versions independently of the package.** `plugin.json` and the marketplace entry carry their own semver, bumped when the *skill's guidance* changes — not when the package ships. Tying them to the npm version would force a reinstall for every user on releases the skill does not describe. Both files must be bumped together.
- **The SKILL.md restates constraints documented here, and drifts silently.** It went four releases out of date — missing a whole component, the `shared/theme.js` bundling trap, and every option added since — because nothing fails when it is stale. Treat it as part of the release: a new component, a new attribute, or a changed constraint means editing the skill and bumping its version in the same commit.

## Excluded from the repo

`.gitignore` excludes `design/` (local design assets) and `.env`. The published tarball additionally omits `test/` and this file.
