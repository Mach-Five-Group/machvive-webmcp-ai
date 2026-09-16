/**
 * Lists the tools registered with WebMCP, builds a form from each tool's
 * inputSchema, and executes it with the values entered.
 *
 * Renders inline by default; add the `floating` attribute to dock it as an
 * overlay panel, and `open` to start that panel expanded.
 *
 * Importing this also installs the polyfill, since discovery (`tools`) and
 * invocation (`callTool`) are additions the bare spec does not provide.
 */
import { TOOLS_CHANGED_EVENT } from '../machvive-webmcp-polyfill/machvive-webmcp-polyfill.js';
import { THEME_CSS } from '../shared/theme.js';

/** Reads a form control back as the JSON type its schema calls for. */
function readControl(input, schema = {}) {
  if (input.type === 'checkbox') return input.checked;
  const raw = input.value;
  if (raw === '' ) return undefined;
  if (schema.type === 'number' || schema.type === 'integer') {
    const n = Number(raw);
    if (Number.isNaN(n)) throw new TypeError(`"${raw}" is not a number`);
    return schema.type === 'integer' ? Math.trunc(n) : n;
  }
  if (schema.type === 'object' || schema.type === 'array') {
    try {
      return JSON.parse(raw);
    } catch {
      throw new TypeError(`must be valid JSON`);
    }
  }
  return raw;
}

const STYLES = `
  ${THEME_CSS}

  /* See analytics: a component that themes its own text must paint its own
     surface rather than assume the embedding page supplies a matching one. */
  :host { display: block; font: 13px/1.5 system-ui, sans-serif;
          color: var(--mv-fg); background: var(--mv-bg); }
  :host([hidden]) { display: none; }

  /* Floating mode docks the panel without disturbing page layout. */
  /* Floating mode is a detached panel: the .panel and .fab paint themselves, so
     the host must stay transparent or it draws a block over the page. */
  :host([floating]) { position: fixed; right: 16px; bottom: 16px; z-index: 2147483000;
                      display: block; width: auto; background: transparent; }
  :host([floating]) .panel { display: none; width: min(420px, calc(100vw - 32px));
                             max-height: min(70vh, 560px); overflow: auto;
                             box-shadow: 0 8px 28px var(--mv-shadow); background: var(--mv-bg); }
  :host([floating][open]) .panel { display: block; }
  :host([floating]) .fab { display: inline-flex; }
  .fab { display: none; align-items: center; gap: 6px; margin-top: 8px; float: right;
         padding: 7px 13px; border-radius: 999px; border: 1px solid var(--mv-control-border);
         background: var(--mv-bg); color: var(--mv-fg); cursor: pointer; font: inherit;
         box-shadow: 0 2px 8px var(--mv-shadow); }

  .panel { border: 1px solid var(--mv-border); border-radius: 8px; overflow: hidden;
           background: var(--mv-bg); }
  header { display: flex; align-items: center; gap: 8px; padding: 7px 10px;
           background: var(--mv-surface); color: var(--mv-fg);
           border-bottom: 1px solid var(--mv-border-soft); font-weight: 600; }
  header .close { margin-left: auto; border: 0; background: none; cursor: pointer;
                  font-size: 16px; line-height: 1; color: var(--mv-muted); }
  :host(:not([floating])) header .close { display: none; }

  .body { display: flex; min-height: 150px; }
  @media (max-width: 520px) { .body { flex-direction: column; } }

  .tools { flex: 0 1 auto; min-width: 120px; max-width: 200px;
           border-right: 1px solid var(--mv-border-soft); overflow-y: auto; }
  @media (max-width: 520px) { .tools { flex: none; max-width: none; border-right: 0;
                                       border-bottom: 1px solid var(--mv-border-soft); } }
  /* Tool names are arbitrary identifiers; long ones must wrap inside the column
     rather than spill over the divider. */
  .tools button { display: block; width: 100%; text-align: left; padding: 6px 10px;
                  border: 0; background: none; color: var(--mv-fg); cursor: pointer;
                  font: inherit; font-family: ui-monospace, monospace; font-size: 12px;
                  overflow-wrap: anywhere; border-bottom: 1px solid var(--mv-border-soft); }
  .tools button:hover { background: var(--mv-hover); }
  .tools button[aria-current="true"] { background: var(--mv-selected); font-weight: 600; }

  .form { flex: 1; padding: 10px; min-width: 0; }
  .desc { color: var(--mv-muted); margin: 0 0 8px; }
  label { display: block; margin-bottom: 7px; }
  .name { font-family: ui-monospace, monospace; font-size: 12px; }
  .req { color: var(--mv-err-fg); }
  .hint { color: var(--mv-faint); font-size: 11px; }
  /* color/background are required, not decorative: form controls do not inherit
     them, so without these the UA picks per-theme defaults and text can render
     white on white. */
  input, select, textarea { width: 100%; box-sizing: border-box; font: inherit; font-size: 12px;
                            color: var(--mv-fg); background: var(--mv-input-bg); padding: 4px 6px;
                            border: 1px solid var(--mv-control-border); border-radius: 4px; }
  input[type="checkbox"] { width: auto; }
  textarea { font-family: ui-monospace, monospace; }
  .run { margin-top: 4px; padding: 5px 14px; border: 1px solid var(--mv-accent);
         border-radius: 4px; background: var(--mv-accent); color: var(--mv-accent-fg);
         cursor: pointer; font: inherit; }
  .run:disabled { opacity: .6; cursor: default; }
  pre { margin: 8px 0 0; padding: 7px; color: var(--mv-fg); background: var(--mv-surface);
        border: 1px solid var(--mv-border-soft); border-radius: 4px; font-size: 12px;
        white-space: pre-wrap; word-break: break-word; max-height: 180px; overflow: auto; }
  pre.error { background: var(--mv-err-bg); border-color: var(--mv-err-border); color: var(--mv-err-fg); }
  .field-error { color: var(--mv-err-fg); font-size: 11px; }
  .empty { padding: 20px; text-align: center; color: var(--mv-faint); }
`;

export class MachviveWebmcpInspect extends HTMLElement {
  #selected = null;
  #result = null;
  #onToolsChanged = () => this.#render();

  static get observedAttributes() {
    return ['floating', 'open', 'theme'];
  }

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
  }

  connectedCallback() {
    this.shadowRoot.innerHTML = `<style>${STYLES}</style><div id="root"></div>`;
    globalThis.window.addEventListener(TOOLS_CHANGED_EVENT, this.#onToolsChanged);
    this.#render();
  }

  disconnectedCallback() {
    globalThis.window.removeEventListener(TOOLS_CHANGED_EVENT, this.#onToolsChanged);
  }

  attributeChangedCallback() {
    if (this.shadowRoot?.getElementById('root')) this.#render();
  }


  /** Forces a palette regardless of the OS preference. null follows the OS. */
  get theme() {
    return this.getAttribute('theme');
  }

  set theme(value) {
    if (value == null) this.removeAttribute('theme');
    else this.setAttribute('theme', value);
  }

  /** Opens the panel (floating mode only). */
  show() {
    this.setAttribute('open', '');
  }

  /** Closes the panel (floating mode only). */
  hide() {
    this.removeAttribute('open');
  }

  get #context() {
    return globalThis.navigator?.modelContext ?? null;
  }

  get #tools() {
    return this.#context?.tools ?? [];
  }

  #render() {
    const root = this.shadowRoot?.getElementById('root');
    if (!root) return;

    const mc = this.#context;
    // A native modelContext has no tools/callTool — those are our additions.
    const usable = Boolean(mc && Array.isArray(mc.tools) && typeof mc.callTool === 'function');
    const tools = usable ? this.#tools : [];
    if (this.#selected && !tools.some((t) => t.name === this.#selected)) this.#selected = null;
    this.#selected ??= tools[0]?.name ?? null;
    const tool = tools.find((t) => t.name === this.#selected) ?? null;

    root.innerHTML = `
      <div class="panel">
        <header>WebMCP Inspector<button class="close" title="Close">&times;</button></header>
        ${
          !usable
            ? `<div class="empty">navigator.modelContext is unavailable here.<br>
                 <span class="hint">Needs a secure context, and tool discovery requires the machvive polyfill.</span></div>`
            : tools.length === 0
              ? `<div class="empty">No tools registered.</div>`
              : `<div class="body">
                   <div class="tools">${tools
                     .map(
                       (t) =>
                         `<button data-tool="${escapeAttr(t.name)}" aria-current="${
                           t.name === this.#selected
                         }">${escapeHtml(t.name)}</button>`
                     )
                     .join('')}</div>
                   <div class="form">${this.#renderForm(tool)}</div>
                 </div>`
        }
      </div>
      <button class="fab" title="WebMCP Inspector">&#128295; WebMCP</button>
    `;
    this.#wire(root);
  }

  #renderForm(tool) {
    if (!tool) return '';
    const schema = tool.inputSchema ?? {};
    const props = schema.properties ?? {};
    const required = new Set(schema.required ?? []);
    const names = Object.keys(props);

    const fields = names.length
      ? names.map((name) => this.#renderField(name, props[name], required.has(name))).join('')
      : `<p class="hint">This tool takes no parameters.</p>`;

    return `
      ${tool.description ? `<p class="desc">${escapeHtml(tool.description)}</p>` : ''}
      <form>
        ${fields}
        <button type="submit" class="run">Execute</button>
      </form>
      ${
        this.#result
          ? `<pre class="${this.#result.isError ? 'error' : ''}">${escapeHtml(this.#result.text)}</pre>`
          : ''
      }
    `;
  }

  #renderField(name, schema = {}, isRequired) {
    const label = `<span class="name">${escapeHtml(name)}</span>${
      isRequired ? ' <span class="req" title="required">*</span>' : ''
    }${schema.description ? ` <span class="hint">— ${escapeHtml(schema.description)}</span>` : ''}`;

    let control;
    if (Array.isArray(schema.enum)) {
      control = `<select data-field="${escapeAttr(name)}">${
        isRequired ? '' : '<option value=""></option>'
      }${schema.enum
        .map((v) => `<option value="${escapeAttr(v)}">${escapeHtml(v)}</option>`)
        .join('')}</select>`;
    } else if (schema.type === 'boolean') {
      control = `<input type="checkbox" data-field="${escapeAttr(name)}">`;
    } else if (schema.type === 'object' || schema.type === 'array') {
      control = `<textarea rows="3" data-field="${escapeAttr(name)}" placeholder="JSON"></textarea>`;
    } else {
      const numeric = schema.type === 'number' || schema.type === 'integer';
      control = `<input type="${numeric ? 'number' : 'text'}"${
        schema.type === 'integer' ? ' step="1"' : ''
      } data-field="${escapeAttr(name)}">`;
    }

    return `<label>${label}${control}<span class="field-error" data-error="${escapeAttr(
      name
    )}"></span></label>`;
  }

  #wire(root) {
    root.querySelector('.fab')?.addEventListener('click', () =>
      this.hasAttribute('open') ? this.hide() : this.show()
    );
    root.querySelector('header .close')?.addEventListener('click', () => this.hide());

    root.querySelectorAll('[data-tool]').forEach((btn) =>
      btn.addEventListener('click', () => {
        this.#selected = btn.dataset.tool;
        this.#result = null;
        this.#render();
      })
    );

    root.querySelector('form')?.addEventListener('submit', (ev) => {
      ev.preventDefault();
      this.#execute(root);
    });
  }

  async #execute(root) {
    const tool = this.#tools.find((t) => t.name === this.#selected);
    if (!tool) return;
    const props = tool.inputSchema?.properties ?? {};
    const required = new Set(tool.inputSchema?.required ?? []);

    const params = {};
    let invalid = false;
    root.querySelectorAll('[data-error]').forEach((el) => (el.textContent = ''));

    for (const [name, schema] of Object.entries(props)) {
      const input = root.querySelector(`[data-field="${CSS.escape(name)}"]`);
      if (!input) continue;
      const errorEl = root.querySelector(`[data-error="${CSS.escape(name)}"]`);
      try {
        const value = readControl(input, schema);
        if (value === undefined) {
          if (required.has(name)) {
            if (errorEl) errorEl.textContent = 'required';
            invalid = true;
          }
          continue;
        }
        params[name] = value;
      } catch (err) {
        if (errorEl) errorEl.textContent = String(err.message ?? err);
        invalid = true;
      }
    }
    if (invalid) return;

    const button = root.querySelector('.run');
    if (button) button.disabled = true;
    try {
      const result = await this.#context.callTool(tool.name, params);
      const text = (result?.content ?? [])
        .map((block) => block?.text ?? JSON.stringify(block))
        .join('\n');
      this.#result = { text: text || JSON.stringify(result, null, 2), isError: Boolean(result?.isError) };
    } catch (err) {
      // callTool is documented never to reject, but a native impl might.
      this.#result = { text: String(err?.message ?? err), isError: true };
    } finally {
      if (button) button.disabled = false;
    }
    this.#render();
  }
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
}
const escapeAttr = escapeHtml;

if (!customElements.get('machvive-webmcp-inspect')) {
  customElements.define('machvive-webmcp-inspect', MachviveWebmcpInspect);
}
