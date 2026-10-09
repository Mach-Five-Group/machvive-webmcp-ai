import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  collectProducts, normalizeProduct, facetsOf, readDocumentJsonLd
} from '../src/wc/machvive-webmcp-products/jsonld.js';

const SAMPLE = JSON.parse(readFileSync(
  '/Users/neodigm/Documents/2026/m5t/magnet_hvac_b2b/public/assets/products.json', 'utf8'));

const product = (extra = {}) => ({ '@type': 'Product', name: 'Widget', sku: 'W-1', ...extra });

describe('collectProducts: container shapes', () => {
  test('ItemList / itemListElement / ListItem / item', () => {
    const found = collectProducts(SAMPLE);
    assert.equal(found.length, 4);
    assert.deepEqual(found.map((p) => p.sku).sort(), ['AFB24-SR', 'BASRT-B', 'LF120 US', 'LF24-SR US']);
  });

  test('@graph', () => {
    const found = collectProducts({ '@context': 'https://schema.org', '@graph': [
      { '@type': 'Organization', name: 'Acme' },
      product({ sku: 'A' }),
      product({ sku: 'B' })
    ]});
    assert.deepEqual(found.map((p) => p.sku), ['A', 'B']);
  });

  test('a bare top-level array', () => {
    assert.equal(collectProducts([product({ sku: 'A' }), product({ sku: 'B' })]).length, 2);
  });

  test('a single Product with no container at all', () => {
    assert.equal(collectProducts(product()).length, 1);
  });

  test('a Product nested somewhere nobody anticipated', () => {
    // The walk exists so that enumerating container shapes is not required.
    const found = collectProducts({
      '@type': 'WebPage',
      mainEntity: { '@type': 'Review', itemReviewed: product({ sku: 'DEEP' }) }
    });
    assert.deepEqual(found.map((p) => p.sku), ['DEEP']);
  });

  test('nothing to find returns empty, not a throw', () => {
    for (const input of [null, undefined, {}, [], 'string', 42, { '@type': 'Organization' }]) {
      assert.deepEqual(collectProducts(input), [], `failed on ${JSON.stringify(input)}`);
    }
  });

  test('ProductModel and IndividualProduct count as products', () => {
    const found = collectProducts([
      { '@type': 'ProductModel', name: 'M', sku: 'M-1' },
      { '@type': 'IndividualProduct', name: 'I', sku: 'I-1' },
      { '@type': 'Offer', name: 'not a product', sku: 'O-1' }
    ]);
    assert.deepEqual(found.map((p) => p.sku).sort(), ['I-1', 'M-1']);
  });

  test('@type as an array, and as a full URL', () => {
    const found = collectProducts([
      { '@type': ['Product', 'Vehicle'], name: 'Van', sku: 'V-1' },
      { '@type': 'https://schema.org/Product', name: 'Url', sku: 'U-1' }
    ]);
    assert.deepEqual(found.map((p) => p.sku).sort(), ['U-1', 'V-1']);
  });
});

describe('normalizeProduct: field shapes', () => {
  test('brand as a string or a Brand node', () => {
    assert.equal(normalizeProduct(product({ brand: 'Belimo' })).brand, 'Belimo');
    assert.equal(normalizeProduct(product({ brand: { '@type': 'Brand', name: 'Belimo' } })).brand, 'Belimo');
    assert.equal(normalizeProduct(product({ brand: [{ name: 'First' }, { name: 'Second' }] })).brand, 'First');
    assert.equal(normalizeProduct(product()).brand, undefined);
  });

  test('image as a URL, an array, or an ImageObject', () => {
    assert.equal(normalizeProduct(product({ image: 'a.jpg' })).image, 'a.jpg');
    assert.equal(normalizeProduct(product({ image: ['a.jpg', 'b.jpg'] })).image, 'a.jpg');
    assert.equal(normalizeProduct(product({ image: { '@type': 'ImageObject', url: 'c.jpg' } })).image, 'c.jpg');
  });

  test('price as a string, with or without decoration', () => {
    const price = (p) => normalizeProduct(product({ offers: { '@type': 'Offer', price: p } })).price;
    assert.equal(price('209.99'), 209.99);
    assert.equal(price(209.99), 209.99);
    assert.equal(price('$1,299.00'), 1299);
    assert.equal(price('not a price'), null);
  });

  test('availability and condition are reduced to bare tokens', () => {
    // They arrive as full schema.org URLs. A filter cannot use a URL, and an
    // enum built from them would read terribly in the inspector's select.
    const p = normalizeProduct(product({ offers: {
      '@type': 'Offer', price: '1',
      availability: 'https://schema.org/InStock',
      itemCondition: 'https://schema.org/NewCondition'
    }}));
    assert.equal(p.availability, 'InStock');
    assert.equal(p.condition, 'NewCondition');

    const bare = normalizeProduct(product({ offers: { '@type': 'Offer', price: '1', availability: 'InStock' } }));
    assert.equal(bare.availability, 'InStock', 'a bare token must pass through unchanged');
  });

  test('offers as an array takes the first usable one', () => {
    const p = normalizeProduct(product({ offers: [
      { '@type': 'Offer', price: '10', priceCurrency: 'USD' },
      { '@type': 'Offer', price: '20', priceCurrency: 'EUR' }
    ]}));
    assert.equal(p.price, 10);
    assert.equal(p.currency, 'USD');
  });

  test('an offers array skips entries that carry nothing usable', () => {
    // The first entry is not always the real one. A stub offer carrying only a
    // url is common, and taking it blindly reports a product as unpriced.
    const p = normalizeProduct(product({ offers: [
      { '@type': 'Offer', url: 'https://example.com/p' },
      { '@type': 'Offer', price: '42.00', priceCurrency: 'GBP', availability: 'https://schema.org/InStock' }
    ]}));
    assert.equal(p.price, 42);
    assert.equal(p.currency, 'GBP');
    assert.equal(p.availability, 'InStock');
  });

  test('an offer with availability but no price is still usable', () => {
    // "Out of stock, price withheld" is information an agent should get.
    const p = normalizeProduct(product({ offers: [
      { '@type': 'Offer' },
      { '@type': 'Offer', availability: 'https://schema.org/OutOfStock' }
    ]}));
    assert.equal(p.price, null);
    assert.equal(p.availability, 'OutOfStock');
  });

  test('AggregateOffer reports the low price and keeps the range', () => {
    // "from $198" is actionable; a midpoint nobody can pay is not.
    const p = normalizeProduct(product({ offers: {
      '@type': 'AggregateOffer', lowPrice: '198.75', highPrice: '512.40', offerCount: '4', priceCurrency: 'USD'
    }}));
    assert.equal(p.price, 198.75);
    assert.deepEqual(p.priceRange, { low: 198.75, high: 512.4, count: 4 });
  });

  test('any gtin flavour lands in one field', () => {
    for (const key of ['gtin13', 'gtin14', 'gtin12', 'gtin8', 'gtin']) {
      assert.equal(normalizeProduct(product({ [key]: '0849696010914' })).gtin, '0849696010914', key);
    }
    assert.equal(normalizeProduct(product({ gtin13: 849696010914 })).gtin, '849696010914', 'numeric gtin');
  });

  test('aggregateRating is surfaced as numbers', () => {
    const p = normalizeProduct(product({ aggregateRating: {
      '@type': 'AggregateRating', ratingValue: '4.8', reviewCount: '17'
    }}));
    assert.equal(p.rating, 4.8);
    assert.equal(p.reviewCount, 17);
  });

  test('a product with almost nothing on it still normalizes', () => {
    const p = normalizeProduct({ '@type': 'Product', name: 'Bare' });
    assert.equal(p.name, 'Bare');
    assert.equal(p.price, null);
    assert.equal(p.brand, undefined);
    assert.ok('raw' in p, 'the original node is kept for get_product');
  });
});

describe('dedupe', () => {
  test('the same product twice collapses to one', () => {
    const found = collectProducts({ '@graph': [
      { '@type': 'BreadcrumbList', itemListElement: [{ '@type': 'ListItem', item: product({ sku: 'X' }) }] },
      product({ sku: 'X' })
    ]});
    assert.equal(found.length, 1);
  });

  test('the richer record wins', () => {
    const found = collectProducts([
      product({ sku: 'X' }),
      product({ sku: 'X', brand: 'Belimo', category: 'Actuators', description: 'full' })
    ]);
    assert.equal(found.length, 1);
    assert.equal(found[0].brand, 'Belimo', 'the sparse copy must not overwrite the full one');
  });

  test('different products are not collapsed', () => {
    assert.equal(collectProducts([product({ sku: 'A' }), product({ sku: 'B' })]).length, 2);
  });

  test('identity falls back through gtin, url, then name', () => {
    assert.equal(collectProducts([
      { '@type': 'Product', name: 'A', gtin13: '1' }, { '@type': 'Product', name: 'B', gtin13: '1' }
    ]).length, 1, 'gtin');
    assert.equal(collectProducts([
      { '@type': 'Product', name: 'A', url: 'u' }, { '@type': 'Product', name: 'B', url: 'u' }
    ]).length, 1, 'url');
    assert.equal(collectProducts([
      { '@type': 'Product', name: 'Same' }, { '@type': 'Product', name: 'Same' }
    ]).length, 1, 'name');
  });
});

describe('readDocumentJsonLd', () => {
  const mount = (...blocks) => {
    document.body.replaceChildren();
    for (const text of blocks) {
      const s = document.createElement('script');
      s.type = 'application/ld+json';
      s.textContent = text;
      document.body.append(s);
    }
  };

  test('reads every block on the page', () => {
    mount(JSON.stringify(product({ sku: 'A' })), JSON.stringify(product({ sku: 'B' })));
    const blocks = readDocumentJsonLd(document);
    assert.equal(blocks.length, 2);
    assert.equal(collectProducts(blocks).length, 2);
  });

  test('one malformed block does not take the others down', () => {
    // Pages routinely carry generated blocks beside a hand-written one, and the
    // hand-written one is the one with the trailing comma.
    mount('{ "@type": "Product", "name": "Good", "sku": "G" }', '{ "oops": , }');
    const blocks = readDocumentJsonLd(document);
    assert.equal(blocks.length, 1);
    assert.equal(collectProducts(blocks)[0].sku, 'G');
  });

  test('a page with no JSON-LD yields nothing', () => {
    document.body.replaceChildren();
    assert.deepEqual(readDocumentJsonLd(document), []);
  });
});

describe('facetsOf', () => {
  test('derives the values an agent may filter on', () => {
    const f = facetsOf(collectProducts(SAMPLE));
    assert.deepEqual(f.categories, ['HVAC Actuators', 'Network Devices']);
    assert.deepEqual(f.brands, ['Belimo', 'Contemporary Controls']);
    assert.deepEqual(f.availability, ['InStock', 'OutOfStock']);
    assert.equal(f.count, 4);
    assert.deepEqual(f.priceRange, { low: 198.75, high: 512.4 });
  });

  test('values are distinct and sorted', () => {
    const f = facetsOf([
      normalizeProduct(product({ sku: '1', category: 'Zeta' })),
      normalizeProduct(product({ sku: '2', category: 'Alpha' })),
      normalizeProduct(product({ sku: '3', category: 'Alpha' }))
    ]);
    assert.deepEqual(f.categories, ['Alpha', 'Zeta']);
  });

  test('no priced products means no price range, not NaN', () => {
    const f = facetsOf([normalizeProduct(product())]);
    assert.equal(f.priceRange, undefined);
    assert.equal(f.count, 1);
  });

  test('an empty catalogue is reported as empty', () => {
    const f = facetsOf([]);
    assert.deepEqual(f.categories, []);
    assert.equal(f.count, 0);
  });
});
