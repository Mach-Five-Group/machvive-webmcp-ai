import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import '../src/wc/machvive-webmcp-products/machvive-webmcp-products.js';
import { PRODUCT_TOOLS } from '../src/wc/machvive-webmcp-products/machvive-webmcp-products.js';

const SAMPLE = readFileSync(
  fileURLToPath(new URL('./fixtures/products.jsonld.json', import.meta.url)), 'utf8');

const tools = () => navigator.modelContext?.tools ?? [];
const named = (n) => tools().find((t) => t.name === n);
const call = async (n, params) => {
  const r = await navigator.modelContext.callTool(n, params);
  return { raw: r, data: JSON.parse(r.content[0].text) };
};

/** Puts the sample on the page the way a real site carries it. */
function withJsonLd(json = SAMPLE) {
  const script = document.createElement('script');
  script.type = 'application/ld+json';
  script.textContent = json;
  document.body.append(script);
}

async function mount(attrs = {}) {
  const el = document.createElement('machvive-webmcp-products');
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  document.body.append(el);
  await el.load();
  return el;
}

describe('<machvive-webmcp-products>', () => {
  beforeEach(() => document.body.replaceChildren());

  test('importing it installs the polyfill', () => {
    assert.ok(navigator.modelContext, 'registering against a missing registry is the analytics bug');
  });

  test('reads the JSON-LD already on the page and publishes three tools', async () => {
    withJsonLd();
    const el = await mount();
    assert.equal(el.products.length, 4);
    for (const name of Object.values(PRODUCT_TOOLS)) assert.ok(named(name), `${name} missing`);
  });

  test('a page with no product JSON-LD says so rather than failing', async () => {
    const el = await mount();
    assert.deepEqual(el.products, []);
    assert.match(el.shadowRoot.textContent, /No product JSON-LD found/);
    const { data } = await call(PRODUCT_TOOLS.SEARCH, {});
    assert.equal(data.total, 0);
  });

  test('filter enums are built from the page’s own data', async () => {
    withJsonLd();
    await mount();
    const schema = named(PRODUCT_TOOLS.SEARCH).inputSchema.properties;
    // This is what makes the inspector render a select of real values, and
    // what stops an agent guessing a category name that does not exist.
    assert.deepEqual(schema.category.enum, ['HVAC Actuators', 'Network Devices']);
    assert.deepEqual(schema.brand.enum, ['Belimo', 'Contemporary Controls']);
    assert.deepEqual(schema.availability.enum, ['InStock', 'OutOfStock']);
  });

  test('every documented bound is declared in the schema', async () => {
    // A constraint stated only in prose is invisible to a validator, and to an
    // agent planning a call — it finds out by having its input silently
    // clamped. This was a real finding from a third-party scan.
    withJsonLd();
    await mount();
    const search = named(PRODUCT_TOOLS.SEARCH).inputSchema.properties;

    assert.equal(search.limit.maximum, 50, 'the description promises max 50');
    assert.equal(search.limit.minimum, 1);
    assert.equal(search.limit.default, 10, 'the description promises a default of 10');
    assert.equal(search.offset.minimum, 0);
    assert.equal(search.minPrice.minimum, 0);
    assert.equal(search.maxPrice.minimum, 0);
    assert.ok(search.query.maxLength > 0, 'free text must be bounded');

    const get = named(PRODUCT_TOOLS.GET).inputSchema.properties;
    assert.ok(get.id.maxLength > 0);
    assert.equal(get.id.minLength, 1);
  });

  test('a declared bound matches what the code actually does', async () => {
    // Declaring a limit the implementation ignores is worse than not declaring
    // it: the schema becomes a promise nothing keeps.
    const many = Array.from({ length: 60 }, (_, i) => ({
      '@type': 'Product', name: `Item ${i}`, sku: `S-${i}`
    }));
    withJsonLd(JSON.stringify(many));
    const el = await mount();
    const schema = named(PRODUCT_TOOLS.SEARCH).inputSchema.properties;
    const { data } = await call(PRODUCT_TOOLS.SEARCH, { limit: schema.limit.maximum + 1000 });
    assert.equal(data.returned, schema.limit.maximum);

    // An over-long query is refused with a reason, not quietly shortened:
    // truncating answers a question the agent did not ask, and it cannot tell.
    const long = await call(PRODUCT_TOOLS.SEARCH, { query: 'x'.repeat(schema.query.maxLength + 1) });
    assert.equal(long.raw.isError, true);
    assert.match(long.data.error, /query must be \d+ characters or fewer/);
    assert.equal(long.data.received, schema.query.maxLength + 1);

    // At the limit it is accepted, so the boundary is where it is declared.
    const atLimit = await call(PRODUCT_TOOLS.SEARCH, { query: 'x'.repeat(schema.query.maxLength) });
    assert.equal(atLimit.raw.isError, undefined);
    assert.equal(el.products.length, 60);
  });

  test('no facet values means no empty enum', async () => {
    // An `enum: []` renders a select with nothing in it, which is worse than
    // a free-text box.
    withJsonLd(JSON.stringify({ '@type': 'Product', name: 'Bare', sku: 'B-1' }));
    await mount();
    const schema = named(PRODUCT_TOOLS.SEARCH).inputSchema.properties;
    assert.equal(schema.category.enum, undefined);
    assert.equal(schema.brand.enum, undefined);
  });
});

describe('search_products', () => {
  beforeEach(() => document.body.replaceChildren());

  test('free text matches name, description, sku and brand', async () => {
    withJsonLd(); await mount();
    for (const [query, expected] of [['actuator', 3], ['belimo', 3], ['BASRT-B', 1], ['bacnet', 1]]) {
      const { data } = await call(PRODUCT_TOOLS.SEARCH, { query });
      assert.equal(data.total, expected, `"${query}" matched ${data.total}`);
    }
  });

  test('every term must match, not any', async () => {
    withJsonLd(); await mount();
    const both = await call(PRODUCT_TOOLS.SEARCH, { query: 'belimo router' });
    assert.equal(both.data.total, 0, '"belimo router" should match neither product');
  });

  test('structured filters narrow correctly and combine', async () => {
    withJsonLd(); await mount();
    assert.equal((await call(PRODUCT_TOOLS.SEARCH, { brand: 'Belimo' })).data.total, 3);
    assert.equal((await call(PRODUCT_TOOLS.SEARCH, { category: 'Network Devices' })).data.total, 1);
    assert.equal((await call(PRODUCT_TOOLS.SEARCH, { availability: 'OutOfStock' })).data.total, 1);
    assert.equal((await call(PRODUCT_TOOLS.SEARCH, { brand: 'Belimo', availability: 'InStock' })).data.total, 2);
  });

  test('price bounds are inclusive', async () => {
    withJsonLd(); await mount();
    assert.equal((await call(PRODUCT_TOOLS.SEARCH, { maxPrice: 209.99 })).data.total, 2);
    assert.equal((await call(PRODUCT_TOOLS.SEARCH, { minPrice: 295 })).data.total, 2);
    assert.equal((await call(PRODUCT_TOOLS.SEARCH, { minPrice: 200, maxPrice: 300 })).data.total, 2);
  });

  test('a product with no price cannot satisfy a price filter', async () => {
    withJsonLd();
    const el = await mount();
    // Reload the *owning* element. Mounting a second one leaves the first in
    // charge of the tools, so the call would answer from stale data and the
    // test would pass without exercising anything.
    withJsonLd(JSON.stringify({ '@type': 'Product', name: 'Unpriced', sku: 'U-1' }));
    await el.load();
    assert.equal(el.products.length, 5, 'the unpriced product is in the catalogue');

    const { data } = await call(PRODUCT_TOOLS.SEARCH, { maxPrice: 1000 });
    assert.equal(data.total, 4, 'but an unknown price is not "cheap enough"');
    assert.ok(!data.products.some((p) => p.sku === 'U-1'));

    const low = await call(PRODUCT_TOOLS.SEARCH, { minPrice: 0 });
    assert.equal(low.data.total, 4, 'nor "expensive enough"');
  });

  test('results are capped, paged, and say when they are partial', async () => {
    withJsonLd(); await mount();
    const page = await call(PRODUCT_TOOLS.SEARCH, { limit: 2 });
    assert.equal(page.data.returned, 2);
    assert.equal(page.data.total, 4);
    // An agent that cannot tell a page from a complete answer will report
    // "there are 2 products".
    assert.equal(page.data.truncated, true);

    const rest = await call(PRODUCT_TOOLS.SEARCH, { limit: 2, offset: 2 });
    assert.equal(rest.data.returned, 2);
    assert.equal(rest.data.truncated, false);
    assert.equal(
      new Set([...page.data.products, ...rest.data.products].map((p) => p.sku)).size, 4,
      'paging must not repeat or skip');
  });

  test('an absurd limit is clamped to the ceiling', async () => {
    // Needs a catalogue bigger than the cap: against four products, slice()
    // returns everything whether or not the clamp exists.
    const many = Array.from({ length: 60 }, (_, i) => ({
      '@type': 'Product', name: `Item ${i}`, sku: `S-${i}`,
      offers: { '@type': 'Offer', price: String(i + 1), priceCurrency: 'USD' }
    }));
    withJsonLd(JSON.stringify(many));
    const el = await mount();
    assert.equal(el.products.length, 60);

    const { data } = await call(PRODUCT_TOOLS.SEARCH, { limit: 100000 });
    assert.equal(data.returned, 50, 'a tool result must not grow without bound');
    assert.equal(data.total, 60);
    assert.equal(data.truncated, true);

    const defaulted = await call(PRODUCT_TOOLS.SEARCH, {});
    assert.equal(defaulted.data.returned, 10, 'and the default stays small');
  });

  test('search returns a summary, not the whole record', async () => {
    withJsonLd(); await mount();
    const { data } = await call(PRODUCT_TOOLS.SEARCH, { query: 'BASRT-B' });
    const product = data.products[0];
    assert.ok(product.name && product.sku && product.price);
    // Returning raw JSON-LD here would fill an agent's context with markup.
    assert.equal(product.jsonld, undefined);
    assert.equal(product.description, undefined);
  });
});

describe('variant products through the tools', () => {
  beforeEach(() => document.body.replaceChildren());

  const GROUP = readFileSync(
    fileURLToPath(new URL('./fixtures/productgroup.jsonld.json', import.meta.url)), 'utf8');

  test('search returns one row carrying the variant summary', async () => {
    withJsonLd(GROUP);
    await mount();
    const { data } = await call(PRODUCT_TOOLS.SEARCH, {});
    assert.equal(data.total, 1, 'one product, not one row per variant');
    const [row] = data.products;
    assert.equal(row.name, "Men's Tree Runner");
    assert.equal(row.variants, 3);
    assert.deepEqual(row.variesBy, ['size', 'color']);
  });

  test('a product with no variants carries no variant keys', async () => {
    withJsonLd();   // the flat HVAC fixture
    await mount();
    const { data } = await call(PRODUCT_TOOLS.SEARCH, { query: 'BASRT-B' });
    assert.equal(data.products[0].variants, undefined, 'no noise where there is nothing to say');
  });

  test('get_product resolves a variant SKU to its group', async () => {
    // The SKU on the box is the variant's, not the group's. Answering "no
    // product matches" for an identifier the page publishes is a bad miss.
    withJsonLd(GROUP);
    await mount();
    const { raw, data } = await call(PRODUCT_TOOLS.GET, { id: 'TR-M-11-BLK' });
    assert.ok(!raw.isError, JSON.stringify(data));
    assert.equal(data.sku, 'TR-MENS');
    assert.equal(data.variants.count, 3);
  });

  test('an unknown SKU is still a miss', async () => {
    withJsonLd(GROUP);
    await mount();
    const { raw } = await call(PRODUCT_TOOLS.GET, { id: 'TR-M-99-PINK' });
    assert.equal(raw.isError, true, 'variant matching must not match everything');
  });
});

describe('get_product', () => {
  beforeEach(() => document.body.replaceChildren());

  test('finds by sku, mpn or gtin, case-insensitively', async () => {
    withJsonLd(); await mount();
    for (const id of ['LF24-SR US', 'lf24-sr us', '0849696010914']) {
      const { data } = await call(PRODUCT_TOOLS.GET, { id });
      assert.equal(data.sku, 'LF24-SR US', `lookup by "${id}"`);
    }
  });

  test('returns the full record including the original JSON-LD', async () => {
    withJsonLd(); await mount();
    const { data } = await call(PRODUCT_TOOLS.GET, { id: 'AFB24-SR' });
    assert.equal(data.rating, 4.8);
    assert.equal(data.description.length > 20, true);
    assert.equal(data.jsonld['@type'], 'Product', 'the untouched node is what a careful agent wants');
  });

  test('an over-long id is refused with a reason', async () => {
    withJsonLd(); await mount();
    const max = named(PRODUCT_TOOLS.GET).inputSchema.properties.id.maxLength;
    const { raw, data } = await call(PRODUCT_TOOLS.GET, { id: 'x'.repeat(max + 1) });
    assert.equal(raw.isError, true);
    assert.match(data.error, /id must be \d+ characters or fewer/);
  });

  test('an unknown id is an error result, not a throw', async () => {
    withJsonLd(); await mount();
    const { raw, data } = await call(PRODUCT_TOOLS.GET, { id: 'NOPE' });
    assert.equal(raw.isError, true);
    assert.match(data.error, /no product matches/);
  });

  test('a missing id is an error result', async () => {
    withJsonLd(); await mount();
    const { raw } = await call(PRODUCT_TOOLS.GET, {});
    assert.equal(raw.isError, true);
  });
});

describe('list_product_facets', () => {
  beforeEach(() => document.body.replaceChildren());

  test('reports what an agent may filter on', async () => {
    withJsonLd(); await mount();
    const { data } = await call(PRODUCT_TOOLS.FACETS, {});
    assert.deepEqual(data.categories, ['HVAC Actuators', 'Network Devices']);
    assert.equal(data.count, 4);
    assert.deepEqual(data.priceRange, { low: 198.75, high: 512.4 });
  });
});

describe('lifecycle', () => {
  beforeEach(() => document.body.replaceChildren());

  test('read-only: it registers no tool that mutates anything', async () => {
    withJsonLd(); await mount();
    const names = tools().map((t) => t.name);
    for (const verb of ['add', 'buy', 'order', 'cart', 'checkout', 'update', 'delete', 'set']) {
      assert.ok(!names.some((n) => n.includes(verb)), `${verb} suggests a mutation`);
    }
  });

  test('two elements publish one set of tools, and the first owns them', async () => {
    withJsonLd();
    const first = await mount();
    const second = await mount({ 'no-tool': '' });
    assert.equal(tools().filter((t) => t.name === PRODUCT_TOOLS.SEARCH).length, 1);
    assert.equal(second.hasAttribute('no-tool'), true);
    assert.equal(first.products.length, 4);
  });

  test('removing the owner withdraws the tools', async () => {
    withJsonLd();
    const el = await mount();
    assert.ok(named(PRODUCT_TOOLS.SEARCH));
    el.remove();
    for (const name of Object.values(PRODUCT_TOOLS)) {
      assert.equal(named(name), undefined, `${name} should not stay advertised`);
    }
  });

  test('no-tool opts out and is reversible', async () => {
    withJsonLd();
    const el = await mount({ 'no-tool': '' });
    assert.equal(named(PRODUCT_TOOLS.SEARCH), undefined);
    el.removeAttribute('no-tool');
    assert.ok(named(PRODUCT_TOOLS.SEARCH));
    el.setAttribute('no-tool', '');
    assert.equal(named(PRODUCT_TOOLS.SEARCH), undefined);
  });

  test('load() refreshes after the page’s JSON-LD changes', async () => {
    withJsonLd(JSON.stringify({ '@type': 'Product', name: 'One', sku: 'ONE' }));
    const el = await mount();
    assert.equal(el.products.length, 1);

    withJsonLd(JSON.stringify({ '@type': 'Product', name: 'Two', sku: 'TWO' }));
    await el.load();
    assert.equal(el.products.length, 2);
    // The enum has to move with the data, or the form offers stale choices.
    const { data } = await call(PRODUCT_TOOLS.SEARCH, { query: 'two' });
    assert.equal(data.total, 1);
  });

  test('a src that cannot be fetched reports instead of failing silently', async () => {
    const original = globalThis.fetch;
    globalThis.fetch = async () => { throw new Error('network down'); };
    try {
      const el = await mount({ src: 'https://example.test/products.json' });
      assert.deepEqual(el.products, []);
      assert.match(el.shadowRoot.textContent, /Could not read product data: network down/);
      // The tools still exist and return an honest empty answer.
      assert.equal((await call(PRODUCT_TOOLS.SEARCH, {})).data.total, 0);
    } finally {
      globalThis.fetch = original;
    }
  });

  test('src takes precedence over the page’s own JSON-LD', async () => {
    withJsonLd();   // 4 products on the page
    const original = globalThis.fetch;
    globalThis.fetch = async () => ({ json: async () => ({ '@type': 'Product', name: 'Remote', sku: 'R-1' }) });
    try {
      const el = await mount({ src: 'https://example.test/products.json' });
      assert.deepEqual(el.products.map((p) => p.sku), ['R-1']);
    } finally {
      globalThis.fetch = original;
    }
  });
});
