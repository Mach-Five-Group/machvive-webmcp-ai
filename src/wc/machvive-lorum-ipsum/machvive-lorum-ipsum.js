import { THEME_CSS } from '../shared/theme.js';
import { loremIpsum, loremSentence, LANGUAGES } from './generator.js';
// Imported for its side effect as well as the constant: the polyfill installs on
// load, so a page gets `navigator.modelContext` whichever module it reaches for
// first. Analytics shipped without this import once and captured nothing,
// because the documented import order left it registering against no registry.
import { TOOLS_CHANGED_EVENT } from '../machvive-webmcp-polyfill/machvive-webmcp-polyfill.js';

export { loremIpsum, loremSentence, LANGUAGES, WORD_BANKS } from './generator.js';
export { TOOLS_CHANGED_EVENT };

/** The tool this element publishes. One per page, whatever the element count. */
export const PLACEHOLDER_TOOL = 'generate_placeholder_text';

/**
 * Which element currently owns the tool.
 *
 * Module-scoped rather than per instance, because tool names are a page-wide
 * namespace: three placeholder blocks must not race to register three tools
 * under one name, each silently replacing the last.
 */
let owner = null;

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
    return ['lang', 'sentences', 'paragraphs', 'seed', 'theme', 'no-tool'];
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
    this.#claimTool();
  }

  disconnectedCallback() {
    this.#releaseTool();
  }

  attributeChangedCallback(name) {
    if (!this.shadowRoot?.childElementCount) return;
    // `theme` is handled entirely by the CSS above. Re-rendering for it would
    // regenerate the copy, so toggling dark mode would silently rewrite the page.
    if (name === 'theme') return;
    // Likewise `no-tool`: it changes what is published, not what is displayed.
    if (name === 'no-tool') {
      if (this.hasAttribute('no-tool')) this.#releaseTool();
      else this.#claimTool();
      return;
    }
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

  /**
   * Publishes the generator as a WebMCP tool.
   *
   * It is here so a page that installs the polyfill has something real for an
   * agent — or the inspector — to call on day one, without the author first
   * writing a tool of their own. It is a deliberately safe one to hand out:
   * pure text generation, no network, no storage, no state beyond this element.
   */
  /**
   * Publishes the tool, taking ownership from another block if it has it.
   *
   * Needed because `provideContext` *replaces* the whole toolset by design, so
   * any page that calls it silently drops tools published by elements. There is
   * no listening for that: re-registering automatically would fight a page that
   * curated its toolset on purpose, and could ping-pong against the change event
   * it would itself cause. So the page asks, explicitly.
   */
  publishTool() {
    owner = null;
    this.#claimTool();
    return this;
  }

  /** Withdraws it. Equivalent to setting `no-tool`, without the attribute. */
  withdrawTool() {
    this.#releaseTool();
    return this;
  }

  #claimTool() {
    if (this.hasAttribute('no-tool')) return;
    const context = globalThis.navigator?.modelContext;
    if (!context) return;

    // Ownership alone is not enough to skip: after provideContext the owner
    // still points here while the registry no longer holds the tool, and a
    // bare `if (owner) return` would leave the page advertising nothing.
    const live = context.tools?.some((tool) => tool.name === PLACEHOLDER_TOOL);
    if (owner && live) return;

    owner = this;
    context.registerTool({
      name: PLACEHOLDER_TOOL,
      description:
        'Generate placeholder copy and show it on the page. Latin reads as classic ' +
        'lorem ipsum; English is business-speak, which is better for judging whether ' +
        'a layout survives the text it will really hold.',
      inputSchema: {
        type: 'object',
        properties: {
          lang: { type: 'string', enum: [...LANGUAGES], description: 'Vocabulary to draw from' },
          sentences: { type: 'integer', description: 'Sentences per paragraph. -1 picks 1-5 at random' },
          paragraphs: { type: 'integer', description: 'How many paragraphs' },
          seed: { type: 'integer', description: 'Omit for fresh copy; set for repeatable output' }
        }
      },
      execute: async (params = {}) => {
        // Only forward what was actually supplied, so the element's own
        // attributes remain the defaults rather than being overwritten by
        // undefined on every call.
        for (const key of ['lang', 'sentences', 'paragraphs', 'seed']) {
          if (params[key] !== undefined && params[key] !== '') this[key] = params[key];
        }
        const text = this.regenerate();
        return { content: [{ type: 'text', text }] };
      }
    });
  }

  #releaseTool() {
    if (owner !== this) return;
    globalThis.navigator?.modelContext?.unregisterTool(PLACEHOLDER_TOOL);
    owner = null;

    // Hand the tool to another placeholder still on the page, so removing one
    // block does not quietly take the page's only tool with it.
    for (const candidate of globalThis.document?.querySelectorAll?.('machvive-lorum-ipsum') ?? []) {
      if (candidate !== this && candidate.isConnected && candidate instanceof MachviveLorumIpsum) {
        candidate.#claimTool();
        break;
      }
    }
  }
}

// Automatically register the component if it hasn't been already
if (!customElements.get('machvive-lorum-ipsum')) {
  customElements.define('machvive-lorum-ipsum', MachviveLorumIpsum);
}
