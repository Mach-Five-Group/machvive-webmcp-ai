const POLYFILL_URL = new URL('../src/wc/machvive-webmcp-polyfill/machvive-webmcp-polyfill.js', import.meta.url).href;

let bust = 0;

/**
 * Imports a fresh copy of the polyfill module under chosen conditions. The module
 * installs itself on import, so install-guard behavior can only be exercised by
 * defeating the ESM cache.
 */
export async function loadPolyfill({ secureContext = true, nativeImpl = null } = {}) {
  delete navigator.modelContext;
  if (nativeImpl) {
    Object.defineProperty(navigator, 'modelContext', { value: nativeImpl, configurable: true });
  }
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

/** Collects `machvive-webmcp-change` events dispatched during `fn`. */
export async function captureChanges(eventName, fn) {
  const seen = [];
  const listener = (e) => seen.push(e.detail);
  window.addEventListener(eventName, listener);
  try {
    await fn();
  } finally {
    window.removeEventListener(eventName, listener);
  }
  return seen;
}
