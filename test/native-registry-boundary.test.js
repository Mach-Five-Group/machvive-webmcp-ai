import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

/**
 * What happens against a registry that is not ours.
 *
 * 7.0 drops the non-standard `tools`/`callTool` pair precisely so these
 * components work on a native `document.modelContext`. That promise is only
 * worth making if the components survive a registry that behaves differently
 * from the polyfill — a platform object whose methods cannot be reassigned, or
 * one that answers in a shape the spec does not require. Neither case can be
 * reached through the polyfill, so nothing else in the suite covers it.
 *
 * Each test installs its own registry at `document.modelContext`, which is why
 * this is a separate file: the runner gives every file its own process.
 */
describe('a registry that is not the polyfill', () => {
  test('analytics still loads when getTools does not return a promise', async () => {
    // installAnalytics runs at import time, so anything it does to the registry
    // has to be unable to throw. A synchronous throw here would take down the
    // whole module — and with it every component that imports analytics.
    const hostile = {
      registerTool() { return Promise.resolve(); },
      getTools() { return ['not', 'a', 'promise']; }
    };
    Object.defineProperty(document, 'modelContext', { value: hostile, configurable: true });

    const mod = await import('../src/wc/machvive-webmcp-analytics/machvive-webmcp-analytics.js');
    assert.ok(mod.callLog, 'the module must still finish loading');
    // Let the deferred "registered too early" probe settle, so an unhandled
    // rejection inside it would surface here rather than in some later file.
    await new Promise((r) => setTimeout(r, 20));
  });

  test('analytics reports rather than throws when registerTool cannot be wrapped', async () => {
    // Wrapping means putting an own property on a platform object, and the
    // browser is within its rights to refuse. Capture is then unavailable, and
    // saying so is the only honest outcome — appearing to work while recording
    // nothing is how the analytics component shipped broken once before.
    const frozen = {};
    Object.defineProperty(frozen, 'registerTool', {
      value: () => Promise.resolve(), writable: false, configurable: false
    });
    Object.defineProperty(document, 'modelContext', { value: frozen, configurable: true });

    const mod = await import(
      '../src/wc/machvive-webmcp-analytics/machvive-webmcp-analytics.js?unwrappable');
    const warnings = [];
    const realWarn = console.warn;
    console.warn = (...args) => warnings.push(args.join(' '));
    try {
      assert.equal(mod.installAnalytics(), false, 'it must report failure, not claim capture');
    } finally {
      console.warn = realWarn;
    }
    assert.match(warnings.join('\n'), /does not allow wrapping registerTool/);
  });

  test('the polyfill declines to install over it, whatever shape it has', async () => {
    // The guard is `typeof registerTool === 'function'` at `document`, nothing
    // more: a native implementation need not expose anything else for the
    // polyfill to know it should stand aside.
    const minimal = { registerTool() { return Promise.resolve(); } };
    Object.defineProperty(document, 'modelContext', { value: minimal, configurable: true });

    const { installWebmcpPolyfill } = await import(
      '../src/wc/machvive-webmcp-polyfill/machvive-webmcp-polyfill.js?minimal-native');
    assert.equal(installWebmcpPolyfill(), false, 'it must not replace the implementation');
    assert.equal(document.modelContext, minimal, 'and must leave it exactly as found');
  });
});
