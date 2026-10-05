import { THEME_CSS } from '../shared/theme.js';
import { loremIpsum, loremSentence, LANGUAGES } from './generator.js';

export { loremIpsum, loremSentence, LANGUAGES, WORD_BANKS } from './generator.js';

/**
 * Placeholder copy that generates itself.
 *
 * Slotted content always wins — the element has projected light DOM since its first
 * release and pages depend on that. What changed is the fallback: instead of one
 * frozen sentence it now generates, so a page full of these does not read as the same
 * line repeated down the screen.
 *
 * `lang="english"` is the one worth reaching for. Latin is the convention, but its
 * word lengths and letter frequencies are not English's, so a column that survives
 * Cicero can still break on business-speak — which is the register the real copy will
 * be written in.
 */
export class MachviveLorumIpsum extends HTMLElement {
  #text = '';

  static get observedAttributes() {
    return ['lang', 'sentences', 'paragraphs', 'seed', 'theme'];
  }

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
  }

  /** Forces a palette regardless of the OS preference. null follows the OS. */
  get theme() {
    return this.getAttribute('theme');
  }

  set theme(value) {
    if (value == null) this.removeAttribute('theme');
    else this.setAttribute('theme', value);
  }

  /** 'latin' (default) or 'english'. */
  get lang() {
    const value = this.getAttribute('lang');
    return LANGUAGES.includes(value) ? value : 'latin';
  }

  set lang(value) {
    this.setAttribute('lang', value);
  }

  /** Sentences per paragraph. -1 picks 1-5 at random. */
  get sentences() {
    const value = Number(this.getAttribute('sentences'));
    return Number.isFinite(value) && value !== 0 ? value : 5;
  }

  set sentences(value) {
    this.setAttribute('sentences', String(value));
  }

  get paragraphs() {
    const value = Number(this.getAttribute('paragraphs'));
    return Number.isFinite(value) && value > 0 ? value : 1;
  }

  set paragraphs(value) {
    this.setAttribute('paragraphs', String(value));
  }

  /** Omit for fresh copy each time; set for repeatable output. */
  get seed() {
    const value = Number(this.getAttribute('seed'));
    return this.hasAttribute('seed') && Number.isFinite(value) ? value : undefined;
  }

  set seed(value) {
    if (value == null) this.removeAttribute('seed');
    else this.setAttribute('seed', String(value));
  }

  /** The copy currently rendered as fallback. Empty until connected. */
  get text() {
    return this.#text;
  }

  connectedCallback() {
    this.shadowRoot.innerHTML = `
      <style>
${THEME_CSS}
        :host {
          display: block;
          font-family: system-ui, -apple-system, sans-serif;
          line-height: 1.6;
          /* No background on purpose. Placeholder copy stands in for a page's own
             text, so it has to sit on whatever surface hosts it — a card, a table
             cell, a chat bubble. That makes it the same deliberate exception the
             floating inspector is, and why it is outside the strict theme tests. */
          color: var(--mv-fg);
        }
        p { margin: 0 0 0.75em; }
        p:last-child { margin-bottom: 0; }
      </style>
      <slot></slot>
    `;
    this.#render();
  }

  attributeChangedCallback(name) {
    // `theme` is handled entirely by the CSS above. Re-rendering for it would
    // regenerate the copy, so toggling dark mode would silently rewrite the page.
    if (name === 'theme' || !this.shadowRoot?.childElementCount) return;
    this.#render();
  }

  /** Produces fresh copy. Call after changing a property, or to reroll a seed. */
  regenerate() {
    this.#render();
    return this.#text;
  }

  #render() {
    const slot = this.shadowRoot.querySelector('slot');
    if (!slot) return;

    this.#text = loremIpsum({
      sentences: this.sentences,
      paragraphs: this.paragraphs,
      lang: this.lang,
      seed: this.seed
    });

    // Fallback content, so anything slotted still takes precedence. textContent
    // rather than innerHTML: the attributes feeding this are author-controlled,
    // and markup has no business in placeholder copy regardless.
    slot.replaceChildren(...this.#text.split('\n\n').map((paragraph) => {
      const node = document.createElement('p');
      node.textContent = paragraph;
      return node;
    }));
  }
}

// Automatically register the component if it hasn't been already
if (!customElements.get('machvive-lorum-ipsum')) {
  customElements.define('machvive-lorum-ipsum', MachviveLorumIpsum);
}
