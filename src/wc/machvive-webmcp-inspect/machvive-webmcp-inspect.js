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
  :host { display: block; font: 13px/1.5 system-ui, sans-serif; color: #1a1a1a; }
  :host([hidden]) { display: none; }

  /* Floating mode docks the panel without disturbing page layout. */
  :host([floating]) { position: fixed; right: 16px; bottom: 16px; z-index: 2147483000;
                      display: block; width: auto; }
  :host([floating]) .panel { display: none; width: min(420px, calc(100vw - 32px));
                             max-height: min(70vh, 560px); overflow: auto;
                             box-shadow: 0 8px 28px rgba(0,0,0,.18); background: #fff; }
  :host([floating][open]) .panel { display: block; }
  :host([floating]) .fab { display: inline-flex; }
  .fab { display: none; align-items: center; gap: 6px; margin-top: 8px; float: right;
         padding: 7px 13px; border-radius: 999px; border: 1px solid #ccc; background: #fff;
         cursor: pointer; font: inherit; box-shadow: 0 2px 8px rgba(0,0,0,.14); }

  .panel { border: 1px solid #e2e2e2; border-radius: 8px; overflow: hidden; }
  header { display: flex; align-items: center; gap: 8px; padding: 7px 10px;
           background: #fafafa; border-bottom: 1px solid #eee; font-weight: 600; }
  header .close { margin-left: auto; border: 0; background: none; cursor: pointer;
                  font-size: 16px; line-height: 1; color: #666; }
  :host(:not([floating])) header .close { display: none; }

  .body { display: flex; min-height: 150px; }
  @media (max-width: 520px) { .body { flex-direction: column; } }

  .tools { flex: 0 0 150px; border-right: 1px solid #eee; overflow-y: auto; }
  @media (max-width: 520px) { .tools { flex: none; border-right: 0; border-bottom: 1px solid #eee; } }
  .tools button { display: block; width: 100%; text-align: left; padding: 6px 10px;
                  border: 0; background: none; cursor: pointer; font: inherit;
                  font-family: ui-monospace, monospace; border-bottom: 1px solid #f4f4f4; }
  .tools button:hover { background: #f6f6f6; }
  .tools button[aria-current="true"] { background: #e8f0fe; font-weight: 600; }

  .form { flex: 1; padding: 10px; min-width: 0; }
  .desc { color: #666; margin: 0 0 8px; }
  label { display: block; margin-bottom: 7px; }
  .name { font-family: ui-monospace, monospace; font-size: 12px; }
  .req { color: #c5221f; }
  .hint { color: #888; font-size: 11px; }
  input, select, textarea { width: 100%; box-sizing: border-box; font: inherit; font-size: 12px;
                            padding: 4px 6px; border: 1px solid #ddd; border-radius: 4px; }
  input[type="checkbox"] { width: auto; }
  textarea { font-family: ui-monospace, monospace; }
  .run { margin-top: 4px; padding: 5px 14px; border: 1px solid #1a73e8; border-radius: 4px;
         background: #1a73e8; color: #fff; cursor: pointer; font: inherit; }
  .run:disabled { opacity: .6; cursor: default; }
  pre { margin: 8px 0 0; padding: 7px; background: #fafafa; border: 1px solid #eee;
        border-radius: 4px; font-size: 12px; white-space: pre-wrap; word-break: break-word;
        max-height: 180px; overflow: auto; }
  pre.error { background: #fce8e6; border-color: #f5c6c2; color: #c5221f; }
  .field-error { color: #c5221f; font-size: 11px; }
  .empty { padding: 20px; text-align: center; color: #888; }
`;

export class MachviveWebmcpInspect extends HTMLElement {
  #selected = null;
  #result = null;
  #onToolsChanged = () => this.#render();

  static get observedAttributes() {
    return ['floating', 'open'];
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
