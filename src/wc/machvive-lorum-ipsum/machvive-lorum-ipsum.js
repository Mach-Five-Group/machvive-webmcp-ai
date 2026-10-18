import { THEME_CSS } from '../shared/theme.js';
import { loremIpsum, loremSentence, LANGUAGES } from './generator.js';
// Imported for its side effect as well as the constant: the polyfill installs on
// load, so a page gets `document.modelContext` whichever module it reaches for
// first. Analytics shipped without this import once and captured nothing,
// because the documented import order left it registering against no registry.
import { TOOL_CHANGE_EVENT } from '../machvive-webmcp-polyfill/machvive-webmcp-polyfill.js';

export { loremIpsum, loremSentence, LANGUAGES, WORD_BANKS } from './generator.js';
export { TOOL_CHANGE_EVENT };

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
/** The owner's registration. Aborting it is how the tool is withdrawn. */
let registration = null;

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
          /* Inherit, and paint nothing. Placeholder copy stands in for a page's
             own text, so it belongs in whatever a card, table cell or chat
             bubble already uses.
             This is not a style preference. Setting a themed colour here
             measured 1.21:1 in three of six OS-preference x theme combinations —
             light text on a light page — because the component followed the OS
             while its host did not. A page decides its own palette; a text
             element that follows prefers-color-scheme independently of its
             container is wrong exactly whenever the container disagrees. */
          color: inherit;
        }

        /* An explicit choice is different: the author asked for this block to
           carry a palette, so it must paint the surface that palette assumes.
           A component that themes its own text and leaves the background to
           chance is how analytics once rendered at 1.21:1. */
        :host([theme="dark"]),
        :host([theme="light"]) {
          color: var(--mv-fg);
          background: var(--mv-bg);
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
   * The spec removed `provideContext`, so a page can no longer wipe the toolset
   * wholesale — but a registration can still be withdrawn by whoever holds the
   * signal, and an element may need to take the name back. So the page asks,
   * explicitly, rather than this listening for `toolchange` and fighting
   * whoever withdrew it.
   */
  publishTool() {
    // Abort rather than just dropping the owner: the incumbent's controller is
    // the only handle on its registration, so overwriting it would leave the
    // name registered with nothing able to withdraw it ever again.
    if (owner !== this) {
      registration?.abort();
      registration = null;
      owner = null;
    }
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
    const context = globalThis.document?.modelContext;
    if (!context) return;

    // Liveness is read from our own registration rather than the registry.
    // `getTools()` is async and this path is not, and a native implementation
    // exposes no synchronous view — so the controller we hold is both the
    // cheapest and the only reliable answer.
    if (owner?.isConnected && registration && !registration.signal.aborted) return;

    // Reached only when the incumbent is gone or withdrawn, but abort it anyway:
    // the invariant is that nothing replaces a live registration without
    // aborting it, since the controller is the only way to take the name back.
    registration?.abort();
    owner = this;
    registration = new AbortController();
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
      annotations: { readOnlyHint: false },
      execute: async (params = {}) => {
        // Only forward what was actually supplied, so the element's own
        // attributes remain the defaults rather than being overwritten by
        // undefined on every call.
        for (const key of ['lang', 'sentences', 'paragraphs', 'seed']) {
          if (params[key] !== undefined && params[key] !== '') this[key] = params[key];
        }
        // The platform serializes whatever this resolves with; the old
        // `{content:[...]}` wrapper was our own invention and is now noise.
        return this.regenerate();
      }
    }, { signal: registration.signal }).catch((error) => {
      console.warn(`[machvive] could not register ${PLACEHOLDER_TOOL}:`, error.message);
      if (owner === this) { owner = null; registration = null; }
    });
  }

  #releaseTool() {
    if (owner !== this) return;
    registration?.abort();
    registration = null;
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
