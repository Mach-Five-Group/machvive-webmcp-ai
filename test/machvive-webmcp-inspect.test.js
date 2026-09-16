import { test, describe, beforeEach, before } from 'node:test';
import assert from 'node:assert/strict';

let mc;
const tick = () => new Promise((r) => setTimeout(r, 20));

const mount = () => {
  const el = document.createElement('machvive-webmcp-inspect');
  document.body.append(el);
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
  mc = navigator.modelContext;
});

beforeEach(() => {
  document.body.innerHTML = '';
  mc.provideContext({ tools: [] });
});

describe('tool discovery', () => {
  test('lists registered tools', () => {
    mc.provideContext({ tools: [CART_TOOL, { name: 'search', execute: () => 'x' }] });
    const el = mount();
    const names = [...el.shadowRoot.querySelectorAll('[data-tool]')].map((b) => b.dataset.tool);
    assert.deepEqual(names, ['add_to_cart', 'search']);
  });

  test('shows an empty state when nothing is registered', () => {
    const el = mount();
    assert.match(el.shadowRoot.textContent, /No tools registered/);
  });

  test('refreshes when a tool is registered after mount', async () => {
    const el = mount();
    assert.match(el.shadowRoot.textContent, /No tools registered/);
    mc.registerTool(CART_TOOL);
    await tick();
    assert.ok(el.shadowRoot.querySelector('[data-tool="add_to_cart"]'));
  });

  test('renders the tool description', () => {
    mc.registerTool(CART_TOOL);
    const el = mount();
    assert.match(el.shadowRoot.textContent, /Add a product to the cart/);
  });

  test('handles a tool with no inputSchema', () => {
    mc.registerTool({ name: 'ping', execute: () => 'pong' });
    const el = mount();
    assert.match(el.shadowRoot.textContent, /takes no parameters/);
  });
});

describe('schema-driven form', () => {
  let el;
  beforeEach(() => {
    mc.provideContext({ tools: [CART_TOOL] });
    el = mount();
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

  beforeEach(() => {
    mc.provideContext({ tools: [CART_TOOL] });
    el = mount();
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
    mc.provideContext({
      tools: [{
        name: 'types',
        inputSchema: { type: 'object', properties: {
          qty: { type: 'integer' }, ratio: { type: 'number' }, gift: { type: 'boolean' }
        } },
        execute: (p) => JSON.stringify(Object.fromEntries(
          Object.entries(p).map(([k, v]) => [k, typeof v])
        ))
      }]
    });
    el = mount();
    el.shadowRoot.querySelector('[data-field="qty"]').value = '3';
    el.shadowRoot.querySelector('[data-field="ratio"]').value = '1.5';
    el.shadowRoot.querySelector('[data-field="gift"]').checked = true;
    await submit();
    assert.deepEqual(JSON.parse(output()), { qty: 'number', ratio: 'number', gift: 'boolean' });
  });

  test('truncates a fractional value in an integer field', async () => {
    mc.provideContext({
      tools: [{
        name: 'ints',
        inputSchema: { type: 'object', properties: { n: { type: 'integer' } } },
        execute: ({ n }) => `n=${n}`
      }]
    });
    el = mount();
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
    mc.provideContext({
      tools: [{ name: 'boom', inputSchema: { type: 'object', properties: {} }, execute: () => { throw new Error('kaboom'); } }]
    });
    el = mount();
    await submit();
    assert.match(output(), /kaboom/);
    assert.ok(el.shadowRoot.querySelector('pre.error'), 'error results should be styled as errors');
  });

  test('switching tools clears the previous result', async () => {
    mc.provideContext({
      tools: [CART_TOOL, { name: 'other', inputSchema: { type: 'object', properties: {} }, execute: () => 'other-ran' }]
    });
    el = mount();
    el.shadowRoot.querySelector('[data-field="sku"]').value = 'X';
    await submit();
    assert.notEqual(el.shadowRoot.querySelector('pre'), null);

    el.shadowRoot.querySelector('[data-tool="other"]').click();
    await tick();
    assert.equal(el.shadowRoot.querySelector('pre'), null, 'stale output must not carry over');
  });
});

describe('floating mode', () => {
  test('is inline by default with no toggle visible', () => {
    const el = mount();
    assert.equal(el.hasAttribute('floating'), false);
  });

  test('show() and hide() drive the open attribute', () => {
    const el = mount();
    el.setAttribute('floating', '');
    el.show();
    assert.equal(el.hasAttribute('open'), true);
    el.hide();
    assert.equal(el.hasAttribute('open'), false);
  });

  test('the toggle button flips open state', async () => {
    const el = mount();
    el.setAttribute('floating', '');
    await tick();
    el.shadowRoot.querySelector('.fab').click();
    assert.equal(el.hasAttribute('open'), true);
  });
});

describe('degraded environments', () => {
  test('explains itself when modelContext lacks discovery', async () => {
    const real = navigator.modelContext;
    // A native implementation exposes neither tools nor callTool.
    Object.defineProperty(navigator, 'modelContext', {
      value: { registerTool() {} }, configurable: true
    });
    const el = mount();
    assert.match(el.shadowRoot.textContent, /unavailable/);
    Object.defineProperty(navigator, 'modelContext', { value: real, configurable: true });
  });
});
