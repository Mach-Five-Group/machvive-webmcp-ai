import type { LoremLanguage } from './generator.js';

export { loremIpsum, loremSentence, LANGUAGES, WORD_BANKS } from './generator.js';
export type { LoremLanguage, LoremOptions } from './generator.js';

/**
 * Placeholder copy that generates itself. Slotted light DOM always wins; the
 * generated copy is the fallback.
 */
export declare class MachviveLorumIpsum extends HTMLElement {
  /** Forces a palette regardless of the OS preference. null follows the OS. */
  theme: 'light' | 'dark' | null;
  /** 'latin' (default) or 'english'. An unknown value falls back to Latin. */
  lang: LoremLanguage;
  /** Sentences per paragraph. -1 picks 1-5 at random. */
  sentences: number;
  paragraphs: number;
  /** Omit for fresh copy; set for repeatable output. */
  seed: number | undefined;
  /** The copy currently rendered as fallback. Empty until connected. */
  readonly text: string;
  /** Produces fresh copy and returns it. A seeded element rerolls identically. */
  regenerate(): string;
}

declare global {
  interface HTMLElementTagNameMap {
    'machvive-lorum-ipsum': MachviveLorumIpsum;
  }
}
