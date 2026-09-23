---
name: machvive-webmcp
description: Build agent-callable web pages with the machvive WebMCP components (@machfivetechchicago/machvive-webmcp-ai) — registering tools an AI agent can invoke through navigator.modelContext, plus the inspector and analytics components. Use this whenever the user mentions WebMCP, navigator.modelContext, modelContext, machvive, agent-readable or agent-callable pages, exposing site functionality to AI agents, registering tools a browser agent can call, or capturing and replaying agent tool calls — even when they don't name the package. Also use when someone asks how an AI agent could use their site's functionality instead of scraping the DOM, or is debugging why their registered tools aren't being captured or discovered.
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
| `<machvive-lorum-ipsum>` | Placeholder copy (unrelated to WebMCP) |

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
`/webmcp-analytics`, `/lorum-ipsum`. TypeScript declarations ship with the package.

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

**2. A secure context is required.** The native API is `[SecureContext]`, so the
polyfill matches it: HTTPS and `localhost` only. On plain HTTP it declines with a
console warning and `navigator.modelContext` stays undefined. A staging box served
over HTTP will look broken for no visible reason.

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
