export type LoremLanguage = 'latin' | 'english';

export interface LoremOptions {
  /** Sentences per paragraph. -1 picks 1-5 at random. Default 5. */
  sentences?: number;
  /** Paragraphs, joined by a blank line. Default 1. */
  paragraphs?: number;
  /** Default 'latin'. */
  lang?: LoremLanguage;
  /** Fewest words in a sentence. Default 5. */
  minWords?: number;
  /** Most words in a sentence. Default 14. */
  maxWords?: number;
  /** Omit for fresh copy each call; supply for repeatable output. */
  seed?: number;
  /** Start Latin with "Lorem ipsum dolor sit amet". Defaults true for Latin. */
  classicOpening?: boolean;
}

export declare const LANGUAGES: readonly LoremLanguage[];
export declare const WORD_BANKS: Readonly<Record<LoremLanguage, readonly string[]>>;

export declare function loremIpsum(options?: LoremOptions): string;
/** One sentence. Convenient for titles, labels and chat one-liners. */
export declare function loremSentence(options?: LoremOptions): string;
