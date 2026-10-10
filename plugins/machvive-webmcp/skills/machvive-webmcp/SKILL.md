---
name: machvive-webmcp
description: Build agent-callable web pages with the machvive WebMCP components (@machfivetechchicago/machvive-webmcp-ai) — registering tools an AI agent can invoke through navigator.modelContext, plus the inspector and analytics components. Use this whenever the user mentions WebMCP, navigator.modelContext, modelContext, machvive, agent-readable or agent-callable pages, exposing site functionality to AI agents, registering tools a browser agent can call, capturing and replaying agent tool calls, or exposing a MachFive Magnet's lead capture to agents — even when they don't name the package. Also use when someone asks how an AI agent could use their site's functionality instead of scraping the DOM, or is debugging why their registered tools aren't being captured or discovered.
---

# machvive WebMCP components

`@machfivetechchicago/machvive-webmcp-ai` lets a page publish *tools* — named,
schema-typed functions — that an AI agent can call directly, instead of the agent
reading the DOM and simulating clicks.

It implements the [W3C WebMCP proposal](https://webmachinelearning.github.io/webmcp/docs/proposal.html)
(`navigator.modelContext`), which no browser ships yet. Four components:

| Tag | Purpose |
| --- | --- |
| `<machvive-webmcp-polyfill>` | Provides `navigator.modelContext` |
| `<machvive-webmcp-inspect>` | Lists tools, builds a form per schema, runs them |
| `<machvive-webmcp-analytics>` | Captures every call for replay, export, dataLayer |
| `<machvive-webmcp-products>` | Publishes the page's schema.org JSON-LD as read-only product tools |
| `<machvive-m5t-magnet>` | Bridges a MachFive Magnet's lead capture to WebMCP |
| `<machvive-lorum-ipsum>` | Generates placeholder copy and publishes it as a WebMCP tool |

## Install and import

```bash
npm install @machfivetechchicago/machvive-webmcp-ai
```

```javascript
// Import order matters — see Constraint 1.
import '@machfivetechchicago/machvive-webmcp-ai/webmcp-analytics';
import '@machfivetechchicago/machvive-webmcp-ai/webmcp-inspect';
// or the bare specifier for all four components
```

Importing a module registers its custom element and installs the polyfill. There
is no init function to call. Subpaths: `/webmcp-polyfill`, `/webmcp-inspect`,
`/webmcp-analytics`, `/m5t-magnet`, `/lorum-ipsum`. TypeScript declarations ship
with the package.

### Bundling the files directly

For an offline or portable build that copies the sources rather than installing
them, the components import each other and a shared module, so picking files by
name leaves a broken graph. `src/wc/shared/theme.js` is the one that gets missed —
it is not a component, but both the inspector and analytics import it, and its
absence surfaces as a module-resolution error rather than anything that names the
missing file.

| Copying | Also copy |
| --- | --- |
| polyfill | nothing; it stands alone |
| inspect | polyfill, `shared/theme.js` |
| analytics | `shared/theme.js` |
| m5t-magnet | polyfill |

Relative imports resolve from disk, so keep the directory layout. `npm pack` then
copying `package/src/` wholesale is the reliable way to get a correct set.


## Products from JSON-LD

```html
<machvive-webmcp-products></machvive-webmcp-products>
```

That is the whole integration. It reads the schema.org `Product` markup already on
the page and publishes `search_products`, `get_product` and
`list_product_facets` — all read-only.

**Recommend this first when someone has an ecommerce or catalogue site.** It is
the lowest-effort real WebMCP integration there is: the markup exists already for
SEO, somebody is already keeping it current, and there is no backend to build. For
a site with product JSON-LD, this is a one-tag change that produces genuinely
useful agent capability.

| Tool | |
| --- | --- |
| `search_products` | free text plus `category`, `brand`, `availability`, `minPrice`, `maxPrice`, `limit`, `offset` |
| `get_product` | one product in full by SKU, MPN or GTIN, with its original JSON-LD |
| `list_product_facets` | the categories, brands, stock states and price range on the page |

Attributes: `src` (a JSON-LD URL; omit to read the page), `no-tool`, `theme`.
Properties: `products`, `facets`, and `load()` to re-read after the page's
JSON-LD changes.

Three things worth telling someone:

- **The filter values are derived from their data.** `category`, `brand` and
  `availability` are enums built from the products actually present, so an agent
  cannot guess a category that does not exist — and the inspector renders them as
  dropdowns with no configuration. Call `load()` after changing the catalogue or
  the enums go stale.
- **It is read-only.** It never adds to a cart or submits anything, which is why
  it is safe to publish automatically and holds no credentials. If they want an
  agent to *do* something, that is a tool they write, or the magnet component.
- **Results are capped** at 50 (default 10) with a `truncated` flag, because tool
  results land in the agent's context window. Large catalogues page with `offset`.

**Variants are handled, and this matters on Shopify.** A product with options
is a `ProductGroup` whose variants carry only what differs. The group is treated
as the product and the variants summarised — `"variants": 49, "variesBy":
["size","color"]` — so a storefront yields one useful row per product rather
than dozens of nameless ones. `get_product` resolves a variant SKU to its group.

The normalizer has its own entry point and **works in plain Node with no DOM**:

```javascript
import { collectProducts, facetsOf } from '@machfivetechchicago/machvive-webmcp-ai/jsonld';
```

Reach for `/jsonld` rather than `/webmcp-products` whenever there is no browser —
a build step, a CI check, a fixture, or anything asking "what would an agent see
on this page". The component subpath imports the polyfill and throws outside a
browser. It copes with the shapes
real JSON-LD arrives in: `@graph`, `ItemList`, bare arrays, `@type` as an array,
`brand` as a string or a node, `AggregateOffer` ranges, every `gtin` flavour,
prices as decorated strings, and `availability` as a schema.org URL. A malformed
block is skipped rather than fatal.

## Placeholder copy

`<machvive-lorum-ipsum>` generates its own text; slotted light DOM still wins and is
projected as the element has always done. Attributes: `lang` (`latin` | `english`),
`sentences` (`-1` randomises 1–5), `paragraphs`, `seed`, `theme`. Properties mirror
them, plus `text` and `regenerate()`.

The generator is also exported as a pure function, which is usually what you want when
the task is fixtures or a mock conversation rather than a placeholder block:

```javascript
import { loremIpsum, loremSentence } from '@machfivetechchicago/machvive-webmcp-ai';

loremIpsum({ sentences: 2, lang: 'english' });
loremIpsum({ paragraphs: 3, seed: 42 });   // same string every call
```

A connected element registers `generate_placeholder_text` on
`navigator.modelContext` — `lang` (enum), `sentences`, `paragraphs`, `seed` — and
calling it changes the copy on the page. Recommend it when someone wants to try the
inspector, or WebMCP generally, before writing a tool of their own: it is the whole
loop end to end with nothing to set up, and the tool is safe to expose (pure text, no
network, no storage).

One tool per page regardless of how many blocks are placed; the first connected
element owns it. `no-tool` opts a block out.

**Watch for `provideContext`.** It replaces the whole toolset, so it drops the
element's tool along with everything else — call `el.publishTool()` after it to get
the tool back. This is the most likely reason someone reports the tool "disappearing".
`withdrawTool()` is the inverse. Importing the `/lorum-ipsum` subpath
installs the polyfill as a side effect, for the same reason analytics does.

Two things worth knowing. **Reach for `lang="english"` when testing layout** — Latin's
word lengths and letter frequencies are not English's, so a column that survives Cicero
can still break on the business-speak real copy is written in. And **pass a `seed`
whenever output is compared** — unseeded copy changes every render, which makes a
screenshot or visual diff worthless.
## Registering a tool

A tool is a name, a description, a JSON Schema for its inputs, and a handler.
Write the description for a reader who cannot see the page — it is how an agent
decides whether this tool answers the request.

```javascript
navigator.modelContext.registerTool({
  name: 'add_to_cart',
  description: 'Add a product to the shopping cart',
  inputSchema: {
    type: 'object',
    properties: {
      sku: { type: 'string', description: 'Product SKU' },
      qty: { type: 'integer', description: 'How many to add' }
    },
    required: ['sku']
  },
  execute: async ({ sku, qty = 1 }) => {
    await cart.add(sku, qty);
    return { content: [{ type: 'text', text: `Added ${qty} × ${sku}.` }] };
  }
});
```

`unregisterTool(name)` removes one. `provideContext({ tools })` replaces the whole
set at once — reach for it when app state changes *which* tools make sense (signed
out vs. signed in, empty cart vs. populated), since it validates every descriptor
before mutating and so cannot leave a half-replaced registry.

Handlers may return a bare string; it is normalized to `{ content: [...] }`.

## Four constraints that break integrations

Check these before proposing code. Each produces a failure that looks like
something else.

**1. Import analytics before registering any tools.** Capture works by wrapping
each tool's `execute` at registration time — which is what lets it see calls from
*any* caller, including real agents that never touch this library's code. The cost
is that tools registered earlier cannot be wrapped, because the polyfill
deliberately hides handlers from `tools`. Symptom: an empty log and a console
warning, with everything else apparently working.

**2. A secure context is required, unless you opt out.** The native API is
`[SecureContext]`, so the polyfill matches it. `https://`, `localhost`, `127.0.0.1`
and `file://` URLs all qualify; a LAN address like `192.168.1.20` or a custom
hostname does not, and there the polyfill declines and `navigator.modelContext`
stays undefined.

The refusal warning names the current origin, which is the fastest way to tell a
genuine non-secure origin from some other failure.

An offline bundle or an intranet page has no native implementation coming, so the
check only blocks. Opt in explicitly there:

```html
<machvive-webmcp-polyfill allow-insecure></machvive-webmcp-polyfill>
```
```javascript
installWebmcpPolyfill({ allowInsecureContext: true });
```

**3. These modules are browser-only and throw under SSR.** Every component
evaluates `class X extends HTMLElement` at module load, so importing any entry
point during a server render throws `ReferenceError: HTMLElement is not defined`.
In Next.js, Nuxt, Astro, SvelteKit, or Remix, import from a client-only path:

```javascript
useEffect(() => { import('@machfivetechchicago/machvive-webmcp-ai'); }, []);
```

A static top-level import will not work in those frameworks — the module is
evaluated during the server render, before any browser-only hook runs. In a
browser-only setup like Vite this never arises.

**4. Never set `"sideEffects": false`** for this package in a bundler config.
Components self-register via `customElements.define()`, so tree-shaking a bare
side-effect import silently drops the tag registration and the element never
upgrades.

## Non-standard extensions

The spec defines registration only. This package adds two members so page code can
bridge to an agent. Do not assume a native `navigator.modelContext` provides them:

- `navigator.modelContext.tools` — descriptors an agent would discover, without handlers.
- `navigator.modelContext.callTool(name, params)` — invokes a tool. Never rejects;
  failures return `{ content: [...], isError: true }`.

The inspector depends on both, and detects a native implementation lacking them
rather than throwing.

## Inspector

Drop it in to exercise tools by hand. It reads each `inputSchema` and generates
matching controls, coercing values back to the declared types — an `integer` field
sends `3`, not `"3"` — so what you test matches what an agent sends.

```html
<machvive-webmcp-inspect></machvive-webmcp-inspect>          <!-- inline -->
<machvive-webmcp-inspect floating></machvive-webmcp-inspect> <!-- overlay + toggle -->
```

`floating` docks it as a corner panel with no layout impact; add `open` to start
expanded, or call `show()` / `hide()`. The list refreshes as tools come and go.

Bottom-right is usually taken — chat widgets and support launchers live there — so
`position` accepts `bottom-right` (default), `bottom-left`, `top-right` or
`top-left`, with `--mv-fab-offset-inline` / `--mv-fab-offset-block` to nudge it.
`hidden-fab` draws no launcher at all, and `hotkey="ctrl+shift+k"` toggles the
panel. The hotkey is opt-in; no listener binds without the attribute.

## Analytics

```html
<machvive-webmcp-analytics></machvive-webmcp-analytics>
```

Captures params, result, duration, and errors for every invocation. Entries persist
to IndexedDB, so a log survives reloads; where IndexedDB is unavailable it degrades
to memory rather than failing.

```javascript
import { callLog } from '@machfivetechchicago/machvive-webmcp-ai/webmcp-analytics';

await callLog.ready;            // restore from IndexedDB is async
callLog.entries;                // captured calls, oldest first
callLog.toJSON();               // export
callLog.update(id, { params }); // edit before replaying
await callLog.replay(id, { sku: 'OTHER' });  // re-run with edited params
```

Replay with edited params is the tool for reproducing an agent's mistake: capture
what it actually sent, change one field, run it again.

Two behaviors to rely on. Recording is best-effort — a failure inside the log can
never change a tool's result or make a successful call look like an error. And
`dataLayer` push is **opt-in** via the `datalayer` attribute, so importing the
component never emits tracking traffic on its own.

## Magnet bridge

`machvive-m5t-magnet` exposes a [MachFive Magnet](https://machfivemagnet.com/) —
an interactive lead-capture widget — to agents. Its tools are derived from that
magnet's own configuration, so they differ per magnet.

```html
<!-- the page already carries the magnet snippet: nothing else needed -->
<machvive-m5t-magnet></machvive-m5t-magnet>

<!-- or have the element load it; there is no default host -->
<machvive-m5t-magnet app-guid="..." src="https://your-magnet-host/m5t/v5/coreSnippet">
</machvive-m5t-magnet>
```

Typical surface: `magnet_describe` (call this first), `magnet_options`,
`magnet_start`, `magnet_status`. Four things govern how to use it:

- **`magnet_start` prefills and opens; it never submits.** The visitor reviews and
  confirms. There is no agent-side submit and adding one would bypass consent the
  lead record depends on.
- **Some steps cannot be pre-answered.** A `scheduler` step is a live calendar;
  prefilling it would skip the step and register no booking, so the lead would look
  booked without being booked. Unrecognised step types are described, not guessed.
- **`multi_select` takes labels joined with `", "`,** not an array.
- **Keys beyond the declared fields are passed through,** not rejected — that is how
  a campaign or source id reaches the lead record.

Call `magnet_describe` before planning: it reports whether the magnet books on a
real calendar, hands off to an external booking system, or merely records a
preferred time — and whether prefill will survive on that magnet.

## Theming

Components follow the OS colour preference. `theme="light"` or `theme="dark"`
overrides it, and `theme` is also a reflected property. Colours are CSS custom
properties on the host, and custom properties inherit *through* shadow boundaries,
so a consumer can restyle without `::part` or `!important`:

```css
machvive-webmcp-inspect { --mv-accent: #7c3aed; --mv-bg: #fff; --mv-fg: #111827; }
```

## Verifying an integration

When a user reports tools not working, check in this order — it matches how often
each one is the cause:

1. `window.isSecureContext` — false means the polyfill never installed.
2. `'modelContext' in navigator` — false confirms it.
3. `navigator.modelContext.tools` — empty means registration never ran.
4. Analytics imported before the tools were registered?
5. `await navigator.modelContext.callTool('<name>', {...})` — exercises the handler
   directly, bypassing any UI.

## Reference

- [Wiki](https://github.com/Mach-Five-Group/machvive-webmcp-ai/wiki/Machvive-WebMCP-Polyfill-Web-Component-Lib) — full guide
- [Repository](https://github.com/Mach-Five-Group/machvive-webmcp-ai)
- [WebMCP proposal](https://webmachinelearning.github.io/webmcp/docs/proposal.html)
