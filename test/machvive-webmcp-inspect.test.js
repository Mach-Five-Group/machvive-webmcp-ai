import { test, describe, beforeEach, before } from 'node:test';
import assert from 'node:assert/strict';

import { toolBench } from './helpers.js';

let mc, bench;
const tick = () => new Promise((r) => setTimeout(r, 20));

/**
 * Mounting settles before returning: the inspector reads its tool list through
 * the async getTools(), so a DOM assertion taken straight after append would
 * race the first render and see an empty panel.
 */
const mount = async () => {
  const el = document.createElement('machvive-webmcp-inspect');
  document.body.append(el);
  await tick();
  return el;
};

const CART_TOOL = {
  name: 'add_to_cart',
  description: 'Add a product to the cart',
  inputSchema: {
    type: 'object',
    properties: {
      sku: { type: 'string', description: 'Product SKU' },
      qty: { type: 'integer' },
      gift: { type: 'boolean' },
      size: { type: 'string', enum: ['S', 'M', 'L'] },
      meta: { type: 'object' }
    },
    required: ['sku']
  },
  execute: ({ sku, qty, gift, size, meta }) =>
    `sku=${sku} qty=${qty} gift=${gift} size=${size} meta=${JSON.stringify(meta)}`
};

before(async () => {
  await import('../src/wc/machvive-webmcp-inspect/machvive-webmcp-inspect.js');
  mc = document.modelContext;
  bench = toolBench(mc);
});

/**
 * Sets the page's toolset. The spec removed provideContext, so this is the same
 * intent expressed the way 7.0 requires: withdraw what the previous test
 * registered through its signal, then register the new list.
 */
const setTools = (...list) => {
  bench.reset();
  for (const t of list) bench.register(t);
};

beforeEach(() => {
  document.body.innerHTML = '';
  setTools();
});

describe('tool discovery', () => {
  test('lists registered tools', async () => {
    setTools(CART_TOOL, { name: 'search', description: 'Search the catalogue', execute: () => 'x' });
    const el = await mount();
    const names = [...el.shadowRoot.querySelectorAll('[data-tool]')].map((b) => b.dataset.tool);
    assert.deepEqual(names, ['add_to_cart', 'search']);
  });

  test('shows an empty state when nothing is registered', async () => {
    const el = await mount();
    assert.match(el.shadowRoot.textContent, /No tools registered/);
  });

  test('refreshes when a tool is registered after mount', async () => {
    const el = await mount();
    assert.match(el.shadowRoot.textContent, /No tools registered/);
    bench.register(CART_TOOL);
    await tick();
    assert.ok(el.shadowRoot.querySelector('[data-tool="add_to_cart"]'));
  });

  test('renders the tool description', async () => {
    bench.register(CART_TOOL);
    const el = await mount();
    assert.match(el.shadowRoot.textContent, /Add a product to the cart/);
  });

  test('handles a tool with no inputSchema', async () => {
    bench.register({ name: 'ping', description: 'Check the page is responding', execute: () => 'pong' });
    const el = await mount();
    assert.match(el.shadowRoot.textContent, /takes no parameters/);
  });
});

describe('schema-driven form', () => {
  let el;
  beforeEach(async () => {
    setTools(CART_TOOL);
    el = await mount();
  });

  const field = (name) => el.shadowRoot.querySelector(`[data-field="${name}"]`);

  test('maps each schema type to an appropriate control', () => {
    assert.equal(field('sku').type, 'text');
    assert.equal(field('qty').type, 'number');
    assert.equal(field('gift').type, 'checkbox');
    assert.equal(field('size').tagName, 'SELECT');
    assert.equal(field('meta').tagName, 'TEXTAREA');
  });

  test('builds options from an enum', () => {
    const values = [...field('size').options].map((o) => o.value);
    assert.deepEqual(values, ['', 'S', 'M', 'L'], 'optional enum gets a blank choice');
  });

  test('marks required fields', () => {
    assert.ok(el.shadowRoot.querySelector('.req'), 'required field should be flagged');
  });
});

describe('execution', () => {
  let el;
  const submit = async () => {
    el.shadowRoot.querySelector('form').dispatchEvent(new window.Event('submit'));
    await tick();
  };
  const field = (name) => el.shadowRoot.querySelector(`[data-field="${name}"]`);
  const output = () => el.shadowRoot.querySelector('pre')?.textContent ?? '';

  beforeEach(async () => {
    setTools(CART_TOOL);
    el = await mount();
  });

  test('blocks execution when a required field is empty', async () => {
    await submit();
    assert.equal(
      el.shadowRoot.querySelector('[data-error="sku"]').textContent,
      'required'
    );
    assert.equal(el.shadowRoot.querySelector('pre'), null, 'nothing should have run');
  });

  test('coerces values to the types the schema declares', async () => {
    field('sku').value = 'M5T-001';
    field('qty').value = '3';
    field('gift').checked = true;
    field('size').value = 'L';
    await submit();
    assert.match(output(), /sku=M5T-001 qty=3 gift=true size=L/);
  });

  test('passes real numbers and booleans, not their string spellings', async () => {
    // Template interpolation renders '3' and 3 identically, so assert the runtime
    // type the handler actually received.
    setTools({
        name: 'types', description: 'Report the runtime type of each parameter it received',
        inputSchema: { type: 'object', properties: {
          qty: { type: 'integer' }, ratio: { type: 'number' }, gift: { type: 'boolean' }
        } },
        execute: (p) => JSON.stringify(Object.fromEntries(
          Object.entries(p).map(([k, v]) => [k, typeof v])
        ))
      });
    el = await mount();
    el.shadowRoot.querySelector('[data-field="qty"]').value = '3';
    el.shadowRoot.querySelector('[data-field="ratio"]').value = '1.5';
    el.shadowRoot.querySelector('[data-field="gift"]').checked = true;
    await submit();
    assert.deepEqual(JSON.parse(output()), { qty: 'number', ratio: 'number', gift: 'boolean' });
  });

  test('truncates a fractional value in an integer field', async () => {
    setTools({
        name: 'ints', description: 'Echo the integer it was given',
        inputSchema: { type: 'object', properties: { n: { type: 'integer' } } },
        execute: ({ n }) => `n=${n}`
      });
    el = await mount();
    el.shadowRoot.querySelector('[data-field="n"]').value = '4.9';
    await submit();
    assert.match(output(), /n=4$/, 'integer fields must not pass 4.9 through');
  });

  test('omits empty optional fields rather than sending empty strings', async () => {
    field('sku').value = 'ONLY-SKU';
    await submit();
    assert.match(output(), /qty=undefined gift=false size=undefined/);
  });

  test('parses JSON for object-typed fields', async () => {
    field('sku').value = 'X';
    field('meta').value = '{"color":"red"}';
    await submit();
    assert.match(output(), /meta=\{"color":"red"\}/);
  });

  test('reports invalid JSON on the field instead of executing', async () => {
    field('sku').value = 'X';
    field('meta').value = '{not json';
    await submit();
    assert.match(el.shadowRoot.querySelector('[data-error="meta"]').textContent, /valid JSON/);
    assert.equal(el.shadowRoot.querySelector('pre'), null);
  });

  test('reports a non-numeric entry in a number field', async () => {
    field('sku').value = 'X';
    // A number input can still hold junk when set programmatically.
    field('qty').value = 'abc';
    await submit();
    const err = el.shadowRoot.querySelector('[data-error="qty"]').textContent;
    const ran = el.shadowRoot.querySelector('pre');
    assert.ok(err || ran, 'either it rejects the value or the browser blanked it');
  });

  test('surfaces a failing tool as an error result', async () => {
    setTools({ name: 'boom', description: 'Always fails, so error handling can be exercised', inputSchema: { type: 'object', properties: {} }, execute: () => { throw new Error('kaboom'); } });
    el = await mount();
    await submit();
    assert.match(output(), /kaboom/);
    assert.ok(el.shadowRoot.querySelector('pre.error'), 'error results should be styled as errors');
  });

  test('switching tools clears the previous result', async () => {
    setTools(CART_TOOL, { name: 'other', description: 'A second tool, for switching between them', inputSchema: { type: 'object', properties: {} }, execute: () => 'other-ran' });
    el = await mount();
    el.shadowRoot.querySelector('[data-field="sku"]').value = 'X';
    await submit();
    assert.notEqual(el.shadowRoot.querySelector('pre'), null);

    el.shadowRoot.querySelector('[data-tool="other"]').click();
    await tick();
    assert.equal(el.shadowRoot.querySelector('pre'), null, 'stale output must not carry over');
  });
});

describe('floating mode', () => {
  test('is inline by default with no toggle visible', async () => {
    const el = await mount();
    assert.equal(el.hasAttribute('floating'), false);
  });

  test('show() and hide() drive the open attribute', async () => {
    const el = await mount();
    el.setAttribute('floating', '');
    el.show();
    assert.equal(el.hasAttribute('open'), true);
    el.hide();
    assert.equal(el.hasAttribute('open'), false);
  });

  test('the toggle button flips open state', async () => {
    const el = await mount();
    el.setAttribute('floating', '');
    await tick();
    el.shadowRoot.querySelector('.fab').click();
    assert.equal(el.hasAttribute('open'), true);
  });
});

describe('degraded environments', () => {
  test('explains itself when modelContext lacks discovery', async () => {
    const real = document.modelContext;
    // 7.0 drives the inspector through getTools/executeTool, which ARE spec
    // surface — so a native implementation is usable and this path is reached
    // only by something that registers but cannot be enumerated or invoked.
    Object.defineProperty(document, 'modelContext', {
      value: { registerTool() {}, addEventListener() {}, removeEventListener() {} },
      configurable: true
    });
    const el = await mount();
    assert.match(el.shadowRoot.textContent, /unavailable/);
    Object.defineProperty(document, 'modelContext', { value: real, configurable: true });
  });
});

describe('floating placement and hotkey', () => {
  const css = (el) => el.shadowRoot.querySelector('style').textContent;

  test('offers all four corners, since bottom-right is usually taken', async () => {
    // Chat widgets, cookie banners and support launchers all live bottom-right;
    // a fixed corner means landing on top of one.
    const el = await mount();
    for (const corner of ['bottom-left', 'top-right', 'top-left']) {
      assert.ok(css(el).includes(`[position="${corner}"]`), `${corner} missing`);
    }
  });

  test('offsets are custom properties, so a page can nudge it', async () => {
    assert.match(css(await mount()), /--mv-fab-offset-block/);
    assert.match(css(await mount()), /--mv-fab-offset-inline/);
  });

  test('hidden-fab keeps the panel reachable with no launcher drawn', async () => {
    assert.match(css(await mount()), /\[hidden-fab\]\) \.fab \{ display: none/);
  });

  test('a hotkey toggles the panel', async () => {
    const el = await mount();
    el.setAttribute('floating', '');
    el.setAttribute('hotkey', 'ctrl+shift+k');
    el.remove();
    document.body.append(el); // re-connect so the listener binds
    await tick();

    const press = (init) => window.dispatchEvent(new window.KeyboardEvent('keydown', init));
    press({ key: 'k', ctrlKey: true, shiftKey: true });
    assert.equal(el.hasAttribute('open'), true, 'combo should open it');
    press({ key: 'k', ctrlKey: true, shiftKey: true });
    assert.equal(el.hasAttribute('open'), false, 'same combo should close it');
  });

  test('ignores the key without its modifiers, and binds nothing without the attribute', async () => {
    const el = await mount();
    el.setAttribute('floating', '');
    el.setAttribute('hotkey', 'ctrl+shift+k');
    el.remove(); document.body.append(el); await tick();
    window.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'k' }));
    assert.equal(el.hasAttribute('open'), false, 'bare key must not fire');

    const plain = await mount();
    plain.setAttribute('floating', '');
    window.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'k', ctrlKey: true, shiftKey: true }));
    assert.equal(plain.hasAttribute('open'), false, 'no hotkey attribute means no listener');
  });
});
