import type { NormalizedProduct, ProductFacets } from './jsonld.js';

export * from './jsonld.js';
export { TOOLS_CHANGED_EVENT } from '../machvive-webmcp-polyfill/machvive-webmcp-polyfill.js';

export declare const PRODUCT_TOOLS: Readonly<{
  SEARCH: 'search_products';
  GET: 'get_product';
  FACETS: 'list_product_facets';
}>;

/**
 * Publishes a page's product JSON-LD to agents as three read-only WebMCP tools.
 */
export declare class MachviveWebmcpProducts extends HTMLElement {
  theme: 'light' | 'dark' | null;
  /** Optional JSON-LD URL. Omit to read the JSON-LD already on the page. */
  src: string | null;
  readonly products: NormalizedProduct[];
  readonly facets: ProductFacets;
  /** Re-reads the source and republishes the tools. */
  load(): Promise<NormalizedProduct[]>;
}

declare global {
  interface HTMLElementTagNameMap {
    'machvive-webmcp-products': MachviveWebmcpProducts;
  }
}
