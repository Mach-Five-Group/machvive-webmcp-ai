const POLYFILL_URL = new URL('../src/wc/machvive-webmcp-polyfill/machvive-webmcp-polyfill.js', import.meta.url).href;

let bust = 0;

/**
 * Imports a fresh copy of the polyfill module under chosen conditions.
 *
 * The module installs itself on import, so the install guard can only be
 * exercised by defeating the ESM cache. `nativeImpl` stands in for a browser
 * that already ships WebMCP — and it is installed at `document`, because that
 * is where the spec puts it and where the guard must look.
 */
export async function loadPolyfill({ secureContext = true, nativeImpl = null } = {}) {
  delete document.modelContext;
  if (nativeImpl) {
    Object.defineProperty(document, 'modelContext', { value: nativeImpl, configurable: true });
  }
  Object.defineProperty(globalThis, 'isSecureContext', { value: secureContext, configurable: true });
  window.isSecureContext = secureContext;

  const warnings = [];
  const realWarn = console.warn;
  console.warn = (...args) => warnings.push(args.join(' '));
  try {
    return { module: await import(`${POLYFILL_URL}?bust=${bust++}`), warnings };
  } finally {
    console.warn = realWarn;
  }
}

/**
 * Collects events dispatched on the model context during `fn`.
 *
 * The spec puts `toolchange` on the ModelContext, which is an EventTarget —
 * the old window-level event was ours and no native implementation ever fired it.
 */
export async function captureChanges(eventName, fn, context = document.modelContext) {
  const seen = [];
  const listener = (e) => seen.push(e);
  context?.addEventListener(eventName, listener);
  try {
    await fn();
  } finally {
    context?.removeEventListener(eventName, listener);
  }
  return seen;
}

/** `executeTool` resolves with a JSON string; most assertions want the value. */
export async function runTool(name, input = {}, context = document.modelContext) {
  const raw = await context.executeTool(name, input);
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

/**
 * A scratch registration scope for tests.
 *
 * The spec removed `unregisterTool` and `provideContext`, so a tool registered
 * without a signal lasts as long as the document — which in a test file means it
 * leaks into every later test. An `AbortSignal` is the only withdrawal
 * mechanism left, so teardown has to own one. `reset()` is what
 * `provideContext({tools: []})` used to be, expressed the way real code now has
 * to express it.
 *
 * It deliberately keeps the same ModelContext instance rather than installing a
 * fresh one: analytics patches `registerTool` on the instance, and swapping it
 * out would silently uninstall the thing under test.
 */
export function toolBench(context = document.modelContext) {
  let controller = new AbortController();
  return {
    get signal() { return controller.signal; },
    register(tool, options = {}) {
      return context.registerTool(tool, { signal: controller.signal, ...options });
    },
    reset() {
      controller.abort();
      controller = new AbortController();
    }
  };
}
