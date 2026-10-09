/**
 * Exposes a page's product JSON-LD to an agent as WebMCP tools.
 *
 * The argument for this component is that the work is already done. Sites carry
 * schema.org Product markup because search engines reward it, and somebody is
 * already keeping it current. Reading that markup turns an existing SEO
 * obligation into agent capability with no backend, no new API and nothing to
 * keep in sync.
 *
 * Strictly read-only: it searches and reads, never adds to a cart or places an
 * order. That is what makes it safe to publish automatically, and why it needs
 * no credentials of any kind.
 */
import { THEME_CSS } from '../shared/theme.js';
import { TOOLS_CHANGED_EVENT } from '../machvive-webmcp-polyfill/machvive-webmcp-polyfill.js';
import { collectProducts, readDocumentJsonLd, facetsOf } from './jsonld.js';

export { collectProducts, normalizeProduct, readDocumentJsonLd, facetsOf } from './jsonld.js';
export { TOOLS_CHANGED_EVENT };

export const PRODUCT_TOOLS = Object.freeze({
  SEARCH: 'search_products',
  GET: 'get_product',
  FACETS: 'list_product_facets'
});

/** Tool names are a page-wide namespace, so one element owns them at a time. */
let owner = null;

/** A tool result lands in an agent's context window; a whole catalogue must not. */
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;
/** Declared on the schema as well as enforced, so a validator can see them. */
const MAX_QUERY = 200;
const MAX_ID = 100;

/** The compact projection returned by search. `get_product` returns everything. */
const summarize = (p) => ({
  name: p.name,
  sku: p.sku,
  brand: p.brand,
  category: p.category,
  price: p.price,
  currency: p.currency,
  availability: p.availability,
  url: p.url
});

const haystack = (p) =>
  [p.name, p.description, p.sku, p.mpn, p.gtin, p.brand, p.category].filter(Boolean).join(' ').toLowerCase();

export class MachviveWebmcpProducts extends HTMLElement {
  #products = [];

  static get observedAttributes() {
    return ['src', 'theme', 'no-tool'];
  }

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
  }

  get theme() { return this.getAttribute('theme'); }
  set theme(value) {
    if (value == null) this.removeAttribute('theme');
    else this.setAttribute('theme', value);
  }

  /** Optional JSON-LD URL. Omit to read the JSON-LD already on the page. */
  get src() { return this.getAttribute('src'); }
  set src(value) {
    if (value == null) this.removeAttribute('src');
    else this.setAttribute('src', value);
  }

  /** The normalized catalogue currently published. */
  get products() { return [...this.#products]; }

  get facets() { return facetsOf(this.#products); }

  async connectedCallback() {
    this.shadowRoot.innerHTML = `
      <style>
${THEME_CSS}
        :host {
          display: block;
          font-family: system-ui, -apple-system, sans-serif;
          font-size: 0.875rem;
          /* Inherit, and paint nothing. This renders a one-line status, not a
             surface of its own — and a text element that follows the OS
             independently of its container is wrong whenever they disagree. */
          color: inherit;
        }
        :host([theme="dark"]), :host([theme="light"]) {
          color: var(--mv-fg);
          background: var(--mv-bg);
        }
        :host([hidden]) { display: none; }
        p { margin: 0; }
        .count { font-weight: 600; }
        .muted { color: var(--mv-muted); }
      </style>
      <p class="muted">Reading product data…</p>
    `;
    await this.load();
  }

  disconnectedCallback() { this.#release(); }

  attributeChangedCallback(name, before, after) {
    if (!this.shadowRoot?.childElementCount || before === after) return;
    if (name === 'theme') return;                       // pure CSS
    if (name === 'no-tool') {
      if (this.hasAttribute('no-tool')) this.#release();
      else this.#publish();
      return;
    }
    this.load();                                         // src changed
  }

  /** Re-reads the source and republishes. Call after the page's JSON-LD changes. */
  async load() {
    const src = this.src;
    try {
      this.#products = src
        ? collectProducts(await fetch(src, { credentials: 'omit' }).then((r) => r.json()))
        : collectProducts(readDocumentJsonLd(this.ownerDocument ?? document));
      this.#report();
    } catch (error) {
      // A catalogue that cannot be read is worth saying out loud. Failing
      // silently leaves a page advertising tools that return nothing.
      this.#products = [];
      this.#report(error);
    }
    this.#publish();
    return this.#products;
  }

  #report(error) {
    const node = this.shadowRoot?.querySelector('p');
    if (!node) return;
    if (error) {
      node.className = 'muted';
      node.textContent = `Could not read product data: ${error.message}`;
      return;
    }
    const n = this.#products.length;
    node.className = n ? 'count' : 'muted';
    node.textContent = n
      ? `${n} product${n === 1 ? '' : 's'} exposed to agents`
      : 'No product JSON-LD found on this page';
  }

  #publish() {
    if (this.hasAttribute('no-tool')) return;
    const context = globalThis.navigator?.modelContext;
    if (!context) return;

    // Ownership plus liveness: after provideContext the owner still points here
    // while the registry holds nothing, and checking ownership alone would
    // leave the page advertising no tools at all.
    const live = context.tools?.some((t) => t.name === PRODUCT_TOOLS.SEARCH);
    if (owner && owner !== this && live) return;
    owner = this;

    const facets = this.facets;
    const enumOf = (values) => (values.length ? { enum: values } : {});

    context.registerTool({
      name: PRODUCT_TOOLS.SEARCH,
      description:
        'Search the products this page describes. Combine free text with filters. ' +
        'Returns a compact summary of each match; use get_product for the full record.',
      inputSchema: {
        type: 'object',
        properties: {
          // Every bound the code enforces is also declared. A constraint stated
          // only in prose is invisible to a validator and to an agent planning a
          // call — it finds out by having its input silently clamped.
          query: {
            type: 'string', maxLength: MAX_QUERY,
            description: 'Free text matched against name, description, SKU, brand and category'
          },
          // Enums come from the page's own data, so an agent never has to guess
          // a category name — and the inspector renders them as a select.
          category: { type: 'string', description: 'Exact category', ...enumOf(facets.categories) },
          brand: { type: 'string', description: 'Exact brand', ...enumOf(facets.brands) },
          availability: { type: 'string', description: 'Stock status', ...enumOf(facets.availability) },
          maxPrice: { type: 'number', minimum: 0, description: 'Only products at or below this price' },
          minPrice: { type: 'number', minimum: 0, description: 'Only products at or above this price' },
          limit: {
            type: 'integer', minimum: 1, maximum: MAX_LIMIT, default: DEFAULT_LIMIT,
            description: `Maximum results (default ${DEFAULT_LIMIT}, max ${MAX_LIMIT})`
          },
          offset: { type: 'integer', minimum: 0, default: 0, description: 'Skip this many matches, for paging' }
        }
      },
      execute: async (params = {}) => this.#search(params)
    });

    context.registerTool({
      name: PRODUCT_TOOLS.GET,
      description: 'Fetch one product in full by SKU, MPN or GTIN, including its original JSON-LD.',
      inputSchema: {
        type: 'object',
        properties: { id: { type: 'string', minLength: 1, maxLength: MAX_ID, description: 'A SKU, MPN or GTIN' } },
        required: ['id']
      },
      execute: async ({ id } = {}) => this.#get(id)
    });

    context.registerTool({
      name: PRODUCT_TOOLS.FACETS,
      description:
        'List the categories, brands, stock states and price range present on this page. ' +
        'Call this before search_products to learn what the valid filter values are.',
      inputSchema: { type: 'object', properties: {} },
      execute: async () => text(this.facets)
    });
  }

  #release() {
    if (owner !== this) return;
    const context = globalThis.navigator?.modelContext;
    for (const name of Object.values(PRODUCT_TOOLS)) context?.unregisterTool(name);
    owner = null;

    for (const candidate of globalThis.document?.querySelectorAll?.('machvive-webmcp-products') ?? []) {
      if (candidate !== this && candidate.isConnected && candidate instanceof MachviveWebmcpProducts) {
        candidate.#publish();
        break;
      }
    }
  }

  #search({ query, category, brand, availability, maxPrice, minPrice, limit, offset } = {}) {
    // Reject rather than truncate. Silently shortening a query means answering
    // a question the agent did not ask, and it has no way to notice.
    if (typeof query === 'string' && query.length > MAX_QUERY) {
      return text({ error: `query must be ${MAX_QUERY} characters or fewer`, received: query.length }, true);
    }
    const needle = typeof query === 'string' ? query.trim().toLowerCase() : '';
    const terms = needle ? needle.split(/\s+/) : [];

    const matches = this.#products.filter((p) => {
      if (terms.length) {
        const hay = haystack(p);
        // Every term must appear: "belimo actuator" should not match a product
        // that is merely one of the two.
        if (!terms.every((t) => hay.includes(t))) return false;
      }
      if (category && p.category !== category) return false;
      if (brand && p.brand !== brand) return false;
      if (availability && p.availability !== availability) return false;
      if (typeof maxPrice === 'number' && !(typeof p.price === 'number' && p.price <= maxPrice)) return false;
      if (typeof minPrice === 'number' && !(typeof p.price === 'number' && p.price >= minPrice)) return false;
      return true;
    });

    const start = Math.max(0, Number(offset) || 0);
    const size = Math.min(MAX_LIMIT, Math.max(1, Number(limit) || DEFAULT_LIMIT));
    const page = matches.slice(start, start + size);

    return text({
      total: matches.length,
      returned: page.length,
      offset: start,
      // Say so explicitly. An agent that cannot tell a page from a complete
      // answer will confidently report "there are 10 products".
      truncated: start + page.length < matches.length,
      products: page.map(summarize)
    });
  }

  #get(id) {
    const raw = String(id ?? '').trim();
    if (!raw) return text({ error: 'id is required' }, true);
    if (raw.length > MAX_ID) {
      return text({ error: `id must be ${MAX_ID} characters or fewer`, received: raw.length }, true);
    }
    const needle = raw.toLowerCase();
    const found = this.#products.find((p) =>
      [p.sku, p.mpn, p.gtin].filter(Boolean).some((v) => String(v).toLowerCase() === needle));
    if (!found) {
      return text({ error: `no product matches "${id}"`, known: this.#products.length }, true);
    }
    const { raw: jsonld, ...rest } = found;
    return text({ ...rest, jsonld });
  }
}

/** MCP results are text; JSON is what an agent can actually act on. */
function text(value, isError = false) {
  return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }], ...(isError ? { isError: true } : {}) };
}

if (!customElements.get('machvive-webmcp-products')) {
  customElements.define('machvive-webmcp-products', MachviveWebmcpProducts);
}
