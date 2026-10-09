/** A schema.org Product flattened into something a tool schema can describe. */
export interface NormalizedProduct {
  name: string;
  description?: string;
  sku?: string;
  mpn?: string;
  /** Any gtin flavour, normalised to one field. */
  gtin?: string;
  brand?: string;
  category?: string;
  url?: string;
  image?: string;
  /** null when the markup carries no usable price. */
  price: number | null;
  currency?: string;
  /** Bare token, e.g. `InStock` — not the schema.org URL. */
  availability?: string;
  condition?: string;
  seller?: string;
  /** Present when the source was an AggregateOffer. */
  priceRange?: { low: number | null; high: number | null; count: number | null };
  rating?: number | null;
  reviewCount?: number | null;
  /** The untouched JSON-LD node. */
  raw: Record<string, unknown>;
}

export interface ProductFacets {
  categories: string[];
  brands: string[];
  availability: string[];
  currencies: string[];
  count: number;
  priceRange?: { low: number; high: number };
}

/** Walks any JSON-LD and collects every Product in it, deduplicated. */
export declare function collectProducts(input: unknown): NormalizedProduct[];
export declare function normalizeProduct(node: Record<string, unknown>): NormalizedProduct;
/** Parses every `<script type="application/ld+json">`; malformed blocks are skipped. */
export declare function readDocumentJsonLd(doc?: Document): unknown[];
export declare function facetsOf(products: NormalizedProduct[]): ProductFacets;
