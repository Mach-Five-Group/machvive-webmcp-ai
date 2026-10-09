/**
 * Reads schema.org Product data out of a page's JSON-LD.
 *
 * The premise of the component this backs: the markup is already there. Sites
 * maintain JSON-LD because search engines reward it, so the catalogue an agent
 * wants is usually sitting in a <script type="application/ld+json"> block that
 * someone else is already keeping current.
 *
 * Which means the work here is almost entirely normalisation. Real-world
 * JSON-LD is correct-but-inconsistent in a dozen small ways, and a reader that
 * only handles the tidy shape works on the fixture and fails on the web.
 */

/** `@type` is a string on most nodes and an array on some. Always compare as a set. */
function typesOf(node) {
  const raw = node?.['@type'];
  if (!raw) return [];
  return (Array.isArray(raw) ? raw : [raw]).map((t) => String(t).split(/[/#]/).pop());
}

const isProduct = (node) =>
  typesOf(node).some((t) => t === 'Product' || t === 'ProductModel' || t === 'IndividualProduct');

/** schema.org enums arrive as full URLs; the bare token is what a filter can use. */
const token = (value) => (typeof value === 'string' ? value.split(/[/#]/).pop() : undefined);

/** Prices are strings in JSON-LD far more often than numbers. */
function toNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  // Strip currency symbols and thousands separators; keep the decimal point.
  const cleaned = value.replace(/[^0-9.-]/g, '');
  const n = Number.parseFloat(cleaned);
  return Number.isFinite(n) ? n : null;
}

/** `brand` is a string as often as it is a Brand node. Same for seller, category. */
function nameOf(value) {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return nameOf(value[0]);
  if (value && typeof value === 'object') return value.name ?? value['@id'] ?? undefined;
  return undefined;
}

/** `image` may be a URL, an ImageObject, or an array of either. */
function urlOf(value) {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return urlOf(value[0]);
  if (value && typeof value === 'object') return value.url ?? value.contentUrl ?? value['@id'] ?? undefined;
  return undefined;
}

/**
 * Picks the offer that best represents "the price".
 *
 * `offers` is an Offer, an array of Offers, or an AggregateOffer with a range.
 * For a range we take the low price: an agent comparing options is better served
 * by "from $198" than by a number nobody can actually pay.
 */
function readOffers(offers) {
  if (!offers) return {};
  const list = Array.isArray(offers) ? offers : [offers];

  for (const offer of list) {
    if (!offer || typeof offer !== 'object') continue;
    const isAggregate = typesOf(offer).includes('AggregateOffer');
    const price = toNumber(isAggregate ? offer.lowPrice ?? offer.price : offer.price);
    if (price === null && !offer.availability) continue;
    return {
      price,
      priceCurrency: offer.priceCurrency ?? offer.priceSpecification?.priceCurrency,
      availability: token(offer.availability),
      condition: token(offer.itemCondition),
      seller: nameOf(offer.seller),
      offerUrl: urlOf(offer.url),
      priceRange: isAggregate
        ? { low: toNumber(offer.lowPrice), high: toNumber(offer.highPrice), count: toNumber(offer.offerCount) }
        : undefined
    };
  }
  return {};
}

/** Flattens one Product node into something a tool schema can describe. */
export function normalizeProduct(node) {
  const offer = readOffers(node.offers);
  const rating = node.aggregateRating;

  return {
    name: node.name ?? nameOf(node) ?? '',
    description: typeof node.description === 'string' ? node.description : undefined,
    sku: node.sku ? String(node.sku) : undefined,
    mpn: node.mpn ? String(node.mpn) : undefined,
    // Any of the gtin flavours, normalised to one field an agent can match on.
    gtin: [node.gtin13, node.gtin14, node.gtin12, node.gtin8, node.gtin]
      .find((v) => v !== undefined && v !== null)?.toString(),
    brand: nameOf(node.brand),
    category: nameOf(node.category),
    url: urlOf(node.url),
    image: urlOf(node.image),
    price: offer.price ?? null,
    currency: offer.priceCurrency,
    availability: offer.availability,
    condition: offer.condition,
    seller: offer.seller,
    priceRange: offer.priceRange,
    rating: toNumber(rating?.ratingValue),
    reviewCount: toNumber(rating?.reviewCount),
    raw: node
  };
}

/**
 * Walks any JSON-LD and collects every Product in it.
 *
 * A recursive walk rather than a list of known container shapes. `@graph`,
 * `ItemList`/`itemListElement`, `mainEntity`, a bare array, a single Product, or
 * a Product nested inside an Offer all arrive in the wild, and enumerating them
 * is a losing game — the walk handles shapes nobody has thought of yet.
 */
export function collectProducts(input) {
  const found = [];
  const seen = new WeakSet();

  const visit = (node) => {
    if (!node || typeof node !== 'object') return;
    if (seen.has(node)) return;        // defensive: JSON cannot cycle, but callers can pass anything
    seen.add(node);

    if (Array.isArray(node)) {
      for (const child of node) visit(child);
      return;
    }
    if (isProduct(node)) found.push(normalizeProduct(node));
    for (const value of Object.values(node)) {
      if (value && typeof value === 'object') visit(value);
    }
  };

  visit(input);
  return dedupe(found);
}

/**
 * One product can legitimately appear twice — once in an ItemList and again in
 * a BreadcrumbList or a Review. Identity is sku, then gtin, then url, then name.
 */
function dedupe(products) {
  const byKey = new Map();
  for (const product of products) {
    const key = product.sku ?? product.gtin ?? product.url ?? product.name;
    if (!key) continue;
    // Keep the richer record when the same product turns up twice.
    const existing = byKey.get(key);
    if (!existing || score(product) > score(existing)) byKey.set(key, product);
  }
  return [...byKey.values()];
}

const score = (p) => Object.values(p).filter((v) => v !== undefined && v !== null).length;

/**
 * Parses every JSON-LD block in a document.
 *
 * A malformed block must not take the others down: pages routinely carry one
 * hand-written block beside several generated ones, and the hand-written one is
 * the one with the trailing comma.
 */
export function readDocumentJsonLd(doc = globalThis.document) {
  const blocks = doc?.querySelectorAll?.('script[type="application/ld+json"]') ?? [];
  const parsed = [];
  for (const block of blocks) {
    try {
      parsed.push(JSON.parse(block.textContent));
    } catch (error) {
      console.warn('[machvive] skipping malformed JSON-LD block:', error.message);
    }
  }
  return parsed;
}

/** Distinct values an agent can legitimately filter on, taken from the data itself. */
export function facetsOf(products) {
  const distinct = (pick) => [...new Set(products.map(pick).filter(Boolean))].sort();
  const prices = products.map((p) => p.price).filter((p) => typeof p === 'number');
  return {
    categories: distinct((p) => p.category),
    brands: distinct((p) => p.brand),
    availability: distinct((p) => p.availability),
    currencies: distinct((p) => p.currency),
    count: products.length,
    priceRange: prices.length ? { low: Math.min(...prices), high: Math.max(...prices) } : undefined
  };
}
