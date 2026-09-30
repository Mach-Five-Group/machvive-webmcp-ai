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
 * @param {{allowInsecureContext?: boolean}} [options] Set `allowInsecureContext`
 *   to install off a secure context — for an offline bundle or an intranet
 *   address, where no native implementation is coming.
 * @returns {boolean} true if this call installed the polyfill.
 */
export function installWebmcpPolyfill({ allowInsecureContext = false } = {}) {
  if ('modelContext' in navigator) return false;

  // The native API is [SecureContext], and matching it stops a page being built
  // against a surface the browser will never provide. That reasoning does not
  // hold everywhere: an offline bundle, or a page served to a LAN address, has
  // no native implementation coming and the check only blocks. Hence the opt-in.
  if (!window.isSecureContext && !allowInsecureContext) {
    console.warn(
      `WebMCP: ${globalThis.location?.origin ?? 'this page'} is not a secure context, so ` +
        'navigator.modelContext was not installed. A secure origin, localhost or 127.0.0.1 ' +
        'qualifies; ' +
        'a LAN address or custom hostname does not. For an offline or intranet bundle, opt in ' +
        'with <machvive-webmcp-polyfill allow-insecure> or ' +
        'installWebmcpPolyfill({ allowInsecureContext: true }).'
    );
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
    // Import-time install already ran and may have declined on a non-secure
    // context. Retry honouring the attribute, since the element is the first
    // point at which the page can say it means it.
    installWebmcpPolyfill({ allowInsecureContext: this.hasAttribute('allow-insecure') });
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
