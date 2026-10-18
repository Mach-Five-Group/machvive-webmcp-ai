import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { loadPolyfill, captureChanges } from './helpers.js';

const tool = (extra = {}) => ({
  name: 'demo',
  description: 'A demo tool',
  execute: async () => 'ok',
  ...extra
});

describe('installWebmcpPolyfill', () => {
  test('installs at document.modelContext on a secure context', async () => {
    const { module } = await loadPolyfill();
    assert.ok(document.modelContext, 'the spec puts it on Document, not Navigator');
    assert.equal(typeof document.modelContext.registerTool, 'function');
    assert.equal(typeof document.modelContext.getTools, 'function');
    assert.equal(typeof document.modelContext.executeTool, 'function');
    assert.equal(module.installWebmcpPolyfill(), false, 'a second call is a no-op');
  });

  test('never clobbers a native implementation', async () => {
    const native = { registerTool() {}, getTools: async () => [], executeTool: async () => '' };
    await loadPolyfill({ nativeImpl: native });
    assert.equal(document.modelContext, native);
  });

  test('a navigator property does not count as native', async () => {
    // It may be an older copy of this very polyfill. Deferring to it would
    // leave the page talking to a registry no agent can see — the exact bug
    // that shipped when the spec moved from Navigator to Document.
    Object.defineProperty(navigator, 'modelContext', {
      value: { registerTool() { throw new Error('the stale one was used'); } },
      configurable: true
    });
    try {
      await loadPolyfill();
      assert.ok(document.modelContext, 'installs regardless of what navigator holds');
      await document.modelContext.registerTool(tool());
      assert.equal((await document.modelContext.getTools()).length, 1);
    } finally {
      delete navigator.modelContext;
    }
  });

  test('refuses to install off a secure context, and the refusal names the way out', async () => {
    const { warnings } = await loadPolyfill({ secureContext: false });
    assert.equal(document.modelContext, undefined);
    const warning = warnings.join(' ');
    assert.match(warning, /not a secure context/);
    assert.match(warning, /allow-insecure|allowInsecureContext/);
    assert.match(warning, /document\.modelContext/);
  });

  test('installs off a secure context when explicitly allowed', async () => {
    const { module } = await loadPolyfill({ secureContext: false });
    assert.equal(module.installWebmcpPolyfill({ allowInsecureContext: true }), true);
    assert.ok(document.modelContext);
  });

  test('installs at import time, before the element upgrades', async () => {
    await loadPolyfill();
    assert.ok(document.modelContext, 'a page can register before the tag is parsed');
  });
});

describe('registerTool', () => {
  test('validates the descriptor', async () => {
    await loadPolyfill();
    const mc = document.modelContext;
    await assert.rejects(() => mc.registerTool(null), TypeError);
    await assert.rejects(() => mc.registerTool({ description: 'd', execute() {} }), TypeError);
    await assert.rejects(() => mc.registerTool({ name: 'n', execute() {} }), /must supply a description/);
    await assert.rejects(() => mc.registerTool({ name: 'n', description: 'd' }), /execute/);
  });

  test('description is required, because it is all an agent has to choose by', async () => {
    await loadPolyfill();
    await assert.rejects(
      () => document.modelContext.registerTool({ name: 'x', description: '', execute: async () => '' }),
      /must supply a description/
    );
  });

  test('rejects a duplicate name rather than silently replacing', async () => {
    // The old polyfill replaced. The spec rejects, and replacement hid the
    // case where two components fight over one name.
    await loadPolyfill();
    const mc = document.modelContext;
    await mc.registerTool(tool());
    await assert.rejects(() => mc.registerTool(tool()), (e) => e.name === 'InvalidStateError');
    assert.equal((await mc.getTools()).length, 1);
  });

  test('aborting the signal unregisters', async () => {
    await loadPolyfill();
    const mc = document.modelContext;
    const controller = new AbortController();
    await mc.registerTool(tool(), { signal: controller.signal });
    assert.equal((await mc.getTools()).length, 1);
    controller.abort();
    assert.equal((await mc.getTools()).length, 0);
  });

  test('an already-aborted signal registers nothing', async () => {
    // Registering then immediately removing would fire two change events for
    // a tool that was never available.
    await loadPolyfill();
    const mc = document.modelContext;
    const controller = new AbortController();
    controller.abort();
    const changes = await captureChanges('toolchange', async () => {
      await mc.registerTool(tool(), { signal: controller.signal });
    });
    assert.equal((await mc.getTools()).length, 0);
    assert.equal(changes.length, 0);
  });

  test('aborting one registration leaves the others alone', async () => {
    await loadPolyfill();
    const mc = document.modelContext;
    const mine = new AbortController();
    await mc.registerTool(tool({ name: 'host' }));
    await mc.registerTool(tool({ name: 'mine' }), { signal: mine.signal });
    mine.abort();
    assert.deepEqual((await mc.getTools()).map((t) => t.name), ['host']);
  });
});

describe('getTools', () => {
  test('exposes the descriptor but never the handler', async () => {
    await loadPolyfill();
    await document.modelContext.registerTool(tool({ inputSchema: { type: 'object' } }));
    const [registered] = await document.modelContext.getTools();
    assert.equal(registered.name, 'demo');
    assert.equal(registered.description, 'A demo tool');
    assert.deepEqual(registered.inputSchema, { type: 'object' });
    assert.equal(registered.execute, undefined, 'a handler must never cross the boundary');
  });

  test('carries the window and origin the spec requires', async () => {
    await loadPolyfill();
    await document.modelContext.registerTool(tool());
    const [registered] = await document.modelContext.getTools();
    assert.ok('window' in registered);
    assert.equal(typeof registered.origin, 'string');
  });

  test('carries annotations through, so readOnlyHint survives', async () => {
    await loadPolyfill();
    await document.modelContext.registerTool(tool({ annotations: { readOnlyHint: true } }));
    const [registered] = await document.modelContext.getTools();
    assert.deepEqual(registered.annotations, { readOnlyHint: true });
  });
});

describe('executeTool', () => {
  test('resolves with a string result verbatim', async () => {
    await loadPolyfill();
    await document.modelContext.registerTool(tool({ execute: async () => 'plain text' }));
    assert.equal(await document.modelContext.executeTool('demo'), 'plain text');
  });

  test('serializes a non-string result, as the platform does', async () => {
    await loadPolyfill();
    await document.modelContext.registerTool(tool({ execute: async () => ({ a: 1 }) }));
    assert.equal(await document.modelContext.executeTool('demo'), '{"a":1}');
  });

  test('accepts a RegisteredTool as well as a bare name', async () => {
    await loadPolyfill();
    await document.modelContext.registerTool(tool());
    const [registered] = await document.modelContext.getTools();
    assert.equal(await document.modelContext.executeTool(registered), 'ok');
  });

  test('forwards the input and hands the handler an AbortSignal', async () => {
    await loadPolyfill();
    let seen;
    await document.modelContext.registerTool(tool({
      execute: async (input, options) => { seen = { input, signal: options?.signal }; return 'done'; }
    }));
    await document.modelContext.executeTool('demo', { x: 7 });
    assert.deepEqual(seen.input, { x: 7 });
    assert.ok(seen.signal instanceof AbortSignal, 'the spec requires a signal on the callback options');
  });

  test('rejects for an unknown tool', async () => {
    await loadPolyfill();
    await assert.rejects(() => document.modelContext.executeTool('nope'), (e) => e.name === 'NotFoundError');
  });

  test('a throwing handler rejects rather than returning an error flag', async () => {
    // There is no isError in the spec; a failed execution is a rejection.
    await loadPolyfill();
    await document.modelContext.registerTool(tool({ execute: async () => { throw new Error('boom'); } }));
    await assert.rejects(() => document.modelContext.executeTool('demo'), /boom/);
  });

  test('withdrawing a registration does not cancel an execution already running', async () => {
    // The spec treats these as separate concerns, and a handler mid-flight
    // holds its own signal.
    await loadPolyfill();
    const mc = document.modelContext;
    const controller = new AbortController();
    let release;
    const started = new Promise((r) => { release = r; });
    await mc.registerTool(tool({ execute: () => started.then(() => 'finished') }), { signal: controller.signal });

    const running = mc.executeTool('demo');
    controller.abort();
    assert.equal((await mc.getTools()).length, 0, 'withdrawn from discovery');
    release();
    assert.equal(await running, 'finished', 'but the in-flight call still completes');
  });
});

describe('toolchange', () => {
  test('registering and withdrawing each dispatch on the context', async () => {
    await loadPolyfill();
    const mc = document.modelContext;
    const controller = new AbortController();
    const changes = await captureChanges('toolchange', async () => {
      await mc.registerTool(tool(), { signal: controller.signal });
      controller.abort();
    });
    assert.equal(changes.length, 2);
  });

  test('ontoolchange works as a handler property', async () => {
    await loadPolyfill();
    const mc = document.modelContext;
    let fired = 0;
    mc.ontoolchange = () => fired++;
    await mc.registerTool(tool());
    assert.equal(fired, 1);
    assert.equal(typeof mc.ontoolchange, 'function');
    mc.ontoolchange = null;
    await mc.registerTool(tool({ name: 'other' }));
    assert.equal(fired, 1, 'clearing the handler detaches it');
  });
});

describe('<machvive-webmcp-polyfill> element', () => {
  test('registers its tag and stays invisible', async () => {
    await loadPolyfill();
    const el = document.createElement('machvive-webmcp-polyfill');
    document.body.append(el);
    assert.ok(customElements.get('machvive-webmcp-polyfill'));
    assert.match(el.shadowRoot.innerHTML, /display:\s*none/);
    el.remove();
  });

  test('the element can opt in to an insecure context on behalf of the page', async () => {
    await loadPolyfill({ secureContext: false });
    assert.equal(document.modelContext, undefined);
    const el = document.createElement('machvive-webmcp-polyfill');
    el.setAttribute('allow-insecure', '');
    document.body.append(el);
    assert.ok(document.modelContext, 'the element is where the page says it means it');
    el.remove();
  });

  test('without the attribute the element leaves it uninstalled', async () => {
    await loadPolyfill({ secureContext: false });
    const el = document.createElement('machvive-webmcp-polyfill');
    document.body.append(el);
    assert.equal(document.modelContext, undefined);
    el.remove();
  });

  test('passes registration through to document.modelContext', async () => {
    await loadPolyfill();
    const el = document.createElement('machvive-webmcp-polyfill');
    document.body.append(el);
    await el.registerTool(tool({ name: 'via_element' }));
    assert.deepEqual((await el.getTools()).map((t) => t.name), ['via_element']);
    el.remove();
  });
});
