/**
 * Polyfill for the WebMCP `document.modelContext` API.
 *
 * Tracks the W3C spec at https://github.com/webmachinelearning/webmcp — not the
 * older `navigator.modelContext` explainer, which is stale. Chrome 149 and Edge
 * 150 ship the document-scoped API behind an origin trial, and Brave, ChatGPT
 * Desktop and Meta's glasses implement it too.
 *
 * What this provides, matching the spec:
 *   registerTool(tool, { signal })  -> Promise, rejects on a duplicate name
 *   getTools()                      -> Promise<RegisteredTool[]>
 *   executeTool(tool, input, opts)  -> Promise<DOMString>, a JSON string
 *   ontoolchange / ontoolactivated / ontoolcancel
 *
 * Unregistration is by `AbortSignal`, which is why `unregisterTool` and
 * `provideContext` are gone: the spec removed both, and keeping them meant the
 * same call doing different things depending on whether the browser was native.
 */

/** The spec's event name. `machvive-webmcp-change` was ours and is retired. */
export const TOOL_CHANGE_EVENT = 'toolchange';

function assertToolDescriptor(tool) {
  if (!tool || typeof tool !== 'object') {
    throw new TypeError('WebMCP: tool descriptor must be an object');
  }
  if (typeof tool.name !== 'string' || tool.name.length === 0) {
    throw new TypeError('WebMCP: tool.name must be a non-empty string');
  }
  // `description` is required by the spec, and it is the only documentation an
  // agent has when choosing between tools — a missing one is a silent failure
  // to be chosen, not an error anyone would see.
  if (typeof tool.description !== 'string' || tool.description.length === 0) {
    throw new TypeError(`WebMCP: tool "${tool.name}" must supply a description`);
  }
  if (typeof tool.execute !== 'function') {
    throw new TypeError(`WebMCP: tool "${tool.name}" must supply an execute() function`);
  }
}

/** The shape `getTools()` exposes: descriptors, never handlers. */
function toRegistered(tool) {
  return {
    name: tool.name,
    title: tool.title,
    description: tool.description,
    inputSchema: tool.inputSchema,
    annotations: tool.annotations,
    window: globalThis.window,
    // globalThis.location is absent when jsdom globals are installed piecemeal.
    origin: globalThis.location?.origin ?? globalThis.window?.location?.origin ?? ''
  };
}

class ModelContextPolyfill extends EventTarget {
  #tools = new Map();

  /**
   * @param {object} tool
   * @param {{signal?: AbortSignal}} [options] Aborting the signal unregisters it.
   * @returns {Promise<undefined>}
   */
  registerTool(tool, options = {}) {
    try {
      assertToolDescriptor(tool);
    } catch (error) {
      return Promise.reject(error);
    }
    if (this.#tools.has(tool.name)) {
      return Promise.reject(new DOMException(
        `WebMCP: a tool named "${tool.name}" is already registered`, 'InvalidStateError'));
    }

    const signal = options.signal;
    // An already-aborted signal registers nothing, rather than registering a
    // tool that is immediately removed and fires two events doing it.
    if (signal?.aborted) return Promise.resolve();

    this.#tools.set(tool.name, tool);
    signal?.addEventListener('abort', () => {
      if (this.#tools.get(tool.name) === tool) {
        this.#tools.delete(tool.name);
        this.#notify();
      }
    }, { once: true });

    this.#notify();
    return Promise.resolve();
  }

  /** @returns {Promise<Array<object>>} */
  getTools() {
    return Promise.resolve([...this.#tools.values()].map(toRegistered));
  }

  /**
   * Runs a tool and resolves with its JSON-serialized result, as the spec does.
   *
   * @param {{name: string}|string} tool A RegisteredTool, or a bare name.
   * @returns {Promise<string>}
   */
  async executeTool(tool, inputObject = {}, options = {}) {
    const name = typeof tool === 'string' ? tool : tool?.name;
    const found = this.#tools.get(name);
    if (!found) {
      throw new DOMException(`WebMCP: no tool named "${name}"`, 'NotFoundError');
    }

    // Each execution gets its own signal. Withdrawing a registration does not
    // cancel an execution already in flight; the spec treats them separately.
    const controller = new AbortController();
    options.signal?.addEventListener('abort', () => controller.abort(options.signal.reason), { once: true });

    this.dispatchEvent(new Event('toolactivated'));
    try {
      const value = await found.execute(inputObject, { signal: controller.signal });
      // The platform serializes the fulfilled value; a handler returning a
      // string gets it back verbatim rather than JSON-quoted.
      return typeof value === 'string' ? value : JSON.stringify(value ?? null);
    } catch (error) {
      if (controller.signal.aborted) this.dispatchEvent(new Event('toolcancel'));
      throw error;
    }
  }

  #notify() {
    this.dispatchEvent(new Event(TOOL_CHANGE_EVENT));
  }
}

// `ontoolchange` and friends, so a page can assign a handler rather than add a
// listener. EventTarget gives no `on*` support for free.
for (const type of ['toolchange', 'toolactivated', 'toolcancel']) {
  const key = Symbol(`on${type}`);
  Object.defineProperty(ModelContextPolyfill.prototype, `on${type}`, {
    configurable: true,
    get() { return this[key] ?? null; },
    set(handler) {
      if (this[key]) this.removeEventListener(type, this[key]);
      this[key] = typeof handler === 'function' ? handler : null;
      if (this[key]) this.addEventListener(type, this[key]);
    }
  });
}

/**
 * Installs the polyfill at `document.modelContext`.
 *
 * Native is detected **at `document`, first**. An existing `navigator.modelContext`
 * says nothing: it may be an older copy of this very polyfill, and deferring to
 * it would leave the page talking to a registry no agent can see.
 *
 * @param {{allowInsecureContext?: boolean}} [options]
 * @returns {boolean} true if this call installed the polyfill.
 */
export function installWebmcpPolyfill({ allowInsecureContext = false } = {}) {
  const doc = globalThis.document;
  if (!doc) return false;

  // A real implementation, or one we installed earlier. Either way, leave it.
  if (doc.modelContext && typeof doc.modelContext.registerTool === 'function') return false;

  // The native API is [SecureContext], and matching it stops a page being built
  // against a surface the browser will never provide. That reasoning does not
  // hold everywhere: an offline bundle, or a page served to a LAN address, has
  // no native implementation coming and the check only blocks. Hence the opt-in.
  // In a browser globalThis *is* window; under a harness that installs jsdom
  // globals piecemeal it is not, and reading only one of them silently refuses
  // to install.
  const secure = globalThis.isSecureContext ?? globalThis.window?.isSecureContext;
  if (!secure && !allowInsecureContext) {
    console.warn(
      `WebMCP: ${globalThis.location?.origin ?? 'this page'} is not a secure context, so ` +
        'document.modelContext was not installed. A secure origin, localhost or 127.0.0.1 ' +
        'qualifies; a LAN address or custom hostname does not. For an offline or intranet ' +
        'bundle, opt in with <machvive-webmcp-polyfill allow-insecure> or ' +
        'installWebmcpPolyfill({ allowInsecureContext: true }).'
    );
    return false;
  }

  Object.defineProperty(doc, 'modelContext', {
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

  /** Convenience passthrough so markup-driven pages need not reach into document. */
  registerTool(tool, options) {
    return globalThis.document?.modelContext?.registerTool(tool, options);
  }

  getTools() {
    return globalThis.document?.modelContext?.getTools();
  }
}

// Installing on import (not just on upgrade) means tools can be registered before
// the element is parsed.
installWebmcpPolyfill();

if (!customElements.get('machvive-webmcp-polyfill')) {
  customElements.define('machvive-webmcp-polyfill', MachviveWebmcpPolyfill);
}
