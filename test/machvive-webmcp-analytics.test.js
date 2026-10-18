import { test, describe, beforeEach, before } from 'node:test';
import assert from 'node:assert/strict';

import { toolBench } from './helpers.js';

let mod, mc, bench;

const settle = () => new Promise((r) => setTimeout(r, 30));

before(async () => {
  // Deliberately NOT importing the polyfill first: analytics must stand alone,
  // since capturing every call means loading it before anything else.
  mod = await import('../src/wc/machvive-webmcp-analytics/machvive-webmcp-analytics.js');
  mc = document.modelContext;
  bench = toolBench(mc);
});

describe('standalone import', () => {
  test('installs the polyfill itself rather than finding no registry', () => {
    assert.ok(mc, 'importing analytics alone must yield a modelContext');
    assert.equal(typeof mc.registerTool, 'function');
  });

  test('captures a call when analytics is the only module imported', async () => {
    mod.callLog.clear();
    bench.register({ name: 'standalone', description: 'Prove capture works with analytics alone', execute: () => 'ok' });
    await mc.executeTool('standalone', {});
    assert.equal(mod.callLog.entries.at(-1)?.tool, 'standalone');
  });
});

beforeEach(async () => {
  mod.callLog.clear();
  // provideContext is gone, so teardown goes through the registrations' signal.
  bench.reset();
  await settle();
});

describe('capture', () => {
  test('records a successful call with params, result, and timing', async () => {
    bench.register({ name: 'add', description: 'Add two numbers', execute: ({ a, b }) => String(a + b) });
    await mc.executeTool('add', { a: 2, b: 3 });

    const [entry] = mod.callLog.entries;
    assert.equal(entry.tool, 'add');
    assert.equal(entry.status, 'ok');
    assert.deepEqual(entry.params, { a: 2, b: 3 });
    // Instrumentation wraps execute(), so result is the handler's raw return —
    // not the {content:[...]} shape callTool normalizes it into afterwards.
    assert.equal(entry.result, '5');
    assert.equal(typeof entry.durationMs, 'number');
    assert.match(entry.startedAt, /^\d{4}-\d{2}-\d{2}T/);
  });

  test('records a throwing handler as one error entry, not two', async () => {
    bench.register({ name: 'boom', description: 'Always throws', execute: () => { throw new Error('nope'); } });
    // 7.0 surfaces a handler failure as a rejection, so the call itself throws
    // — and the log must still hold exactly one entry describing it.
    await assert.rejects(() => mc.executeTool('boom', {}), /nope/);

    assert.equal(mod.callLog.size, 1, 'instrumentation must not add a phantom entry');
    assert.equal(mod.callLog.entries[0].status, 'error');
    assert.equal(mod.callLog.entries[0].error, 'nope');
  });

  test('captures the raw handler return, not the JSON string executeTool resolves with', async () => {
    bench.register({ name: 'shaped', description: 'Return an MCP-shaped result', execute: () => ({ content: [{ type: 'text', text: 'hi' }] }) });
    await mc.executeTool('shaped', {});
    const entry = mod.callLog.entries.at(-1);
    // executeTool hands the agent a JSON string; the log keeps the object the
    // handler actually returned, which is what a replay needs.
    assert.deepEqual(entry.result, { content: [{ type: 'text', text: 'hi' }] });
  });

  test('captures a tool registered with an AbortSignal', async () => {
    // The signal form is now the only way to register something withdrawable,
    // so it is the shape most real code will use.
    bench.register({ name: 'ping', description: 'Replies pong', execute: () => 'pong' });
    await mc.executeTool('ping');
    assert.equal(mod.callLog.entries.at(-1).tool, 'ping');
  });

  test('snapshots params so later caller mutation cannot rewrite history', async () => {
    bench.register({ name: 'echo', description: 'Echo the call back', execute: () => 'ok' });
    const params = { items: ['a'] };
    await mc.executeTool('echo', params);
    params.items.push('b');
    assert.deepEqual(mod.callLog.entries.at(-1).params, { items: ['a'] });
  });

  test('a throwing listener cannot break the tool call', async () => {
    const bad = () => { throw new Error('listener exploded'); };
    mod.callLog.addEventListener('change', bad);
    bench.register({ name: 'safe', description: 'Return a fixed value', execute: () => 'fine' });
    const res = await mc.executeTool('safe', {});
    mod.callLog.removeEventListener('change', bad);

    assert.equal(res, 'fine', 'a broken subscriber must not change the result');
  });

  test('a failure inside the log itself cannot reach the tool call', async () => {
    // Broader than the listener case: if recording throws for any reason, the
    // tool's own result must still come back untouched.
    bench.register({ name: 'resilient', description: 'Return a fixed value even if logging fails', execute: () => 'fine' });
    const realAdd = mod.callLog.add;
    mod.callLog.add = () => { throw new Error('log exploded'); };
    try {
      const res = await mc.executeTool('resilient', {});
      assert.equal(res, 'fine');
    } finally {
      mod.callLog.add = realAdd;
    }
  });

  test('one throwing listener does not starve the others', () => {
    // Isolates the per-listener catch: without it the first throw aborts the loop
    // and later subscribers never run.
    const seen = [];
    const bad = () => { throw new Error('first exploded'); };
    const good = () => seen.push('ran');
    mod.callLog.addEventListener('change', bad);
    mod.callLog.addEventListener('change', good);
    mod.callLog.add({ tool: 'x', status: 'ok', durationMs: 0 });
    mod.callLog.removeEventListener('change', bad);
    mod.callLog.removeEventListener('change', good);

    assert.deepEqual(seen, ['ran'], 'a later subscriber must still be notified');
  });

  test('a refused duplicate leaves one working registration, not a double wrap', async () => {
    // 7.0 rejects a duplicate name instead of replacing it. The risk is that
    // analytics wrapped the descriptor twice on the way in, which would record
    // the same call twice; __machviveWrapped is what prevents that.
    const tool = { name: 'once', description: 'Records exactly once', execute: () => 'x' };
    await bench.register(tool);
    await assert.rejects(() => bench.register(tool), { name: 'InvalidStateError' });
    await mc.executeTool('once');
    assert.equal(mod.callLog.size, 1);
  });

  test('leaves an invalid descriptor for the polyfill to reject', async () => {
    // Analytics must pass a broken descriptor through untouched, so the
    // registry's own validation is what answers — and it rejects, not throws.
    await assert.rejects(() => document.modelContext.registerTool({ name: 'bad' }), TypeError);
  });
});

describe('log operations', () => {
  beforeEach(async () => {
    bench.register({ name: 'add', description: 'Add two numbers', execute: ({ a, b }) => String(a + b) });
    await mc.executeTool('add', { a: 1, b: 1 });
  });

  test('update edits an entry', () => {
    const { id } = mod.callLog.entries[0];
    mod.callLog.update(id, { params: { a: 9, b: 9 } });
    assert.deepEqual(mod.callLog.entries[0].params, { a: 9, b: 9 });
  });

  test('remove deletes one entry and reports whether it existed', () => {
    const { id } = mod.callLog.entries[0];
    assert.equal(mod.callLog.remove(id), true);
    assert.equal(mod.callLog.remove(id), false);
    assert.equal(mod.callLog.size, 0);
  });

  test('export round-trips through import', () => {
    const json = mod.callLog.toJSON();
    mod.callLog.clear();
    assert.equal(mod.callLog.import(json), 1);
    assert.equal(mod.callLog.entries[0].tool, 'add');
  });

  test('import rejects a payload without entries', () => {
    assert.throws(() => mod.callLog.import('{"nope":1}'), TypeError);
  });

  test('replay re-invokes with the captured params', async () => {
    const { id } = mod.callLog.entries[0];
    const res = await mod.callLog.replay(id);
    assert.equal(res, '2');
  });

  test('replay accepts edited params', async () => {
    const { id } = mod.callLog.entries[0];
    const res = await mod.callLog.replay(id, { a: 10, b: 5 });
    assert.equal(res, '15');
  });

  test('replay of an unknown id rejects', async () => {
    await assert.rejects(() => mod.callLog.replay('missing'), /no captured call/);
  });

  test('evicts oldest entries past the limit', async () => {
    const log = new mod.CallLog({ limit: 3, persist: false });
    for (let i = 0; i < 5; i++) log.add({ tool: `t${i}`, status: 'ok', durationMs: 0 });
    assert.deepEqual(log.entries.map((e) => e.tool), ['t2', 't3', 't4']);
  });
});

describe('dataLayer', () => {
  beforeEach(() => { window.dataLayer = []; });

  test('push emits a flat GTM-shaped event', async () => {
    bench.register({ name: 'add', description: 'Add two numbers', execute: () => 'ok' });
    await mc.executeTool('add', { a: 1 });
    const { id } = mod.callLog.entries[0];

    assert.equal(mod.callLog.pushToDataLayer(id), true);
    assert.deepEqual(window.dataLayer[0].event, 'webmcp_tool_call');
    assert.equal(window.dataLayer[0].webmcp_tool, 'add');
    assert.equal(window.dataLayer[0].webmcp_status, 'ok');
    assert.equal(mod.callLog.entries[0].pushedToDataLayer, true);
  });

  test('capture alone never pushes without opt-in', async () => {
    bench.register({ name: 'quiet', description: 'Stay out of the dataLayer', execute: () => 'ok' });
    await mc.executeTool('quiet', {});
    assert.equal(window.dataLayer.length, 0, 'importing analytics must not emit GTM traffic');
  });
});

describe('IndexedDB persistence', () => {
  test('entries survive into a fresh CallLog instance', async () => {
    bench.register({ name: 'persisted', description: 'Survive a reload', execute: () => 'ok' });
    await mc.executeTool('persisted', { keep: true });
    await settle();

    const fresh = new mod.CallLog();
    await fresh.ready;
    assert.ok(fresh.entries.some((e) => e.tool === 'persisted'), 'entry should restore from IndexedDB');
  });

  test('reports itself persistent when IndexedDB is present', () => {
    assert.equal(mod.callLog.persistent, true);
  });

  test('a memory-only log neither persists nor claims to', async () => {
    const log = new mod.CallLog({ persist: false });
    await log.ready;
    assert.equal(log.persistent, false);
    log.add({ tool: 'ephemeral', status: 'ok', durationMs: 0 });
    const other = new mod.CallLog({ persist: false });
    await other.ready;
    assert.equal(other.size, 0);
  });
});

describe('<machvive-webmcp-analytics> element', () => {
  test('renders captured calls and exposes the shared log', async () => {
    bench.register({ name: 'rendered', description: 'Appear in the rendered table', execute: () => 'ok' });
    await mc.executeTool('rendered', {});

    const el = document.createElement('machvive-webmcp-analytics');
    document.body.append(el);
    assert.equal(el.log, mod.callLog);
    assert.match(el.shadowRoot.textContent, /rendered/);
    assert.match(el.shadowRoot.textContent, /1 call\b/);
    el.remove();
  });

  test('shows an empty state with no calls', () => {
    const el = document.createElement('machvive-webmcp-analytics');
    document.body.append(el);
    assert.match(el.shadowRoot.textContent, /No WebMCP calls captured/);
    el.remove();
  });

  test('auto-pushes to dataLayer only with the datalayer attribute', async () => {
    window.dataLayer = [];
    const plain = document.createElement('machvive-webmcp-analytics');
    document.body.append(plain);
    bench.register({ name: 'auto', description: 'Push to the dataLayer', execute: () => 'ok' });
    await mc.executeTool('auto', {});
    assert.equal(window.dataLayer.length, 0);
    plain.remove();

    const opted = document.createElement('machvive-webmcp-analytics');
    opted.setAttribute('datalayer', '');
    document.body.append(opted);
    await mc.executeTool('auto', {});
    assert.equal(window.dataLayer.length, 1, 'datalayer attribute should opt in');
    opted.remove();
  });
});
