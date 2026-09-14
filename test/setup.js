/**
 * Loaded via `node --test --import ./test/setup.js`, so the DOM exists before any
 * component module is imported. The components self-register and the polyfill
 * self-installs at import time, so this must run first.
 *
 * The Node test runner uses one process per test file, so each file gets a clean
 * document, a clean custom element registry, and a clean navigator.
 */
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://localhost/' });
const { window } = dom;

// jsdom does not implement isSecureContext (it reads as undefined, not true), and
// the polyfill gates installation on it. Tests set it per case.
window.isSecureContext = true;

for (const key of ['window', 'document', 'HTMLElement', 'customElements', 'CustomEvent', 'Event']) {
  Object.defineProperty(globalThis, key, { value: window[key] ?? window, configurable: true, writable: true });
}
Object.defineProperty(globalThis, 'navigator', { value: window.navigator, configurable: true, writable: true });
