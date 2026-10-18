import { test, describe, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

/**
 * The magnet runtime is a third-party script, so these stub it and test what the
 * component actually owns: deriving a tool surface from an arbitrary magnet
 * config. A magnet is highly configurable, so the cases that matter are the ones
 * this instance does NOT use — booking steps and types we have never seen.
 */

const opened = [];

function installRuntime(steps, extra = {}) {
  opened.length = 0;
  const magnet = {
    mag_id: 'test_magnet',
    mag_home: true,
    mag_title: 'Test',
    mag_welcome: 'Hello',
    mag_macro_steps: steps,
    ...extra
  };
  window.machfivemagnet = { appGuid: 'guid', magnets: [magnet] };
  window.MachFiveMagnet = {
    instances: [{ id: 'test_magnet', open: (o) => opened.push(o), close() {} }],
    listeners: {},
    on(type, fn) { (this.listeners[type] ||= []).push(fn); },
    emit(type, d) { (this.listeners[type] || []).forEach((f) => f(d)); }
  };
  return magnet;
}

const SELECT = {
  id: 'c1', step_type: 'single_select', step_columns: ['product_interest'],
  step_options: [{ label: 'Evaluating' }, { label: 'Enterprise support' }],
  step_prompts: ['What brings you here?']
};
const EMAIL = { id: 'c2', step_type: 'email', step_columns: ['email'], step_options: [], step_prompts: ['Best email?'] };
const MESSAGE = { id: 'c3', step_type: 'message', step_columns: [], step_options: [], step_prompts: ['Thanks'] };
const SCHEDULER = {
  id: 'c4', step_type: 'scheduler', step_columns: ['meeting_time'], step_options: [],
  step_prompts: ['Pick a time'], step_config: { remote: 'ms_bookings' }
};
const LOCAL_SCHEDULER = {
  id: 'c4', step_type: 'scheduler', step_columns: ['preferred_time'], step_options: [],
  step_prompts: ['When suits?'], step_config: { start: 9, end: 17, mins: 30 }
};
const EXOTIC = { id: 'c5', step_type: 'some_future_type', step_columns: ['mystery'], step_options: [], step_prompts: ['?'] };

const mount = async () => {
  const el = document.createElement('machvive-m5t-magnet');
  document.body.append(el);
  for (let i = 0; i < 40 && !navigator.modelContext.tools.some((t) => t.name === 'magnet_describe'); i++) {
    await new Promise((r) => setTimeout(r, 25));
  }
  return el;
};
const call = (n, p = {}) => navigator.modelContext.callTool(n, p);
const text = (r) => (r.content ?? []).map((b) => b.text).join('\n');

before(async () => { await import('../src/wc/machvive-m5t-magnet/machvive-m5t-magnet.js'); });

beforeEach(() => {
  document.body.innerHTML = '';
  navigator.modelContext.provideContext({ tools: [] });
});

describe('deriving tools from config', () => {
  test('registers a tool surface built from the magnet definition', async () => {
    installRuntime([SELECT, EMAIL, MESSAGE]);
    await mount();
    const names = navigator.modelContext.tools.map((t) => t.name).sort();
    assert.deepEqual(names, ['magnet_describe', 'magnet_options', 'magnet_start', 'magnet_status']);
  });

  test('omits magnet_options when nothing has choices', async () => {
    installRuntime([EMAIL, MESSAGE]);
    await mount();
    assert.equal(navigator.modelContext.tools.some((t) => t.name === 'magnet_options'), false);
  });

  test('message steps collect nothing, so they are not fields', async () => {
    installRuntime([SELECT, EMAIL, MESSAGE]);
    await mount();
    const start = navigator.modelContext.tools.find((t) => t.name === 'magnet_start');
    assert.deepEqual(Object.keys(start.inputSchema.properties).sort(), ['email', 'product_interest']);
  });

  test('select options become an enum the agent can see', async () => {
    installRuntime([SELECT, EMAIL, MESSAGE]);
    await mount();
    const start = navigator.modelContext.tools.find((t) => t.name === 'magnet_start');
    assert.deepEqual(start.inputSchema.properties.product_interest.enum, ['Evaluating', 'Enterprise support']);
  });
});

describe('steps the agent must not pre-answer', () => {
  test('a booking step is excluded from the prefill schema', async () => {
    // A live calendar's slots change; a pre-filled one would be stale or invalid.
    installRuntime([SELECT, EMAIL, SCHEDULER, MESSAGE]);
    await mount();
    const start = navigator.modelContext.tools.find((t) => t.name === 'magnet_start');
    assert.equal('meeting_time' in start.inputSchema.properties, false);
  });

  test('but the agent is told booking exists and that it can schedule', async () => {
    installRuntime([SELECT, EMAIL, SCHEDULER, MESSAGE]);
    await mount();
    const described = text(await call('magnet_describe'));
    assert.match(described, /meeting_time \(scheduler\)/);
    assert.match(described, /pick the slot themselves/);
    assert.match(described, /books .* on a real calendar/);
  });

  test('an unrecognised step type degrades the same way, not to a string', async () => {
    // The allowlist is the point: a type shipped after this component was
    // written must not silently become a prefillable text field.
    installRuntime([EMAIL, EXOTIC, MESSAGE]);
    await mount();
    const start = navigator.modelContext.tools.find((t) => t.name === 'magnet_start');
    assert.equal('mystery' in start.inputSchema.properties, false);
    assert.match(text(await call('magnet_describe')), /mystery \(some_future_type\)/);
  });

  test('says scheduling is unavailable when no booking step is configured', async () => {
    installRuntime([SELECT, EMAIL, MESSAGE]);
    await mount();
    assert.match(text(await call('magnet_describe')), /cannot schedule a meeting/);
  });
});

describe('magnet_start', () => {
  beforeEach(async () => { installRuntime([SELECT, EMAIL, MESSAGE]); await mount(); });

  test('opens the widget prefilled rather than submitting', async () => {
    const r = await call('magnet_start', { product_interest: 'Evaluating', email: 'a@b.com' });
    assert.equal(opened.length, 1);
    assert.deepEqual(opened[0].prefill, { product_interest: 'Evaluating', email: 'a@b.com' });
    assert.match(text(r), /review and submit it themselves/);
  });

  test('rejects a choice that is not in the enum, and names the valid ones', async () => {
    const r = await call('magnet_start', { product_interest: 'Nope' });
    assert.equal(r.isError, true);
    assert.match(text(r), /Evaluating \| Enterprise support/);
    assert.equal(opened.length, 0, 'an invalid call must not open the widget');
  });

  test('passes keys beyond the declared fields through to the lead', async () => {
    // Deliberate: extra keys ride the capture onto the lead record, which is how
    // campaign and source identifiers reach the CRM. Stripping them would break it.
    const r = await call('magnet_start', { email: 'a@b.com', lead_source: 'agent' });
    assert.notEqual(r.isError, true);
    assert.equal(opened[0].prefill.lead_source, 'agent');
    assert.match(text(r), /Passed through with the lead: lead_source/);
  });

  test('tells the agent what the visitor still has to supply', async () => {
    assert.match(text(await call('magnet_start', { email: 'a@b.com' })), /asked for: product_interest/);
  });

  test('drops empty values rather than prefilling blanks', async () => {
    await call('magnet_start', { email: 'a@b.com', product_interest: '' });
    assert.deepEqual(Object.keys(opened[0].prefill), ['email']);
  });
});

describe('magnet_status', () => {
  test('reports not-submitted until a capture arrives', async () => {
    installRuntime([SELECT, EMAIL, MESSAGE]);
    const el = await mount();
    assert.match(text(await call('magnet_status')), /Not opened yet/);

    window.MachFiveMagnet.emit('open', {});
    window.MachFiveMagnet.emit('engage', { detail: 'choice' });
    window.MachFiveMagnet.emit('step', { detail: '2/3' });
    const mid = text(await call('magnet_status'));
    assert.match(mid, /Not submitted/);
    assert.match(mid, /on step 2\/3/);

    window.MachFiveMagnet.emit('capture', { email: 'a@b.com' });
    assert.match(text(await call('magnet_status')), /Submitted/);
    assert.equal(el.captures.length, 1);
  });
});

describe('scheduling declared as an action, not a step', () => {
  // Shape taken from a real magnet: its conversational steps collect name and
  // email, while booking is a mag_action handing off to Microsoft Bookings.
  const BOOK_ACTION = {
    type: 'book',
    value: 'https://outlook.office.com/book/someone@example.com/',
    config: { source: 'ms_bookings', event_name: '30-min meeting' }
  };

  test('reports it can schedule even with no booking step', async () => {
    installRuntime([SELECT, EMAIL, MESSAGE], { mag_actions: [BOOK_ACTION, { type: 'chat' }] });
    await mount();
    const d = text(await call('magnet_describe'));
    assert.match(d, /books "30-min meeting" through ms_bookings on a real calendar/);
    assert.doesNotMatch(d, /cannot schedule/);
  });

  test('still says the visitor books it, not the agent', async () => {
    installRuntime([SELECT, EMAIL, MESSAGE], { mag_actions: [BOOK_ACTION] });
    await mount();
    assert.match(text(await call('magnet_describe')), /cannot book for them/);
  });

  test('lists other entry points so the agent knows what exists', async () => {
    installRuntime([SELECT, EMAIL, MESSAGE], { mag_actions: [BOOK_ACTION, { type: 'chat' }] });
    await mount();
    assert.match(text(await call('magnet_describe')), /Entry points: book, chat/);
  });

  test('a local scheduler captures a preferred time, and says so rather than claiming a booking', async () => {
    // Distinguishing these matters: a local scheduler puts a time on the lead but
    // nothing on anyone's calendar. Calling that "booked" would mislead.
    installRuntime([SELECT, EMAIL, LOCAL_SCHEDULER, MESSAGE], { mag_actions: [{ type: 'chat' }] });
    await mount();
    const d = text(await call('magnet_describe'));
    assert.match(d, /books nothing on a calendar/);
    assert.doesNotMatch(d, /real calendar/);
  });

  test('an external booking URL is a handoff, not an in-widget calendar', async () => {
    // Shape seen in the wild: a book action pointing at a third-party booking
    // system with no config.source. It opens in a new tab, so the outcome is
    // unobservable from this page — claiming a booking would overstate it.
    installRuntime([SELECT, EMAIL, MESSAGE], {
      mag_actions: [{ type: 'book', value: 'https://example.janeapp.com' }, { type: 'chat' }]
    });
    await mount();
    const d = text(await call('magnet_describe'));
    assert.match(d, /sending the visitor to https:\/\/example\.janeapp\.com/);
    assert.match(d, /whether they went through with it/);
    assert.doesNotMatch(d, /real calendar/);
  });

  test('call and email actions surface contact details', async () => {
    installRuntime([SELECT, EMAIL, MESSAGE], {
      mag_actions: [{ type: 'call', value: '305-306-2062' }, { type: 'email', value: 'x@y.com' }]
    });
    await mount();
    const d = text(await call('magnet_describe'));
    assert.match(d, /Phone: 305-306-2062/);
    assert.match(d, /Email: x@y\.com/);
  });

  test('a chat-only magnet still reports it cannot schedule', async () => {
    installRuntime([SELECT, EMAIL, MESSAGE], { mag_actions: [{ type: 'chat' }] });
    await mount();
    assert.match(text(await call('magnet_describe')), /cannot schedule a meeting/);
  });

  test('binds to the instance when the magnet declares no mag_id', async () => {
    // The runtime stores id as null in that case; undefined !== null would miss.
    const magnet = installRuntime([EMAIL, MESSAGE], { mag_actions: [BOOK_ACTION] });
    delete magnet.mag_id;
    window.MachFiveMagnet.instances[0].id = null;
    await mount();
    await call('magnet_start', { email: 'a@b.com' });
    assert.equal(opened.length, 1, 'should still find the instance and open it');
  });
});

describe('tool tiers', () => {
  const names = () => navigator.modelContext.tools.map((t) => t.name).filter((n) => n.startsWith('magnet_')).sort();

  const mountWith = async (attrs = {}, extra = {}) => {
    installRuntime([SELECT, EMAIL], extra);
    const el = document.createElement('machvive-m5t-magnet');
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
    document.body.append(el);
    for (let i = 0; i < 40 && !navigator.modelContext.tools.some((t) => t.name.startsWith('magnet_')); i++) {
      await new Promise((r) => setTimeout(r, 25));
    }
    return el;
  };

  test('all four by default, so existing pages are unchanged', async () => {
    const el = await mountWith();
    assert.deepEqual(names(), ['magnet_describe', 'magnet_options', 'magnet_start', 'magnet_status']);
    el.remove();
  });

  test('tools="read" withholds the one tool with a side effect', async () => {
    // magnet_start opens and prefills a widget on a real person's screen. The
    // other three only read, which is why they can be on by default.
    const el = await mountWith({ tools: 'read' });
    assert.deepEqual(names(), ['magnet_describe', 'magnet_options', 'magnet_status']);
    assert.equal(el.tools, 'read');
    el.remove();
  });

  test('tools="none" publishes nothing but still reads config', async () => {
    installRuntime([SELECT, EMAIL]);
    const el = document.createElement('machvive-m5t-magnet');
    el.setAttribute('tools', 'none');
    document.body.append(el);
    await new Promise((r) => setTimeout(r, 300));
    assert.deepEqual(names(), []);
    assert.ok(el.config, 'config is still available to page code');
    el.remove();
  });

  test('the magnet config decides when the attribute is absent', async () => {
    // So a merchant setting travels with the magnet rather than the markup.
    const el = await mountWith({}, { mag_agent_tools: 'read' });
    assert.deepEqual(names(), ['magnet_describe', 'magnet_options', 'magnet_status']);
    el.remove();

    const off = await mountWith({}, { mag_agent_tools: false });
    await new Promise((r) => setTimeout(r, 200));
    assert.deepEqual(names(), [], 'false maps to none');
    off.remove();
  });

  test('the attribute overrides the config', async () => {
    const el = await mountWith({ tools: 'all' }, { mag_agent_tools: false });
    assert.ok(names().includes('magnet_start'), 'the page can override the magnet setting');
    el.remove();
  });

  test('an unknown tools value falls back to all rather than publishing nothing', async () => {
    const el = await mountWith({ tools: 'banana' });
    assert.ok(names().includes('magnet_start'));
    el.remove();
  });
});

describe('namespace ownership', () => {
  const names = () => navigator.modelContext.tools.map((t) => t.name).filter((n) => n.startsWith('magnet_'));

  test('a second element does not re-register over the first', async () => {
    // Tool names are page-wide. The runtime mounting one while a page already
    // carries its own tag is the case that makes this real.
    installRuntime([SELECT, EMAIL]);
    const first = document.createElement('machvive-m5t-magnet');
    document.body.append(first);
    for (let i = 0; i < 40 && !names().length; i++) await new Promise((r) => setTimeout(r, 25));
    const before = names().length;

    const second = document.createElement('machvive-m5t-magnet');
    document.body.append(second);
    await new Promise((r) => setTimeout(r, 300));

    assert.equal(names().length, before, 'no duplicate registration');
    assert.deepEqual(second.toolNames ?? [], [], 'the second element registered nothing');
    first.remove(); second.remove();
  });

  test('removing the owner hands the namespace to a survivor', async () => {
    installRuntime([SELECT, EMAIL]);
    const first = document.createElement('machvive-m5t-magnet');
    const second = document.createElement('machvive-m5t-magnet');
    document.body.append(first);
    for (let i = 0; i < 40 && !names().length; i++) await new Promise((r) => setTimeout(r, 25));
    document.body.append(second);
    await new Promise((r) => setTimeout(r, 200));

    first.remove();
    await new Promise((r) => setTimeout(r, 200));
    assert.ok(names().length > 0, 'removing one element must not strip the page of magnet tools');
    second.remove();
  });

  test('removing the only element withdraws the tools', async () => {
    installRuntime([SELECT, EMAIL]);
    const el = document.createElement('machvive-m5t-magnet');
    document.body.append(el);
    for (let i = 0; i < 40 && !names().length; i++) await new Promise((r) => setTimeout(r, 25));
    el.remove();
    await new Promise((r) => setTimeout(r, 100));
    assert.deepEqual(names(), [], 'a tool that cannot run must not stay advertised');
  });

  test('publishTools re-registers after provideContext wipes the toolset', async () => {
    installRuntime([SELECT, EMAIL]);
    const el = document.createElement('machvive-m5t-magnet');
    document.body.append(el);
    for (let i = 0; i < 40 && !names().length; i++) await new Promise((r) => setTimeout(r, 25));

    navigator.modelContext.provideContext({ tools: [] });
    assert.deepEqual(names(), [], 'wiped, as provideContext promises');

    el.publishTools();
    assert.ok(names().length > 0, 'the page can ask for them back');
    el.remove();
  });
});

describe('tier changes and liveness', () => {
  const names = () => navigator.modelContext.tools.map((t) => t.name).filter((n) => n.startsWith('magnet_'));

  const mountOne = async (attrs = {}) => {
    const el = document.createElement('machvive-m5t-magnet');
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
    document.body.append(el);
    for (let i = 0; i < 40 && !names().length; i++) await new Promise((r) => setTimeout(r, 25));
    return el;
  };

  test('narrowing the tier withdraws the tool it no longer covers', async () => {
    // A merchant turning actions off must actually remove magnet_start, not
    // leave it registered from the previous tier.
    installRuntime([SELECT, EMAIL]);
    const el = await mountOne();
    assert.ok(names().includes('magnet_start'));

    el.setAttribute('tools', 'read');
    await new Promise((r) => setTimeout(r, 50));
    assert.ok(!names().includes('magnet_start'), 'the act tool must go');
    assert.ok(names().includes('magnet_describe'), 'the read tools stay');

    el.setAttribute('tools', 'all');
    await new Promise((r) => setTimeout(r, 50));
    assert.ok(names().includes('magnet_start'), 'and come back');
    el.remove();
  });

  test('a later element claims the namespace when provideContext emptied it', async () => {
    // Ownership alone is not enough: after a wipe the owner still points at a
    // connected element while the registry holds nothing, and a page would be
    // left advertising no magnet tools for the rest of its life.
    installRuntime([SELECT, EMAIL]);
    const first = await mountOne();
    assert.ok(names().length);

    navigator.modelContext.provideContext({ tools: [] });
    assert.deepEqual(names(), []);
    assert.equal(first.isConnected, true, 'the stale owner is still on the page');

    const second = await mountOne();
    assert.ok(names().length > 0, 'a newly mounted element should republish');
    first.remove(); second.remove();
  });
});

describe('Magnet SDK integration contract', () => {
  test('marks assistant opens and strips visitor-only fields even as extra keys', async () => {
    installRuntime([EMAIL, SCHEDULER, EXOTIC], {mag_actions:[{type:'book',config:{column:'appointment'}}]});
    await mount();
    const result = await call('magnet_start', {email:'test@example.test', meeting_time:'tomorrow', mystery:'bypass', appointment:'noon', campaign:'summer'});
    assert.deepEqual(opened, [{reset:true,source:'agent',prefill:{email:'test@example.test',campaign:'summer'}}]);
    assert.doesNotMatch(text(result), /Passed through with the lead:[^.]*meeting_time/);
  });
  test('reports a pending submission instead of claiming it opened', async () => {
    installRuntime([EMAIL]); window.MachFiveMagnet.instances[0].open=()=>false;
    await mount(); const result=await call('magnet_start',{});
    assert.equal(result.isError,true);assert.match(text(result), /cannot start now/);
  });
  test('uses the selected instance definition when another app overwrote global config', async () => {
    const selected=installRuntime([EMAIL], {mag_guid:'first-guid',mag_title:'First store'});
    const inst=window.MachFiveMagnet.instances[0]; Object.assign(inst,{definition:selected,guid:'first-guid',appGuid:'first-app',capabilities:{hubPrefill:true}});
    window.MachFiveMagnet.instances.push({id:'test_magnet',appGuid:'other-app',guid:'other-guid',definition:{...selected,mag_guid:'other-guid',mag_title:'Other store'},open(){throw Error('wrong store');}});
    window.machfivemagnet={appGuid:'other-app',magnets:[window.MachFiveMagnet.instances[1].definition]};
    const el=document.createElement('machvive-m5t-magnet');el.setAttribute('app-guid','first-app');el.setAttribute('magnet-id','first-guid');
    const ready=new Promise(resolve=>el.addEventListener('magnet-ready',resolve,{once:true}));document.body.append(el);await ready;
    assert.match(text(await call('magnet_describe')), /First store/);await call('magnet_start',{email:'test@example.test'});assert.equal(opened.length,1);
  });
  test('does not replace a connected owner when the native registry has no tools list', async () => {
    installRuntime([EMAIL]); const first=await mount();
    const context=navigator.modelContext, descriptor=Object.getOwnPropertyDescriptor(navigator,'modelContext');
    let registrations=0;
    Object.defineProperty(navigator,'modelContext',{configurable:true,value:{registerTool(){registrations++;},unregisterTool(){}}});
    try {
      const el=document.createElement('machvive-m5t-magnet');
      const ready=new Promise(resolve=>el.addEventListener('magnet-ready',resolve,{once:true}));document.body.append(el);await ready;
      assert.equal(registrations,0);el.remove();
    } finally {Object.defineProperty(navigator,'modelContext',descriptor || {configurable:true,value:context});first.remove();}
  });
  test('removing a stale owner does not withdraw its replacement tools', async () => {
    installRuntime([EMAIL]);const first=await mount();navigator.modelContext.provideContext({tools:[]});const second=await mount();
    first.remove();assert.ok(navigator.modelContext.tools.some(t=>t.name==='magnet_start'));second.remove();
  });
});
