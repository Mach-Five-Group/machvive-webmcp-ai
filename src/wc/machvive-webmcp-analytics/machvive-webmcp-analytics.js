/**
 * Captures every WebMCP tool invocation — request, response, timing, errors —
 * and exposes them for listing, editing, export, replay, and dataLayer push.
 *
 * Instrumentation wraps each tool's `execute` handler at registration time rather
 * than hooking the polyfill's `callTool`. That captures invocations from any
 * caller, including a native `navigator.modelContext` and real agents, neither of
 * which route through our code.
 */

// Importing the polyfill guarantees navigator.modelContext exists before
// installAnalytics() runs. Without this, importing analytics first — which is
// exactly what capturing every call requires — finds no registry to instrument
// and silently captures nothing.
import '../machvive-webmcp-polyfill/machvive-webmcp-polyfill.js';

export const CALL_EVENT = 'machvive-webmcp-call';
export const DB_NAME = 'machvive-webmcp';
export const STORE_NAME = 'calls';

const DB_VERSION = 1;
const DEFAULT_LIMIT = 500;

/**
 * Minimal IndexedDB wrapper. Every method resolves to a harmless value when
 * IndexedDB is unavailable (jsdom, private mode, disabled storage) so capture
 * degrades to memory-only rather than breaking the page.
 */
class IdbStore {
  #dbPromise = null;

  get available() {
    return Boolean(globalThis.indexedDB);
  }

  #db() {
    if (!this.available) return Promise.resolve(null);
    this.#dbPromise ??= new Promise((resolve) => {
      let request;
      try {
        request = globalThis.indexedDB.open(DB_NAME, DB_VERSION);
      } catch {
        return resolve(null);
      }
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
      request.onblocked = () => resolve(null);
    });
    return this.#dbPromise;
  }

  async #tx(mode, run) {
    const db = await this.#db();
    if (!db) return null;
    return new Promise((resolve) => {
      let tx;
      try {
        tx = db.transaction(STORE_NAME, mode);
      } catch {
        return resolve(null);
      }
      const request = run(tx.objectStore(STORE_NAME));
      tx.oncomplete = () => resolve(request ? request.result : null);
      tx.onerror = () => resolve(null);
      tx.onabort = () => resolve(null);
    });
  }

  all() {
    return this.#tx('readonly', (store) => store.getAll()).then((r) => r ?? []);
  }

  put(entry) {
    return this.#tx('readwrite', (store) => store.put(entry));
  }

  delete(id) {
    return this.#tx('readwrite', (store) => store.delete(id));
  }

  clear() {
    return this.#tx('readwrite', (store) => store.clear());
  }
}

let nextId = 0;
const newId = () => `call-${Date.now().toString(36)}-${(nextId++).toString(36)}`;

/** Deep-copies through JSON so a later mutation of caller state can't rewrite history. */
function snapshot(value) {
  if (value === undefined) return undefined;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return String(value);
  }
}

/**
 * The captured call log. A single instance is shared by every
 * <machvive-webmcp-analytics> element on the page.
 */
export class CallLog {
  #listeners = new Set();
  #entries = [];
  #limit;
  #persist;
  #store = new IdbStore();

  /** Resolves once persisted entries have been loaded. Await before first read. */
  ready;

  constructor({ limit = DEFAULT_LIMIT, persist = true } = {}) {
    this.#limit = limit;
    this.#persist = persist;
    this.ready = this.#restore();
  }

  /** True when entries are being written to IndexedDB. */
  get persistent() {
    return this.#persist && this.#store.available;
  }

  /** EventTarget-shaped for familiarity; only the 'change' type is emitted. */
  addEventListener(type, listener) {
    if (type === 'change' && typeof listener === 'function') this.#listeners.add(listener);
  }

  removeEventListener(type, listener) {
    if (type === 'change') this.#listeners.delete(listener);
  }

  get entries() {
    return [...this.#entries];
  }

  get size() {
    return this.#entries.length;
  }

  add(entry) {
    const record = { id: newId(), ...entry };
    this.#entries.push(record);
    // Oldest-first trim keeps the most recent calls, which are what anyone debugging wants.
    let evicted = [];
    if (this.#entries.length > this.#limit) {
      evicted = this.#entries.splice(0, this.#entries.length - this.#limit);
    }
    this.#write((store) => {
      store.put(record);
      for (const gone of evicted) store.delete(gone.id);
    });
    this.#changed('add', record);
    return record;
  }

  update(id, patch) {
    const entry = this.#entries.find((e) => e.id === id);
    if (!entry) return null;
    Object.assign(entry, patch);
    this.#write((store) => store.put(entry));
    this.#changed('update', entry);
    return entry;
  }

  remove(id) {
    const index = this.#entries.findIndex((e) => e.id === id);
    if (index === -1) return false;
    const [removed] = this.#entries.splice(index, 1);
    this.#write((store) => store.delete(removed.id));
    this.#changed('remove', removed);
    return true;
  }

  clear() {
    this.#entries = [];
    this.#write((store) => store.clear());
    this.#changed('clear', null);
  }

  /** Serialized log, suitable for a file or a clipboard. */
  toJSON(space = 2) {
    return JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), entries: this.#entries }, null, space);
  }

  /** Merges a previously exported log. Returns how many entries were added. */
  import(json) {
    const parsed = typeof json === 'string' ? JSON.parse(json) : json;
    const incoming = Array.isArray(parsed) ? parsed : parsed?.entries;
    if (!Array.isArray(incoming)) throw new TypeError('Analytics: import expects an entries array');
    for (const entry of incoming) {
      const record = { ...entry, id: entry.id ?? newId() };
      this.#entries.push(record);
      this.#write((store) => store.put(record));
    }
    this.#changed('import', null);
    return incoming.length;
  }

  /**
   * Re-invokes a captured call. Passing `params` runs it with edited input
   * instead of what was originally recorded.
   */
  async replay(id, params) {
    const entry = this.#entries.find((e) => e.id === id);
    if (!entry) throw new Error(`Analytics: no captured call ${id}`);
    const mc = globalThis.navigator?.modelContext;
    if (!mc?.callTool) throw new Error('Analytics: navigator.modelContext.callTool is unavailable');
    return mc.callTool(entry.tool, params ?? entry.params ?? {});
  }

  /** Pushes one entry to window.dataLayer in a GTM-friendly flat shape. */
  pushToDataLayer(id) {
    const entry = this.#entries.find((e) => e.id === id);
    if (!entry) return false;
    const layer = (globalThis.window.dataLayer ||= []);
    layer.push({
      event: 'webmcp_tool_call',
      webmcp_tool: entry.tool,
      webmcp_status: entry.status,
      webmcp_duration_ms: entry.durationMs,
      webmcp_params: entry.params,
      webmcp_error: entry.error ?? undefined
    });
    this.update(id, { pushedToDataLayer: true });
    return true;
  }

  #changed(reason, entry) {
    const detail = { reason, entry, entries: this.entries };
    for (const listener of this.#listeners) {
      try {
        listener({ type: 'change', detail });
      } catch {
        // One broken subscriber must not stop the others, nor reach the tool call.
      }
    }
    // Also on window so page code can observe without holding a CallLog reference.
    try {
      globalThis.window?.dispatchEvent?.(new CustomEvent(CALL_EVENT, { detail: { reason, entry } }));
    } catch {
      // No window, or a CustomEvent from a foreign realm.
    }
  }

  /** Fire-and-forget write. Persistence failing must never break capture. */
  #write(run) {
    if (!this.persistent) return;
    this.#runBatch(run).catch(() => {});
  }

  async #runBatch(run) {
    // IdbStore exposes one operation per transaction; a batch callback needs a
    // tiny shim so callers can express several writes in one place.
    const ops = [];
    run({
      put: (entry) => ops.push(['put', entry]),
      delete: (id) => ops.push(['delete', id]),
      clear: () => ops.push(['clear'])
    });
    for (const [op, arg] of ops) {
      await this.#store[op](arg);
    }
  }

  async #restore() {
    if (!this.persistent) return;
    try {
      const stored = await this.#store.all();
      if (!Array.isArray(stored) || stored.length === 0) return;
      // Persisted rows win only where memory has nothing — a call captured during
      // startup must not be clobbered by the restore that was already in flight.
      const seen = new Set(this.#entries.map((e) => e.id));
      const merged = [...stored.filter((e) => !seen.has(e.id)), ...this.#entries];
      this.#entries = merged.slice(-this.#limit);
      this.#changed('restore', null);
    } catch {
      // Corrupt or unreadable storage must never stop the page from loading.
    }
  }
}

export const callLog = new CallLog();

/** Wraps a descriptor's handler so every invocation is recorded. */
function instrumentTool(tool, log) {
  // Leave invalid descriptors alone so the polyfill's own validation still throws.
  if (!tool || typeof tool !== 'object' || typeof tool.execute !== 'function') return tool;
  if (tool.execute.__machviveWrapped) return tool;

  const original = tool.execute;
  const wrapped = async function (params, agent) {
    const startedAt = new Date().toISOString();
    const t0 = Date.now();
    const record = (fields) => {
      try {
        log.add(fields);
      } catch {
        // Capture is best-effort; never let it change the tool's outcome.
      }
    };

    try {
      const result = await original.call(this, params, agent);
      record({
        tool: tool.name,
        params: snapshot(params),
        result: snapshot(result),
        status: 'ok',
        startedAt,
        durationMs: Date.now() - t0
      });
      return result;
    } catch (err) {
      record({
        tool: tool.name,
        params: snapshot(params),
        error: String(err?.message ?? err),
        status: 'error',
        startedAt,
        durationMs: Date.now() - t0
      });
      throw err;
    }
  };
  wrapped.__machviveWrapped = true;
  return { ...tool, execute: wrapped };
}

let installed = false;

/**
 * Instruments `navigator.modelContext` so future registrations are captured.
 *
 * Tools registered *before* this runs cannot be instrumented — the polyfill hides
 * handlers from `tools` by design — so import this module before registering.
 *
 * @returns {boolean} true if this call instrumented the registry.
 */
export function installAnalytics(log = callLog) {
  const mc = globalThis.navigator?.modelContext;
  if (!mc || installed) return false;

  if (mc.tools?.length) {
    console.warn(
      `WebMCP analytics: ${mc.tools.length} tool(s) were registered before analytics loaded ` +
        'and will not be captured. Import the analytics module earlier.'
    );
  }

  const register = mc.registerTool.bind(mc);
  mc.registerTool = (tool) => register(instrumentTool(tool, log));

  if (typeof mc.provideContext === 'function') {
    const provide = mc.provideContext.bind(mc);
    mc.provideContext = (config = {}) =>
      provide({ ...config, tools: (config.tools ?? []).map((t) => instrumentTool(t, log)) });
  }

  installed = true;
  return true;
}

const STYLES = `
  /* This widget paints a light palette explicitly. Declaring the scheme keeps
     UA-rendered parts (controls, scrollbars) light too, instead of the browser
     handing form controls dark-mode defaults that vanish on these backgrounds. */
  :host { display: block; font: 13px/1.5 system-ui, sans-serif; color: #1a1a1a;
          color-scheme: light; }
  :host([hidden]) { display: none; }
  .bar { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; margin-bottom: 8px; }
  .count { font-weight: 600; margin-right: auto; }
  /* color is required, not decorative: form controls do not inherit it, so
     without this the UA picks one per theme and white-on-white can result. */
  button { font: inherit; color: #1a1a1a; padding: 3px 9px; border: 1px solid #ccc;
           border-radius: 4px; background: #fff; cursor: pointer; }
  button:hover { background: #f2f2f2; }
  button.danger { color: #a01; border-color: #d8a0a0; }
  ol { list-style: none; margin: 0; padding: 0; border: 1px solid #e2e2e2; border-radius: 6px;
       max-height: 380px; overflow-y: auto; }
  li { border-bottom: 1px solid #eee; }
  li:last-child { border-bottom: 0; }
  .row { display: flex; gap: 8px; align-items: center; padding: 6px 10px; cursor: pointer; }
  .row:hover { background: #fafafa; }
  .tool { font-family: ui-monospace, monospace; font-weight: 600; }
  .status { font-size: 11px; padding: 1px 6px; border-radius: 10px; }
  .status.ok { background: #e6f4ea; color: #137333; }
  .status.error { background: #fce8e6; color: #c5221f; }
  .ms { color: #777; font-size: 11px; margin-left: auto; }
  .detail { padding: 8px 10px; background: #fbfbfb; border-top: 1px solid #eee; }
  .detail label { display: block; font-size: 11px; color: #666; margin: 6px 0 2px; }
  textarea { width: 100%; box-sizing: border-box; font-family: ui-monospace, monospace;
             font-size: 12px; color: #1a1a1a; background: #fff; border: 1px solid #ddd;
             border-radius: 4px; padding: 5px; }
  pre { margin: 0; padding: 6px; color: #1a1a1a; background: #fff; border: 1px solid #eee; border-radius: 4px;
        font-size: 12px; overflow-x: auto; white-space: pre-wrap; word-break: break-word; }
  .empty { padding: 20px; text-align: center; color: #888; }
  .err { color: #c5221f; }
`;

export class MachviveWebmcpAnalytics extends HTMLElement {
  #log = callLog;
  #expanded = null;
  #onChange = () => this.#render();

  static get observedAttributes() {
    return ['datalayer'];
  }

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
  }

  connectedCallback() {
    this.shadowRoot.innerHTML = `<style>${STYLES}</style><div id="root"></div>`;
    this.#log.addEventListener('change', this.#onChange);
    // Auto-push only when explicitly opted in, so importing this never emits GTM traffic.
    globalThis.window.addEventListener(CALL_EVENT, this.#maybeAutoPush);
    this.#render();
    // Restore is async; repaint once persisted calls have loaded.
    this.#log.ready?.then(() => this.isConnected && this.#render());
  }

  disconnectedCallback() {
    this.#log.removeEventListener('change', this.#onChange);
    globalThis.window.removeEventListener(CALL_EVENT, this.#maybeAutoPush);
  }

  /** The shared call log, for page code that wants direct access. */
  get log() {
    return this.#log;
  }

  #maybeAutoPush = (e) => {
    if (!this.hasAttribute('datalayer')) return;
    if (e.detail?.reason !== 'add' || !e.detail.entry) return;
    this.#log.pushToDataLayer(e.detail.entry.id);
  };

  #render() {
    const root = this.shadowRoot?.getElementById('root');
    if (!root) return;
    const entries = this.#log.entries.slice().reverse();

    root.innerHTML = `
      <div class="bar">
        <span class="count">${entries.length} call${entries.length === 1 ? '' : 's'}</span>
        <button data-act="export">Export</button>
        <button data-act="copy">Copy JSON</button>
        <button data-act="clear" class="danger">Clear</button>
      </div>
      ${
        entries.length === 0
          ? `<div class="empty">No WebMCP calls captured yet.</div>`
          : `<ol>${entries.map((e) => this.#renderEntry(e)).join('')}</ol>`
      }
    `;
    root.querySelector('.bar').addEventListener('click', (ev) => this.#onBarClick(ev));
    root.querySelectorAll('li').forEach((li) => this.#wireEntry(li));
  }

  #renderEntry(entry) {
    const open = this.#expanded === entry.id;
    return `
      <li data-id="${entry.id}">
        <div class="row">
          <span class="tool">${escapeHtml(entry.tool ?? '(unknown)')}</span>
          <span class="status ${entry.status}">${entry.status}</span>
          <span class="ms">${entry.durationMs ?? 0}ms</span>
        </div>
        ${
          open
            ? `<div class="detail">
                 <label>Params (editable — used on replay)</label>
                 <textarea rows="3" data-role="params">${escapeHtml(
                   JSON.stringify(entry.params ?? {}, null, 2)
                 )}</textarea>
                 <label>${entry.status === 'error' ? 'Error' : 'Result'}</label>
                 <pre class="${entry.status === 'error' ? 'err' : ''}">${escapeHtml(
                   entry.status === 'error' ? entry.error ?? '' : JSON.stringify(entry.result ?? null, null, 2)
                 )}</pre>
                 <div class="bar" style="margin-top:8px">
                   <button data-act="save">Save params</button>
                   <button data-act="replay">Replay</button>
                   <button data-act="push">Push to dataLayer</button>
                   <button data-act="remove" class="danger">Delete</button>
                 </div>
               </div>`
            : ''
        }
      </li>
    `;
  }

  #wireEntry(li) {
    const id = li.dataset.id;
    li.querySelector('.row').addEventListener('click', () => {
      this.#expanded = this.#expanded === id ? null : id;
      this.#render();
    });
    li.querySelectorAll('button[data-act]').forEach((btn) => {
      btn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        this.#onEntryAction(btn.dataset.act, id, li);
      });
    });
  }

  async #onEntryAction(action, id, li) {
    const readParams = () => {
      const raw = li.querySelector('[data-role="params"]')?.value ?? '{}';
      try {
        return JSON.parse(raw);
      } catch {
        globalThis.window.alert('Params must be valid JSON.');
        return null;
      }
    };

    if (action === 'save') {
      const params = readParams();
      if (params) this.#log.update(id, { params });
    } else if (action === 'replay') {
      const params = readParams();
      if (params) await this.#log.replay(id, params);
    } else if (action === 'push') {
      this.#log.pushToDataLayer(id);
    } else if (action === 'remove') {
      if (this.#expanded === id) this.#expanded = null;
      this.#log.remove(id);
    }
  }

  #onBarClick(ev) {
    const act = ev.target.dataset?.act;
    if (act === 'clear') {
      this.#expanded = null;
      this.#log.clear();
    } else if (act === 'copy') {
      globalThis.navigator.clipboard?.writeText(this.#log.toJSON());
    } else if (act === 'export') {
      this.#download();
    }
  }

  #download() {
    const blob = new Blob([this.#log.toJSON()], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `webmcp-analytics-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
}

installAnalytics();

if (!customElements.get('machvive-webmcp-analytics')) {
  customElements.define('machvive-webmcp-analytics', MachviveWebmcpAnalytics);
}
