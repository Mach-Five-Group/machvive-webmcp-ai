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
 *
 * This module contains no URLs. Where the magnet runtime is served from is the
 * integrator's configuration, supplied at runtime via the `src` attribute —
 * baking in a host would couple every consumer's upgrade cycle to where the
 * service happens to be hosted today.
 */
import { TOOLS_CHANGED_EVENT } from '../machvive-webmcp-polyfill/machvive-webmcp-polyfill.js';

/**
 * Step types an agent can meaningfully pre-answer, mapped to JSON Schema.
 *
 * Deliberately an allowlist. A magnet is highly configurable and this runtime
 * already ships step types beyond these. `scheduler` is the important exclusion:
 * with `skip_if_prefilled` set, a prefilled slot would skip the step, so a remote
 * scheduler would never register the booking — the lead would look booked without
 * being booked. Anything not listed here is described to the agent but left for
 * the visitor, which is the honest default for a type we do not understand.
 */
const PREFILLABLE = {
  text: 'string',
  email: 'string',
  phone: 'string',
  single_select: 'string',
  // A string, not an array: prefill coerces with String(), so ['a','b'] becomes
  // "a,b" — which does not match the SDK's ", " join and would not select
  // anything. Callers pass the labels pre-joined.
  multi_select: 'string'
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
function bookingCapability(magnet) {
  const schedulers = allSteps(magnet).filter((s) => s?.step_type === 'scheduler');
  const action = (magnet.mag_actions ?? []).find((a) => a?.type === 'book');
  if (!schedulers.length && !action) return null;

  const source = action?.config?.source ?? null;
  // Only these hosts are embedded in the panel; every other URL opens in a new tab.
  const embeddable = /^https:\/\/(outlook\.office(365)?\.com|([a-z0-9-]+\.)?cal\.com)\//i;
  const url = action?.value ?? '';

  // Three outcomes, and conflating them misdescribes what the visitor did:
  // a real calendar booking inside the widget, a handoff to an external booking
  // system, or merely recording a preferred time on the lead.
  let kind = null;
  if (schedulers.some((x) => x.step_config?.remote === 'ms_bookings') ||
      source === 'calendly' || source === 'ms_bookings' || embeddable.test(url)) {
    kind = 'calendar';
  } else if (action && /^https?:\/\//i.test(url)) {
    kind = 'external';
  } else if (schedulers.length || action) {
    kind = 'preferred_time';
  }

  return {
    kind,
    url: kind === 'external' ? url : null,
    source: source ?? (kind === 'calendar' ? 'a calendar' : null),
    eventName: action?.config?.event_name ?? null
  };
}

/**
 * Every step array a magnet can run. A magnet's flow is not only
 * `mag_macro_steps`: `mag_routes.chat` / `.book` / `.support` hold alternative
 * flows reached from the hub CTA bar, and a scheduler can live in any of them.
 */
function allSteps(magnet) {
  const routes = magnet.mag_routes ?? {};
  return [magnet.mag_macro_steps, routes.chat, routes.book, routes.support]
    .filter(Array.isArray)
    .flat();
}

/** The steps that actually collect something; `message` steps are terminal copy. */
function collectingSteps(magnet) {
  return (magnet.mag_macro_steps ?? []).filter(
    (s) => s.step_type !== 'message' && (s.step_columns ?? []).length
  );
}

/**
 * A hub magnet opens on a welcome card and waits for a CTA. Tapping one clears
 * previously supplied answers, so host prefill does not survive into the route —
 * the agent should be told rather than left to wonder why its values vanished.
 */
const isHub = (magnet) => Boolean(magnet.mag_home) && (magnet.mag_actions ?? []).length > 0;

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
  #progress = {};
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
      console.warn(
        'machvive-m5t-magnet: the magnet runtime did not load; no tools registered. ' +
          'Common causes: the origin is not in the magnet\'s allowed domains, or src/app-guid is wrong.'
      );
      this.dispatchEvent(
        new CustomEvent('magnet-error', { detail: { reason: 'runtime-unavailable' }, bubbles: true, composed: true })
      );
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

    // Every instance on the page shares one global emitter, so filter by magnet.
    // Tracking the whole surface lets magnet_status say where the visitor got to,
    // rather than only whether they finished.
    const mine = (e) => !e?.magnet || e.magnet === this.#magnet.mag_id || e.magnet === this.#magnet.mag_guid;
    for (const type of ['open', 'engage', 'route', 'step', 'cta', 'call_tap', 'capture']) {
      this.#api.on?.(type, (e) => {
        if (!mine(e)) return;
        this.#progress = { ...this.#progress, [type]: e?.detail ?? true, last: type };
        if (type === 'capture') {
          this.#captures.push({ at: new Date().toISOString(), ...e });
          this.dispatchEvent(new CustomEvent('magnet-capture', { detail: e, bubbles: true, composed: true }));
        }
      });
    }

    this.#registerTools();
    this.dispatchEvent(
      new CustomEvent('magnet-ready', {
        detail: { magnetId: this.#magnet.mag_id, tools: [...this.#registered] },
        bubbles: true,
        composed: true
      })
    );
  }

  /**
   * Adds the vendor script unless the page already carries one.
   *
   * Both `src` and `app-guid` are required to inject, and there is no default
   * origin — your magnet admin gives you the full snippet URL, so naming it here
   * costs you nothing and keeps this package free of any host it does not own.
   */
  #injectSnippet() {
    if (globalThis.window?.machfivemagnet || document.querySelector('script[src*="coreSnippet"]')) return;

    const appGuid = this.getAttribute('app-guid');
    const base = this.getAttribute('src');
    if (!base || !appGuid) {
      console.warn(
        'machvive-m5t-magnet: to load the magnet, set both src and app-guid — ' +
          'or add the magnet snippet to the page yourself and this element will use it.'
      );
      return;
    }
    const script = document.createElement('script');
    script.src = `${base}?appguid=${encodeURIComponent(appGuid)}`;
    script.async = true;
    // A magnet only serves origins on its allow-list, so the usual failure is a
    // 403 for the current host rather than anything wrong with the page. Without
    // this the symptom is a silent fifteen-second wait and a generic warning.
    script.onerror = () => {
      console.warn(
        `machvive-m5t-magnet: could not load the magnet from ${base}. ` +
          `Check that this origin (${globalThis.location?.origin}) is in the magnet's allowed domains.`
      );
      this.dispatchEvent(
        new CustomEvent('magnet-error', {
          detail: { reason: 'snippet-load-failed', origin: globalThis.location?.origin, src: base },
          bubbles: true,
          composed: true
        })
      );
    };
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
    const booking = bookingCapability(magnet);
    const hub = isHub(magnet);

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
                (s.step_type === 'scheduler' ? ' — a calendar; they pick the slot themselves' : '')
            );
          }
        }
        const what = booking?.eventName ? `"${booking.eventName}"` : 'a meeting';
        if (booking?.kind === 'calendar') {
          lines.push('', `It books ${what}${booking.source ? ` through ${booking.source}` : ''} on a real ` +
            'calendar, inside the widget. The visitor picks the slot — you cannot book for them.');
        } else if (booking?.kind === 'external') {
          lines.push('', `It can book ${what} by sending the visitor to ${booking.url}. That opens ` +
            'separately, so neither you nor this page can see whether they went through with it.');
        } else if (booking?.kind === 'preferred_time') {
          lines.push('', 'It asks for a preferred time but books nothing on a calendar — the time is ' +
            'captured with the lead for someone to follow up.');
        } else {
          lines.push('', 'It cannot schedule a meeting; it collects details for a follow-up by email.');
        }

        // call/email actions publish contact details the visitor can use directly.
        // An agent asked "how do I reach them" can answer without opening anything.
        for (const a of magnet.mag_actions ?? []) {
          if (a?.type === 'call' && a.value) lines.push(`Phone: ${a.value}`);
          if (a?.type === 'email' && a.value) lines.push(`Email: ${a.value}`);
        }
        if (hub) {
          lines.push('', 'This magnet opens on a welcome card with buttons. Answers are cleared when ' +
            'the visitor taps one, so anything you prefill will not survive — describe what you know ' +
            'to the visitor instead of relying on magnet_start to carry it.');
        }
        const entry = [...new Set((magnet.mag_actions ?? []).map((a) => a?.type).filter(Boolean))];
        if (entry.length) lines.push(`Entry points: ${entry.join(', ')}.`);
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
        'This does NOT submit — the visitor confirms. Fields you leave out are asked of the visitor. ' +
        'Extra keys beyond the known fields are allowed and travel with the lead, which is how ' +
        'context like a campaign or source id is passed through.',
      inputSchema: schema,
      execute: (params = {}) => {
        if (!this.#instance) return { content: [{ type: 'text', text: 'The magnet is not loaded.' }], isError: true };

        // Keys outside the declared fields are deliberately allowed through: they
        // ride the capture and land on the lead record, which is how machine
        // identity (lead_source, campaign ids) reaches the CRM. Stripping them
        // here would quietly break that.
        const extra = Object.keys(params).filter((k) => !fields.includes(k));
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
          (extra.length ? ` Passed through with the lead: ${extra.join(', ')}.` : '') +
          (missing.length ? ` They will be asked for: ${missing.join(', ')}.` : '') +
          (visitorOnly.length ? ` They complete in the widget: ${visitorOnly.join(', ')}.` : '') +
          (isHub(magnet) ? ' Note: this magnet clears answers when the visitor taps a button, so the prefill may not survive.' : '') +
          ' They must review and submit it themselves.'
        );
      }
    });

    this.#register({
      name: 'magnet_status',
      description:
        'Check how far the visitor has got with the enquiry form: whether it has been ' +
        'opened, engaged with, which step they are on, and whether they submitted.',
      inputSchema: { type: 'object', properties: {} },
      execute: () => {
        if (this.#captures.length) {
          const booked = bookingCapability(magnet)?.kind === 'calendar';
          return (
            `Submitted at ${this.#captures.at(-1).at}.` +
            // The runtime emits nothing after a booking commits, so claiming the
            // meeting exists would be asserting more than we can observe.
            (booked ? ' Whether the booking itself completed is not reported by the widget.' : '')
          );
        }
        const p = this.#progress;
        if (!p.last) return 'Not opened yet.';
        const parts = [];
        if (p.step) parts.push(`on step ${p.step}`);
        if (p.route) parts.push(`took the "${p.route}" route`);
        if (p.engage) parts.push('has interacted');
        else if (p.open) parts.push('opened but not yet engaged');
        return `Not submitted. The visitor ${parts.join(', ') || 'has opened it'}.`;
      }
    });

    globalThis.window?.dispatchEvent?.(new CustomEvent(TOOLS_CHANGED_EVENT, {
      detail: { tools: globalThis.navigator?.modelContext?.tools ?? [] }
    }));
  }
}

if (!customElements.get('machvive-m5t-magnet')) {
  customElements.define('machvive-m5t-magnet', MachviveM5tMagnet);
}
