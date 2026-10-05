<h1 align="center">machvive-webmcp-ai</h1>

<p align="center">
  <strong>"I don't want to use your product's agent; I want my agent to be able to use your product."</strong><br>
  Vanilla Web Components that make a page agent-ready — by
  <a href="https://github.com/Mach-Five-Group">MachFiveTech Chicago</a>.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@machfivetechchicago/machvive-webmcp-ai"><img alt="npm" src="https://img.shields.io/npm/v/@machfivetechchicago/machvive-webmcp-ai.svg"></a>
  <a href="LICENSE"><img alt="license" src="https://img.shields.io/npm/l/@machfivetechchicago/machvive-webmcp-ai.svg"></a>
  <img alt="types" src="https://img.shields.io/badge/types-included-blue.svg">
  <img alt="dependencies" src="https://img.shields.io/badge/dependencies-0-brightgreen.svg">
  <a href="https://github.com/Mach-Five-Group/machvive-webmcp-ai/wiki/Machvive-WebMCP-Polyfill-Web-Component-Lib"><img alt="docs" src="https://img.shields.io/badge/docs-wiki-blue.svg"></a>
  <a href="https://mach-five-group.github.io/webmcp-playground/"><img alt="live demo" src="https://img.shields.io/badge/demo-live-success.svg"></a>
</p>

WebMCP empowers agents by giving them access to your core business functionality within a safe, semantic sandbox.

A Business Accelerator is a targeted, authoritative, conversion-optimized landing page with automated onboarding that facilitates a non-linear, multi-touch sales cycle. Exposing your Business Accelerators to agents makes perfect sense: it gives agents access to interactive experiences that deliver real business value—not just content.

But if agents are becoming part of your customer journey, you need to understand how they engage with your site. We give you the tools to measure that engagement. Record agent sessions and play them back to see exactly how they navigate, interact, and use your Business Accelerators. This gives you detailed insight into agent behavior—and into the broader ecosystem of agent-driven engagement.

No framework, no build step, no runtime dependencies — just standards-based custom
elements with Shadow DOM that work anywhere `customElements` does.

| Component | Tag | What it does |
| --- | --- | --- |
| WebMCP polyfill | `<machvive-webmcp-polyfill>` | Shims `navigator.modelContext` so a page can expose tools to AI agents |
| WebMCP inspector | `<machvive-webmcp-inspect>` | Lists registered tools, builds a form from each schema, runs them |
| WebMCP analytics | `<machvive-webmcp-analytics>` | Captures every tool call for listing, editing, export, replay, and dataLayer |
| M5T Magnet | `<machvive-m5t-magnet>` | Exposes a MachFive Magnet's lead capture to agents |
| Lorum Ipsum | `<machvive-lorum-ipsum>` | Generates placeholder copy, and publishes it as a WebMCP tool |

📖 **[Read the full guide on the Wiki](https://github.com/Mach-Five-Group/machvive-webmcp-ai/wiki/Machvive-WebMCP-Polyfill-Web-Component-Lib)** — what WebMCP is and why it beats
scripted clicking, how the components compose, and the constraints worth knowing
before you adopt. For the commercial case rather than the technical one, start with
**[WebMCP as a Business Accelerator](https://github.com/Mach-Five-Group/machvive-webmcp-ai/wiki/WebMCP-as-a-Business-Accelerator)**.

🎮 **[Try the live playground](https://mach-five-group.github.io/webmcp-playground/)** — a running WebMCP endpoint. Point
[Browser Use](https://github.com/browser-use/browser-use) or your own agent at it
and watch it discover and call the page's tools without touching the DOM. Source:
[webmcp-playground](https://github.com/Mach-Five-Group/webmcp-playground).

<img width="1098" height="894" alt="m5t_machvive_ai_webmcp" src="https://github.com/user-attachments/assets/a1433ff0-f8a9-46fb-ad59-735aed155ff8" />

## ⚡ Integration with Vite (Vanilla JS)

This package is optimized for modern ESM environments like Vite. You can import individual components or the entire library at once.

### 1. Installation
Install the package via NPM into your Vite project:
```bash
npm install @machfivetechchicago/machvive-webmcp-ai
```

### 2. Import Components
Inside your main entry script (e.g., `main.js` or `index.js`), import the components you need to register them with the browser's `customElements` registry.

#### Option A: Cherry-Pick (Recommended for smaller production bundles)
```javascript
// Import only the specific tools your app requires
import '@machfivetechchicago/machvive-webmcp-ai/webmcp-polyfill';
import '@machfivetechchicago/machvive-webmcp-ai/lorum-ipsum';
```

#### Option B: Bulk Import (Registers all components at once)
```javascript
// Quick setup to make all components available globally
import '@machfivetechchicago/machvive-webmcp-ai';
```

### 3. Use in HTML
Once imported, use the tags directly in your markup. Because these are vanilla Web Components utilizing the Shadow DOM, they are fully isolated and work out of the box in `index.html`:

```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>Vite App</title>
  </head>
  <body>
    <!-- Use your custom elements anywhere -->
    <machvive-lorum-ipsum></machvive-lorum-ipsum>

    <script type="module" src="/main.js"></script>
  </body>
</html>
```

## 🤖 WebMCP Polyfill

`machvive-webmcp-polyfill` installs a `navigator.modelContext` shim following the
[W3C WebMCP proposal](https://webmachinelearning.github.io/webmcp/docs/proposal.html),
so a page can declare agent-callable tools before browsers ship the API natively.

It is a no-op when the browser already implements WebMCP, so your page always talks
to the real implementation where one exists. Because the native API is
`[SecureContext]`, the polyfill installs only on a secure origin — which includes
`localhost`, `127.0.0.1`, and `file://` URLs in most browsers.

### Offline and intranet bundles

That default mirrors the native API so you cannot build against a surface the
browser will never provide. It does not fit every case: an offline bundle, or a
page served to a LAN address like `192.168.1.20`, has no native implementation
coming, and the check only blocks. Opt in there:

```html
<machvive-webmcp-polyfill allow-insecure></machvive-webmcp-polyfill>
```

```javascript
import { installWebmcpPolyfill } from '@machfivetechchicago/machvive-webmcp-ai/webmcp-polyfill';
installWebmcpPolyfill({ allowInsecureContext: true });
```

The element retries the install, so the attribute works even though the module
installs on import. The refusal warning names the current origin and both escape
hatches, so the cause is visible from the console.

```html
<machvive-webmcp-polyfill></machvive-webmcp-polyfill>
```

Importing the module installs the shim immediately — you can register tools without
waiting for the element to upgrade:

```javascript
import '@machfivetechchicago/machvive-webmcp-ai/webmcp-polyfill';

navigator.modelContext.registerTool({
  name: 'add_to_cart',
  description: 'Add a product to the shopping cart',
  inputSchema: {
    type: 'object',
    properties: { sku: { type: 'string', description: 'Product SKU' } },
    required: ['sku']
  },
  execute: async ({ sku }) => {
    await cart.add(sku);
    return { content: [{ type: 'text', text: `Added ${sku} to cart.` }] };
  }
});
```

Use `unregisterTool(name)` to drop a single tool, or `provideContext({ tools })` to
replace the whole toolset when app state changes which tools make sense.

### Bridging to an agent

The polyfill is a registry — it has no transport. Bridge code (an extension, a
devtools panel, a test harness) discovers tools and invokes them:

```javascript
import { TOOLS_CHANGED_EVENT } from '@machfivetechchicago/machvive-webmcp-ai/webmcp-polyfill';

window.addEventListener(TOOLS_CHANGED_EVENT, (e) => console.log(e.detail.tools));

const result = await navigator.modelContext.callTool('add_to_cart', { sku: 'M5T-001' });
```

`navigator.modelContext.tools` returns the descriptors minus their handlers.
`callTool` never throws: a handler that rejects comes back as
`{ content: [...], isError: true }`.

## 🔎 Inspector

`machvive-webmcp-inspect` lists every registered tool, renders a form from its
`inputSchema`, and executes it with what you type. Values are coerced to the types
the schema declares — an `integer` field sends `3`, not `"3"` — required fields are
enforced before anything runs, and `object`/`array` fields accept JSON.

```html
<!-- inline: renders where you place it -->
<machvive-webmcp-inspect></machvive-webmcp-inspect>

<!-- floating: docks as an overlay panel with a toggle, no layout impact -->
<machvive-webmcp-inspect floating></machvive-webmcp-inspect>

<!-- floating and expanded on load -->
<machvive-webmcp-inspect floating open></machvive-webmcp-inspect>

<!-- bottom-right is crowded: chat widgets and support launchers live there too -->
<machvive-webmcp-inspect floating position="bottom-left"></machvive-webmcp-inspect>

<!-- no launcher drawn; opens on the key combo instead -->
<machvive-webmcp-inspect floating hidden-fab hotkey="ctrl+shift+k"></machvive-webmcp-inspect>
```

`position` takes `bottom-right` (default), `bottom-left`, `top-right` or
`top-left`, and `--mv-fab-offset-inline` / `--mv-fab-offset-block` nudge it from
the edge. `hotkey` is opt-in — a component that claimed a key combination on
every page embedding it would be a poor guest, so no listener binds without it.

`show()` and `hide()` drive the panel from script. The list refreshes automatically
as tools are registered or removed.

## 📊 Analytics

`machvive-webmcp-analytics` captures every WebMCP invocation — params, result,
duration, and errors — then lets you list, edit, export, replay, or forward them.

```javascript
import '@machfivetechchicago/machvive-webmcp-ai/webmcp-analytics';
```

```html
<machvive-webmcp-analytics></machvive-webmcp-analytics>
```

**Import it before you register tools.** Capture works by wrapping each tool's
handler at registration time, so anything registered earlier is invisible to it —
the component warns in the console when it detects this. Wrapping the handler rather
than the caller is deliberate: it records invocations from *any* caller, including a
native `navigator.modelContext` and real agents, neither of which route through this
library.

Captured calls persist to **IndexedDB**, so a log survives reloads and is not bound
by the ~5 MB localStorage ceiling. The store degrades to memory-only where IndexedDB
is unavailable. The default cap is 500 entries, oldest evicted first.

### Working with the log

```javascript
import { callLog } from '@machfivetechchicago/machvive-webmcp-ai/webmcp-analytics';

await callLog.ready;            // restore from IndexedDB is async

callLog.entries;                // captured calls, oldest first
callLog.toJSON();               // export as JSON
callLog.import(json);           // merge a previously exported log
callLog.update(id, { params }); // edit before replaying
await callLog.replay(id);                    // re-run as captured
await callLog.replay(id, { sku: 'OTHER' });  // re-run with edited params
```

Recording is strictly best-effort: a failure inside the log — a throwing subscriber,
an unwritable store — can never change a tool's result or make a passing call look
like it errored.

### Google Tag Manager

Pushing to `window.dataLayer` is **off unless you opt in**, so importing the
component never emits tracking traffic on its own:

```html
<machvive-webmcp-analytics datalayer></machvive-webmcp-analytics>
```

Each call then pushes `{ event: 'webmcp_tool_call', webmcp_tool, webmcp_status,
webmcp_duration_ms, webmcp_params }`. Without the attribute, push individual entries
on demand with `callLog.pushToDataLayer(id)` or the per-entry button in the UI.

## 🧲 M5T Magnet

`machvive-m5t-magnet` bridges a [MachFive Magnet](https://machfivemagnet.com/) —
an interactive widget that automates conversational lead generation — to WebMCP,
so an agent can use it the way a visitor would.

```html
<!-- the page already carries your magnet snippet: nothing else needed -->
<script src="https://your-magnet-host/m5t/v5/coreSnippet?appguid=..." async></script>
<machvive-m5t-magnet></machvive-m5t-magnet>

<!-- or have the element load it, naming the origin your magnet admin gave you -->
<machvive-m5t-magnet app-guid="your-app-guid" src="https://your-magnet-host/m5t/v5/coreSnippet">
</machvive-m5t-magnet>
```

The package embeds no host. Where your magnet is served from is runtime
configuration, so this package ships no external URLs and a change of hosting
costs you no upgrade.

```javascript
import '@machfivetechchicago/machvive-webmcp-ai/m5t-magnet';
```

It loads the magnet snippet, waits for the runtime, and registers tools. It
renders nothing itself — the magnet draws its own launcher.

### The tools come from your magnet, not from this package

A magnet already declares what it collects: each step's field, type, prompt, and
options. That declaration *is* an agent interface, so the tool surface is derived
from it. Configure a new step in your magnet admin and it appears to agents with
no code change here.

Against a magnet asking product interest, name, and email, you get:

| Tool | |
| --- | --- |
| `magnet_describe` | what the form asks and whether it can schedule |
| `magnet_options` | allowed choices for a multiple-choice field |
| `magnet_start` | open the form with answers filled in |
| `magnet_status` | has the visitor submitted yet |

`magnet_options` only appears if something has choices. Add a `booking` step and
`magnet_describe` starts reporting that the magnet can schedule a meeting.

### The agent fills in; the visitor submits

`magnet_start` prefills and opens the widget. It does **not** submit. An agent
posting someone's email address without them seeing it is a consent problem, and
lead capture is exactly where that matters.

Some steps can't be pre-answered at all. A `scheduler` step is the important one:
if it were prefilled the step would be skipped, so a remote booking would never
register and the lead would look booked without being booked. Step types this
package doesn't recognise degrade the same way — described, not guessed at.

Keys beyond the declared fields are passed through rather than rejected — that's
how a campaign or source id reaches the lead record.

On a magnet that opens with a welcome card and buttons, the widget clears answers
when the visitor taps one, so prefill doesn't survive. `magnet_describe` says so.

Invalid input comes back as data so the agent can correct itself:

```
"Nope" is not a choice for product_interest.
Options: Evaluating MachVive | Building with it and need help | ...
```

### Events

`magnet-ready` when tools register, `magnet-capture` when a visitor submits, and
`magnet-error` if the runtime never loads. The element also exposes `.config`
(the magnet definition it bound to) and `.captures`.

## 🌓 Theming

The UI components follow the viewer's OS preference automatically — no
configuration, no flash of the wrong palette. Set `theme` to override:

```html
<machvive-webmcp-inspect></machvive-webmcp-inspect>              <!-- follows the OS -->
<machvive-webmcp-analytics theme="dark"></machvive-webmcp-analytics>
<machvive-webmcp-inspect theme="light"></machvive-webmcp-inspect>
```

`theme` is also a reflected property, so `el.theme = 'dark'` and
`el.theme = null` (back to following the OS) work from script.

### Overriding the palette

Colors are CSS custom properties on the host. Custom properties inherit *through*
shadow boundaries where ordinary styles do not, so you can restyle the components
from your own stylesheet without `::part` or `!important`:

```css
machvive-webmcp-inspect,
machvive-webmcp-analytics {
  --mv-accent: #7c3aed;
  --mv-bg: #ffffff;
  --mv-fg: #111827;
  --mv-border: #e5e7eb;
}
```

Every token has both a light and a dark value; overriding one replaces it in both
themes unless you scope your override inside your own media query.

| Token | Role |
| --- | --- |
| `--mv-fg` / `--mv-muted` / `--mv-faint` | Text: primary, secondary, hints |
| `--mv-bg` / `--mv-surface` / `--mv-input-bg` | Panel, raised areas, form fields |
| `--mv-border` / `--mv-border-soft` / `--mv-control-border` | Outlines, dividers, controls |
| `--mv-hover` / `--mv-selected` | Interactive states |
| `--mv-accent` / `--mv-accent-fg` | Primary button |
| `--mv-ok-bg` / `--mv-ok-fg` / `--mv-err-bg` / `--mv-err-fg` | Status badges |
| `--mv-danger` / `--mv-danger-border` | Destructive actions |

Every combination of OS preference and `theme` is verified to meet WCAG AA
(≥ 4.5:1) across the full UI. If you override tokens, re-check your own contrast.

## 🤖 Claude Code skill

If you build with [Claude Code](https://claude.com/claude-code), install the
companion skill so Claude knows how to use these components — the API, and the
constraints that quietly break integrations:

```
/plugin marketplace add Mach-Five-Group/machvive-webmcp-ai
/plugin install machvive-webmcp@machvive
```

Claude then knows to import analytics before registering tools, that the polyfill
needs a secure context, that a top-level import breaks under SSR, and that
`sideEffects: false` silently drops the component registrations — the four things
that fail in ways that look like something else.


## Placeholder copy

`<machvive-lorum-ipsum>` generates its own text. Slotted content still wins, so
anything you put inside it is projected as before — the generated copy is the
fallback.

```html
<machvive-lorum-ipsum sentences="3"></machvive-lorum-ipsum>
<machvive-lorum-ipsum lang="english" paragraphs="2" seed="7"></machvive-lorum-ipsum>
```

| Attribute | Default | Meaning |
| --- | --- | --- |
| `lang` | `latin` | `latin` or `english`. Anything else falls back to Latin |
| `sentences` | `5` | Sentences per paragraph. `-1` picks 1–5 at random |
| `paragraphs` | `1` | Joined by a blank line |
| `seed` | — | Omit for fresh copy; set for repeatable output |
| `theme` | *OS* | `light` or `dark` |

Properties mirror the attributes, plus `text` (what it rendered) and
`regenerate()` (fresh copy; a seeded element rerolls identically).

**`lang="english"` is the one worth reaching for.** Latin is the convention, but its
word lengths and letter frequencies are not English's — a column that survives Cicero
can still break on business-speak, which is the register your real copy is written in.

The generator is pure and DOM-free, so it is useful well beyond the element — seeding a
mock chat, filling a fixture, stress-testing a column:

```js
import { loremIpsum, loremSentence, WORD_BANKS } from '@machfivetechchicago/machvive-webmcp-ai';

loremIpsum({ sentences: 2, lang: 'english' });
loremIpsum({ paragraphs: 3, seed: 42 });   // identical every call
loremSentence({ lang: 'english' });
```

**Seeds matter more than they look.** Without one, a page regenerates different copy on
every render, which turns a visual diff into noise and makes a screenshot worthless as a
regression check.

### It publishes a tool

A connected `<machvive-lorum-ipsum>` registers `generate_placeholder_text` on
`navigator.modelContext`, so a page has something real for an agent — or the
[inspector](#inspector) — to call before its author has written a tool of their own.
Open the inspector, pick the tool, fill in the form, run it, and the copy on the page
changes. That is the whole WebMCP loop, verifiable on day one.

It is a deliberately safe tool to hand out: pure text generation, no network, no
storage, no state beyond the element itself.

| Parameter | Type | |
| --- | --- | --- |
| `lang` | enum | `latin` or `english` — renders as a select |
| `sentences` | integer | per paragraph; `-1` randomises 1–5 |
| `paragraphs` | integer | |
| `seed` | integer | omit for fresh copy |

One tool per page however many blocks you place — tool names are a page-wide
namespace, so the first connected element owns it and hands it on if it is removed.
Add `no-tool` to opt a block out, or to every block to publish nothing.

```html
<machvive-lorum-ipsum no-tool></machvive-lorum-ipsum>
```

Because of this, importing `@machfivetechchicago/machvive-webmcp-ai/lorum-ipsum`
installs the polyfill too. That is deliberate — a component that registers tools
against a registry that may not exist yet is how the analytics component once shipped
capturing nothing.

Ported from the [Lorem Ipsum Generator](https://www.thescottkrause.com/devtoys/lorem_ipsum_generator/).

## TypeScript

Declarations ship with the package — no `@types/*` needed. Importing a component
augments `HTMLElementTagNameMap`, so `querySelector` returns the real element type,
and the polyfill declares `navigator.modelContext` plus the change event:

```typescript
import '@machfivetechchicago/machvive-webmcp-ai/webmcp-polyfill';
import type { WebmcpToolResult } from '@machfivetechchicago/machvive-webmcp-ai';

const el = document.querySelector('machvive-lorum-ipsum'); // MachviveLorumIpsum | null
const res: WebmcpToolResult = await navigator.modelContext.callTool('add_to_cart', { sku: 'A' });
```

Verified against `moduleResolution: "bundler"` and `"node16"` under `--strict`.

## Server-Side Rendering (SSR)

These are browser components. Both classes extend `HTMLElement` at module load — not
when an element is created — so importing the package on a server, where no DOM
exists, throws immediately:

```
ReferenceError: HTMLElement is not defined
```

This never happens in a browser-only setup like Vite, where `HTMLElement` is always
present. It comes up only in frameworks that render on the server first — Next.js,
Nuxt, Astro, SvelteKit, Remix. Import the package from a client-only path instead:

```javascript
// Next.js (App Router) — mark the component "use client", then import on mount
'use client';
import { useEffect } from 'react';

export default function Page() {
  useEffect(() => { import('@machfivetechchicago/machvive-webmcp-ai'); }, []);
  return <machvive-lorum-ipsum>Hello</machvive-lorum-ipsum>;
}
```

```javascript
// Nuxt — onMounted only runs in the browser
onMounted(() => import('@machfivetechchicago/machvive-webmcp-ai'));
```

```javascript
// SvelteKit — onMount only runs in the browser
import { onMount } from 'svelte';
onMount(() => import('@machfivetechchicago/machvive-webmcp-ai'));
```

In Astro, put the import in a `<script>` tag — those are client-side by default —
rather than in the component's frontmatter.

A static top-level `import` will not work in any of these: the module is evaluated
during the server render, before any browser-only lifecycle hook gets a chance to run.
Use the dynamic `import()` form shown above.

## The rest of the ecosystem

| | |
| --- | --- |
| [webmcp-playground](https://mach-five-group.github.io/webmcp-playground/) · [source](https://github.com/Mach-Five-Group/webmcp-playground) | A live page built with these components, publishing callable tools over HTTPS |
| [webmcp-browser-use](https://github.com/Mach-Five-Group/webmcp-browser-use) | Drive that page with a real AI agent — discovers the tools and calls them, never touching the DOM |

## Documentation

The **[project Wiki](https://github.com/Mach-Five-Group/machvive-webmcp-ai/wiki)** carries the long-form material:

| | |
| --- | --- |
| [WebMCP as a Business Accelerator](https://github.com/Mach-Five-Group/machvive-webmcp-ai/wiki/WebMCP-as-a-Business-Accelerator) | Why an agent is not just another visitor, and what that changes for a business |
| [Agent Topologies](https://github.com/Mach-Five-Group/machvive-webmcp-ai/wiki/Agent-Topologies) | The two ways an agent reaches your page, and why the examples only show one |
| [Machvive WebMCP Polyfill Web Component Lib](https://github.com/Mach-Five-Group/machvive-webmcp-ai/wiki/Machvive-WebMCP-Polyfill-Web-Component-Lib) | Full guide: the components, how they compose, adoption constraints |
| [Magnet Integration](https://github.com/Mach-Five-Group/machvive-webmcp-ai/wiki/Magnet-Integration) | Exposing a MachFive Magnet's lead capture to agents |
| [WebMCP Chat Bridge](https://github.com/Mach-Five-Group/machvive-webmcp-ai/wiki/WebMCP-Chat-Bridge) | Wiring an in-page chat component to the page's own tools |

## License

[Apache-2.0](LICENSE) © MachFiveTech Chicago
