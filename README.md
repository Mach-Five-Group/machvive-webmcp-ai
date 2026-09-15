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
</p>

WebMCP empowers agents by giving them access to your core business functionality within a safe, semantic sandbox.

A Business Accelerator is a targeted, authoritative, conversion-optimized landing page with automated onboarding that facilitates a non-linear, multi-touch sales cycle. Exposing your Business Accelerators to agents makes perfect sense: it gives agents access to interactive experiences that deliver real business value—not just content.

But if agents are becoming part of your customer journey, you need to understand how they engage with your site. We give you the tools to measure that engagement. Record agent sessions and play them back to see exactly how they navigate, interact, and use your Business Accelerators. This gives you detailed insight into agent behavior—and into the broader ecosystem of agent-driven engagement.

No framework, no build step, no runtime dependencies — just standards-based custom
elements with Shadow DOM that work anywhere `customElements` does.

| Component | Tag | What it does |
| --- | --- | --- |
| WebMCP polyfill | `<machvive-webmcp-polyfill>` | Shims `navigator.modelContext` so a page can expose tools to AI agents |
| Lorum Ipsum | `<machvive-lorum-ipsum>` | Placeholder copy that projects slotted content |

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
`[SecureContext]`, the polyfill installs only on HTTPS (and `localhost`).

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

## License

[Apache-2.0](LICENSE) © MachFiveTech Chicago
