/**
 * Bridges a MachFive Magnet to WebMCP, so an agent can use the lead-capture
 * widget the way a visitor would.
 *
 * The tools are derived from the magnet's own configuration rather than
 * hardcoded. A magnet is already a declarative description of what it collects —
 * `mag_macro_steps` names each field, its type, and its options — so configuring
 * a magnet is what makes it agent-callable. Add a booking step in the admin and
 * `magnet_*` gains scheduling with no code change here.
 *
 * Consent is the load-bearing design decision. An agent must not post a person's
 * email on their behalf, so the default path prefills the widget and opens it for
 * the visitor to review and submit. The magnet's own `open({prefill})` API is
 * built for exactly that.
 */
import { TOOLS_CHANGED_EVENT } from '../machvive-webmcp-polyfill/machvive-webmcp-polyfill.js';

const DEFAULT_SRC = 'https://machfivemagnet-saas.onrender.com/m5t/v5/coreSnippet';

/**
 * Step types an agent can meaningfully pre-answer, mapped to JSON Schema.
 *
 * Deliberately an allowlist. A magnet is highly configurable and this runtime
 * already ships step types beyond these — `booking` renders a live calendar
 * whose slots change by the minute, so a pre-filled value would be stale or
 * invalid by the time the visitor saw it. Anything not listed here is described
 * to the agent but left for the visitor to complete, which is the honest
 * default for a type we do not understand.
 */
const PREFILLABLE = {
  text: 'string',
  email: 'string',
  phone: 'string',
  number: 'number',
  single_select: 'string',
  multi_select: 'array'
};

/** Steps the visitor must complete in the widget itself. */
const isPrefillable = (step) => Object.hasOwn(PREFILLABLE, step.step_type);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Waits for the magnet runtime to attach itself. */
async function waitForMagnet(timeout = 15000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const api = globalThis.window?.MachFiveMagnet;
    const config = globalThis.window?.machfivemagnet;
    if (api && Array.isArray(api.instances) && api.instances.length && config?.magnets?.length) {
      return { api, config };
    }
    await sleep(150);
  }
  return null;
}

/**
 * How this magnet can schedule, if it can.
 *
 * Scheduling is declared in `mag_actions`, not as a macro step — a magnet can
 * offer a `book` action that hands off to an external calendar (Microsoft
 * Bookings, say) while its conversational steps collect something else
 * entirely. Reading only the steps reports "cannot schedule" on a magnet whose
 * whole purpose is booking.
 */
function bookingAction(magnet) {
  const action = (magnet.mag_actions ?? []).find((a) => a?.type === 'book');
  if (!action) return null;
  return {
    url: action.value ?? null,
    label: action.label || null,
    eventName: action.config?.event_name ?? null,
    source: action.config?.source ?? null
  };
}

/** The steps that actually collect something; `message` steps are terminal copy. */
function collectingSteps(magnet) {
  return (magnet.mag_macro_steps ?? []).filter(
    (s) => s.step_type !== 'message' && (s.step_columns ?? []).length
  );
}

/** Builds a JSON Schema for the fields this magnet collects. */
function prefillSchema(magnet) {
  const properties = {};
  for (const step of collectingSteps(magnet).filter(isPrefillable)) {
    const field = step.step_columns[0];
    const prop = {
      type: PREFILLABLE[step.step_type],
      description: step.step_prompts?.[0] ?? field
    };
    const options = (step.step_options ?? []).map((o) => o.label).filter(Boolean);
    if (options.length) prop.enum = options;
    if (step.step_type === 'email') prop.format = 'email';
    properties[field] = prop;
  }
  return { type: 'object', properties };
}

export class MachviveM5tMagnet extends HTMLElement {
  #api = null;
  #magnet = null;
  #instance = null;
  #captures = [];
  #registered = [];

  static get observedAttributes() {
    return ['app-guid', 'src', 'magnet-id'];
  }

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
  }

  async connectedCallback() {
    // Headless by default: the magnet renders its own launcher, and a second
    // visible surface would just compete with it.
    this.shadowRoot.innerHTML = '<style>:host { display: none; }</style>';
    await this.#boot();
  }

  disconnectedCallback() {
    for (const name of this.#registered) globalThis.navigator?.modelContext?.unregisterTool(name);
    this.#registered = [];
  }

  /** The magnet's own config, for page code that wants it. */
  get config() {
    return this.#magnet;
  }

  /** Captures observed this session. */
  get captures() {
    return [...this.#captures];
  }

  async #boot() {
    this.#injectSnippet();

    const found = await waitForMagnet();
    if (!found) {
      console.warn('machvive-m5t-magnet: the magnet runtime did not load; no tools registered.');
      this.dispatchEvent(new CustomEvent('magnet-error', { detail: { reason: 'runtime-unavailable' } }));
      return;
    }

    this.#api = found.api;
    const wanted = this.getAttribute('magnet-id');
    this.#magnet = wanted
      ? found.config.magnets.find((m) => m.mag_id === wanted)
      : found.config.magnets.find((m) => m.mag_home) ?? found.config.magnets[0];

    if (!this.#magnet) {
      console.warn(`machvive-m5t-magnet: no magnet "${wanted}" in this app.`);
      return;
    }
    // A magnet need not declare mag_id; the runtime then stores the instance id
    // as null. Comparing undefined to null would silently miss, so normalise.
    const wantId = this.#magnet.mag_id ?? null;
    this.#instance =
      this.#api.instances.find((i) => (i.id ?? null) === wantId) ?? this.#api.instances[0];

    // A capture is the outcome an agent cares about — it tells the agent the
    // visitor actually submitted, rather than that the widget merely opened.
    this.#api.on?.('capture', (detail) => {
      this.#captures.push({ at: new Date().toISOString(), ...detail });
      this.dispatchEvent(new CustomEvent('magnet-capture', { detail, bubbles: true, composed: true }));
    });

    this.#registerTools();
    this.dispatchEvent(
      new CustomEvent('magnet-ready', {
        detail: { magnetId: this.#magnet.mag_id, tools: [...this.#registered] },
        bubbles: true,
        composed: true
      })
    );
  }

  /** Adds the vendor script unless the page already carries one. */
  #injectSnippet() {
    const appGuid = this.getAttribute('app-guid');
    if (globalThis.window?.machfivemagnet || document.querySelector('script[src*="coreSnippet"]')) return;
    if (!appGuid) {
      console.warn('machvive-m5t-magnet: set app-guid, or load the magnet snippet yourself.');
      return;
    }
    const base = this.getAttribute('src') || DEFAULT_SRC;
    const script = document.createElement('script');
    script.src = `${base}?appguid=${encodeURIComponent(appGuid)}`;
    script.async = true;
    document.head.append(script);
  }

  #register(tool) {
    globalThis.navigator?.modelContext?.registerTool(tool);
    this.#registered.push(tool.name);
  }

  #registerTools() {
    const magnet = this.#magnet;
    const steps = collectingSteps(magnet);
    const schema = prefillSchema(magnet);
    const fields = Object.keys(schema.properties);
    // Either shape counts: a booking step in the flow, or a book action offered
    // alongside it.
    const bookingStep = steps.find((s) => s.step_type === 'booking');
    const bookAction = bookingAction(magnet);
    const canBook = Boolean(bookingStep || bookAction);

    this.#register({
      name: 'magnet_describe',
      description:
        `Describe the "${magnet.mag_title ?? magnet.mag_id}" enquiry form: what it asks, ` +
        'what it collects, and whether it can schedule a meeting. Call this first.',
      inputSchema: { type: 'object', properties: {} },
      execute: () => {
        const lines = [
          `${magnet.mag_title ?? magnet.mag_id}${magnet.mag_subtitle ? ` — ${magnet.mag_subtitle}` : ''}`,
          magnet.mag_welcome ?? '',
          '',
          'It asks:'
        ];
        for (const s of steps) {
          const opts = (s.step_options ?? []).map((o) => o.label).filter(Boolean);
          lines.push(
            `- ${s.step_columns[0]} (${s.step_type})${s.step_prompts?.[0] ? `: "${s.step_prompts[0]}"` : ''}` +
              (opts.length ? `\n    choices: ${opts.join(' | ')}` : '')
          );
        }
        const visitorOnly = steps.filter((s) => !isPrefillable(s));
        if (visitorOnly.length) {
          lines.push('', 'The visitor completes these in the widget — you cannot pre-answer them:');
          for (const s of visitorOnly) {
            lines.push(
              `- ${s.step_columns[0]} (${s.step_type})` +
                (s.step_type === 'booking' ? ' — a live calendar; they pick a real slot' : '')
            );
          }
        }
        if (canBook) {
          const what = bookAction?.eventName ? `"${bookAction.eventName}"` : 'a meeting';
          const via = bookAction?.source ? ` via ${bookAction.source}` : '';
          lines.push('', `It can schedule ${what}${via}. The visitor books it from the widget — ` +
            'you cannot book on their behalf, and the times come from a live calendar.');
        } else {
          lines.push('', 'It cannot schedule a meeting; it collects details for a follow-up by email.');
        }
        const otherActions = (magnet.mag_actions ?? []).map((a) => a?.type).filter((t) => t && t !== 'book');
        if (otherActions.length) lines.push(`Entry points: ${[...new Set(otherActions)].join(', ')}.`);
        lines.push('', 'Use magnet_start to fill in what you know. The visitor reviews and submits — you cannot submit for them.');
        return lines.join('\n');
      }
    });

    if (steps.some((s) => (s.step_options ?? []).length)) {
      this.#register({
        name: 'magnet_options',
        description: 'List the allowed choices for one of the form\'s multiple-choice fields.',
        inputSchema: {
          type: 'object',
          properties: {
            field: {
              type: 'string',
              description: 'Field name',
              enum: steps.filter((s) => (s.step_options ?? []).length).map((s) => s.step_columns[0])
            }
          },
          required: ['field']
        },
        execute: ({ field }) => {
          const step = steps.find((s) => s.step_columns[0] === field);
          if (!step) return `No such field: ${field}. Try magnet_describe.`;
          const opts = (step.step_options ?? []).map((o) => o.label);
          return opts.length ? `${field}: ${opts.join(' | ')}` : `${field} is free text.`;
        }
      });
    }

    this.#register({
      name: 'magnet_start',
      description:
        'Open the enquiry form with answers filled in, so the visitor can review and submit. ' +
        `Known fields: ${fields.join(', ')}. ` +
        'This does NOT submit — the visitor confirms. Use it once you have gathered what you can; ' +
        'unknown fields can be left out and the visitor will be asked.',
      inputSchema: schema,
      execute: (params = {}) => {
        if (!this.#instance) return { content: [{ type: 'text', text: 'The magnet is not loaded.' }], isError: true };

        const unknown = Object.keys(params).filter((k) => !fields.includes(k));
        if (unknown.length) {
          // Naming the valid fields lets the agent correct itself in one turn.
          return {
            content: [{ type: 'text', text: `Unknown field(s): ${unknown.join(', ')}. Valid: ${fields.join(', ')}.` }],
            isError: true
          };
        }
        for (const s of steps.filter(isPrefillable)) {
          const v = params[s.step_columns[0]];
          const opts = (s.step_options ?? []).map((o) => o.label);
          // An empty value means "I do not know this", which is a legitimate
          // thing for an agent to say. The prefill below drops it; rejecting it
          // here as an invalid choice would contradict that.
          if (v != null && v !== '' && opts.length && !opts.includes(v)) {
            return {
              content: [{ type: 'text', text: `"${v}" is not a choice for ${s.step_columns[0]}. Options: ${opts.join(' | ')}.` }],
              isError: true
            };
          }
        }

        const prefill = Object.fromEntries(
          Object.entries(params).filter(([, v]) => v != null && v !== '').map(([k, v]) => [k, String(v)])
        );
        this.#instance.open({ prefill, reset: true });

        const filled = Object.keys(prefill);
        const missing = fields.filter((f) => !filled.includes(f));
        const visitorOnly = steps.filter((s) => !isPrefillable(s)).map((s) => s.step_columns[0]);
        return (
          `Opened the enquiry form for the visitor${filled.length ? ` with ${filled.join(', ')} filled in` : ''}.` +
          (missing.length ? ` They will be asked for: ${missing.join(', ')}.` : '') +
          (visitorOnly.length ? ` They complete in the widget: ${visitorOnly.join(', ')}.` : '') +
          ' They must review and submit it themselves.'
        );
      }
    });

    this.#register({
      name: 'magnet_status',
      description: 'Check whether the visitor has submitted the enquiry form yet.',
      inputSchema: { type: 'object', properties: {} },
      execute: () =>
        this.#captures.length
          ? `Submitted — ${this.#captures.length} capture(s), most recent at ${this.#captures.at(-1).at}.`
          : 'Not submitted yet. The form may be open and awaiting the visitor.'
    });

    globalThis.window?.dispatchEvent?.(new CustomEvent(TOOLS_CHANGED_EVENT, {
      detail: { tools: globalThis.navigator?.modelContext?.tools ?? [] }
    }));
  }
}

if (!customElements.get('machvive-m5t-magnet')) {
  customElements.define('machvive-m5t-magnet', MachviveM5tMagnet);
}
