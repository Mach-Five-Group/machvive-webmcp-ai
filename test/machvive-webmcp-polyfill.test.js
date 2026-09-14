import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { loadPolyfill, captureChanges } from './helpers.js';

describe('installWebmcpPolyfill', () => {
  test('installs navigator.modelContext on a secure context', async () => {
    const { module } = await loadPolyfill();
    assert.ok('modelContext' in navigator);
    assert.equal(typeof navigator.modelContext.registerTool, 'function');
    assert.equal(module.installWebmcpPolyfill(), false, 'second call is a no-op');
  });

  test('never clobbers a native implementation', async () => {
    const native = { registerTool() {}, marker: 'native' };
    await loadPolyfill({ nativeImpl: native });
    assert.equal(navigator.modelContext, native, 'native impl must survive import');
    assert.equal(navigator.modelContext.marker, 'native');
  });

  test('refuses to install off a secure context and warns', async () => {
    const { warnings } = await loadPolyfill({ secureContext: false });
    assert.equal('modelContext' in navigator, false);
    assert.match(warnings.join(' '), /secure-context/);
  });

  test('installs at import time, before the element upgrades', async () => {
    await loadPolyfill();
    // No element has been created yet.
    assert.equal(document.querySelector('machvive-webmcp-polyfill'), null);
    assert.ok(navigator.modelContext, 'tools must be registerable before parse');
  });
});

describe('tool registration', () => {
  let mc;
  const echo = {
    name: 'echo',
    description: 'Echoes input',
    inputSchema: { type: 'object', properties: { msg: { type: 'string' } }, required: ['msg'] },
    execute: ({ msg }) => `you said ${msg}`
  };

  beforeEach(async () => {
    await loadPolyfill();
    mc = navigator.modelContext;
  });

  test('registerTool adds without disturbing existing tools', () => {
    mc.registerTool(echo);
    mc.registerTool({ name: 'sum', execute: ({ a, b }) => String(a + b) });
    assert.deepEqual(mc.tools.map((t) => t.name), ['echo', 'sum']);
  });

  test('re-registering the same name replaces it rather than duplicating', () => {
    mc.registerTool(echo);
    mc.registerTool({ ...echo, description: 'Updated' });
    assert.equal(mc.tools.length, 1);
    assert.equal(mc.tools[0].description, 'Updated');
  });

  test('discovery exposes the descriptor but never the handler', () => {
    mc.registerTool(echo);
    const [tool] = mc.tools;
    assert.deepEqual(Object.keys(tool), ['name', 'description', 'inputSchema']);
    assert.equal(tool.execute, undefined, 'handlers must not leak to an agent');
    assert.deepEqual(tool.inputSchema.required, ['msg']);
  });

  test('unregisterTool reports whether the tool was present', () => {
    mc.registerTool(echo);
    assert.equal(mc.unregisterTool('echo'), true);
    assert.equal(mc.unregisterTool('echo'), false);
    assert.deepEqual(mc.tools, []);
  });

  test('provideContext replaces the whole toolset', () => {
    mc.registerTool(echo);
    mc.provideContext({ tools: [{ name: 'only', execute: () => 'x' }] });
    assert.deepEqual(mc.tools.map((t) => t.name), ['only']);
  });

  test('provideContext with no argument clears the registry', () => {
    mc.registerTool(echo);
    mc.provideContext();
    assert.deepEqual(mc.tools, []);
  });

  test('provideContext validates every descriptor before mutating', () => {
    mc.registerTool(echo);
    assert.throws(
      () => mc.provideContext({ tools: [{ name: 'ok', execute() {} }, { name: 'bad' }] }),
      TypeError
    );
    assert.deepEqual(mc.tools.map((t) => t.name), ['echo'], 'registry must be untouched');
  });

  for (const [label, bad] of [
    ['a non-object', 'nope'],
    ['a missing name', { execute() {} }],
    ['an empty name', { name: '', execute() {} }],
    ['a missing execute', { name: 'x' }],
    ['a non-function execute', { name: 'x', execute: 'nope' }]
  ]) {
    test(`registerTool rejects ${label}`, () => {
      assert.throws(() => mc.registerTool(bad), TypeError);
    });
  }
});

describe('callTool', () => {
  let mc;
  beforeEach(async () => {
    await loadPolyfill();
    mc = navigator.modelContext;
  });

  test('normalizes a bare string into MCP content', async () => {
    mc.registerTool({ name: 't', execute: () => 'hello' });
    assert.deepEqual(await mc.callTool('t'), { content: [{ type: 'text', text: 'hello' }] });
  });

  test('passes through a result that is already MCP-shaped', async () => {
    const shaped = { content: [{ type: 'text', text: 'done' }], isError: false };
    mc.registerTool({ name: 't', execute: () => shaped });
    assert.deepEqual(await mc.callTool('t'), shaped);
  });

  test('serializes a plain object result', async () => {
    mc.registerTool({ name: 't', execute: () => ({ ok: true }) });
    assert.deepEqual(await mc.callTool('t'), {
      content: [{ type: 'text', text: '{"ok":true}' }]
    });
  });

  test('treats a void handler as empty content', async () => {
    mc.registerTool({ name: 't', execute: () => {} });
    assert.deepEqual(await mc.callTool('t'), { content: [] });
  });

  test('awaits async handlers and forwards params', async () => {
    mc.registerTool({ name: 'add', execute: async ({ a, b }) => String(a + b) });
    const res = await mc.callTool('add', { a: 2, b: 3 });
    assert.equal(res.content[0].text, '5');
  });

  test('reports an unknown tool as an error result, not a throw', async () => {
    const res = await mc.callTool('missing');
    assert.equal(res.isError, true);
    assert.match(res.content[0].text, /Unknown tool: missing/);
  });

  test('converts a throwing handler into an error result', async () => {
    mc.registerTool({ name: 'boom', execute: () => { throw new Error('kaboom'); } });
    const res = await mc.callTool('boom');
    assert.equal(res.isError, true);
    assert.equal(res.content[0].text, 'kaboom');
  });

  test('converts a rejecting async handler into an error result', async () => {
    mc.registerTool({ name: 'boom', execute: async () => { throw new Error('async kaboom'); } });
    const res = await mc.callTool('boom');
    assert.equal(res.isError, true);
    assert.equal(res.content[0].text, 'async kaboom');
  });

  test('hands the handler an agent with requestUserInteraction', async () => {
    let agent;
    mc.registerTool({ name: 't', execute: (_params, a) => { agent = a; return 'ok'; } });
    await mc.callTool('t');
    assert.equal(typeof agent.requestUserInteraction, 'function');
    assert.equal(await agent.requestUserInteraction(() => 'confirmed'), 'confirmed');
  });
});

describe('change notifications', () => {
  test('every mutation dispatches the change event with current tools', async () => {
    const { module } = await loadPolyfill();
    const mc = navigator.modelContext;
    const seen = await captureChanges(module.TOOLS_CHANGED_EVENT, async () => {
      mc.registerTool({ name: 'a', execute: () => 'a' });
      mc.registerTool({ name: 'b', execute: () => 'b' });
      mc.unregisterTool('a');
      mc.provideContext({ tools: [] });
    });
    assert.deepEqual(seen.map((d) => d.tools.map((t) => t.name)), [['a'], ['a', 'b'], ['b'], []]);
  });

  test('a no-op unregister does not dispatch', async () => {
    const { module } = await loadPolyfill();
    const seen = await captureChanges(module.TOOLS_CHANGED_EVENT, () => {
      navigator.modelContext.unregisterTool('never-registered');
    });
    assert.deepEqual(seen, []);
  });
});

describe('<machvive-webmcp-polyfill> element', () => {
  test('registers its tag and stays invisible', async () => {
    await loadPolyfill();
    assert.ok(customElements.get('machvive-webmcp-polyfill'));

    const el = document.createElement('machvive-webmcp-polyfill');
    document.body.append(el);
    assert.ok(el.shadowRoot, 'element attaches a shadow root');
    assert.match(el.shadowRoot.innerHTML, /display:\s*none/);
    el.remove();
  });

  test('passes registration through to navigator.modelContext', async () => {
    await loadPolyfill();
    const el = document.createElement('machvive-webmcp-polyfill');
    document.body.append(el);

    el.registerTool({ name: 'via-element', execute: () => 'ok' });
    assert.deepEqual(navigator.modelContext.tools.map((t) => t.name), ['via-element']);
    assert.equal(el.unregisterTool('via-element'), true);
    el.remove();
  });
});
