/**
 * Polyfill for the WebMCP `navigator.modelContext` API.
 *
 * Mirrors the W3C Web Machine Learning CG proposal: registerTool / unregisterTool
 * for incremental changes, provideContext to replace the whole toolset at once.
 * https://webmachinelearning.github.io/webmcp/docs/proposal.html
 *
 * The polyfill is a registry only — it has no transport to an agent. Bridge code
 * (an extension, a devtools panel, a harness) listens for `machvive-webmcp-change`
 * on `window` and calls `navigator.modelContext.callTool(name, params)` to invoke.
 */

export const TOOLS_CHANGED_EVENT = 'machvive-webmcp-change';

function assertToolDescriptor(tool) {
  if (!tool || typeof tool !== 'object') {
    throw new TypeError('WebMCP: tool descriptor must be an object');
  }
  if (typeof tool.name !== 'string' || tool.name.length === 0) {
    throw new TypeError('WebMCP: tool.name must be a non-empty string');
  }
  if (typeof tool.execute !== 'function') {
    throw new TypeError(`WebMCP: tool "${tool.name}" must supply an execute() function`);
  }
}

// Handlers may return a bare string for convenience; the wire shape is always
// an MCP content array.
function normalizeResult(value) {
  if (value && Array.isArray(value.content)) return value;
  if (typeof value === 'string') return { content: [{ type: 'text', text: value }] };
  if (value === undefined || value === null) return { content: [] };
  return { content: [{ type: 'text', text: JSON.stringify(value) }] };
}

class ModelContextPolyfill {
  #tools = new Map();

  /** Adds one tool, leaving the rest of the registry intact. */
  registerTool(tool) {
    assertToolDescriptor(tool);
    this.#tools.set(tool.name, tool);
    this.#notify();
  }

  /** Removes one tool by name. Returns whether it was present. */
  unregisterTool(name) {
    const removed = this.#tools.delete(name);
    if (removed) this.#notify();
    return removed;
  }

  /** Replaces the entire toolset — use when app state changes what is available. */
  provideContext({ tools = [] } = {}) {
    tools.forEach(assertToolDescriptor);
    this.#tools.clear();
    for (const tool of tools) this.#tools.set(tool.name, tool);
    this.#notify();
  }

  /** Non-standard: the descriptors an agent would discover, minus the handlers. */
  get tools() {
    return [...this.#tools.values()].map(({ name, description, inputSchema }) => ({
      name,
      description,
      inputSchema
    }));
  }

  /** Non-standard: the invocation path a bridge uses to run a registered tool. */
  async callTool(name, params = {}) {
    const tool = this.#tools.get(name);
    if (!tool) {
      return { content: [{ type: 'text', text: `Unknown tool: ${name}` }], isError: true };
    }
    try {
      return normalizeResult(await tool.execute(params, this.#agent()));
    } catch (err) {
      return { content: [{ type: 'text', text: String(err?.message ?? err) }], isError: true };
    }
  }

  // The `agent` argument handed to execute(). Without a real agent channel the
  // callback simply runs in the page, which is the correct degraded behavior.
  #agent() {
    return { requestUserInteraction: (callback) => Promise.resolve().then(callback) };
  }

  #notify() {
    window.dispatchEvent(new CustomEvent(TOOLS_CHANGED_EVENT, { detail: { tools: this.tools } }));
  }
}

/**
 * Installs the polyfill. No-op when the browser ships WebMCP natively, so a page
 * always talks to the real implementation where one exists.
 *
 * @returns {boolean} true if this call installed the polyfill.
 */
export function installWebmcpPolyfill() {
  if ('modelContext' in navigator) return false;

  // The native API is [SecureContext]; matching that keeps http:// pages from
  // developing against a surface the browser will never give them.
  if (!window.isSecureContext) {
    console.warn('WebMCP: navigator.modelContext is a secure-context API; polyfill not installed.');
    return false;
  }

  Object.defineProperty(navigator, 'modelContext', {
    value: new ModelContextPolyfill(),
    configurable: true,
    enumerable: false,
    writable: false
  });
  return true;
}

export class MachviveWebmcpPolyfill extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
  }

  connectedCallback() {
    installWebmcpPolyfill();
    this.shadowRoot.innerHTML = `<style>:host { display: none; }</style>`;
  }

  /** Convenience passthroughs so markup-driven pages need not reach into navigator. */
  registerTool(tool) {
    return navigator.modelContext?.registerTool(tool);
  }

  unregisterTool(name) {
    return navigator.modelContext?.unregisterTool(name);
  }
}

// Installing on import (not just on upgrade) means tools can be registered before
// the element is parsed.
installWebmcpPolyfill();

if (!customElements.get('machvive-webmcp-polyfill')) {
  customElements.define('machvive-webmcp-polyfill', MachviveWebmcpPolyfill);
}
