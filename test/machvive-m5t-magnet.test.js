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
const BOOKING = { id: 'c4', step_type: 'booking', step_columns: ['meeting_time'], step_options: [], step_prompts: ['Pick a time'] };
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
    installRuntime([SELECT, EMAIL, BOOKING, MESSAGE]);
    await mount();
    const start = navigator.modelContext.tools.find((t) => t.name === 'magnet_start');
    assert.equal('meeting_time' in start.inputSchema.properties, false);
  });

  test('but the agent is told booking exists and that it can schedule', async () => {
    installRuntime([SELECT, EMAIL, BOOKING, MESSAGE]);
    await mount();
    const described = text(await call('magnet_describe'));
    assert.match(described, /meeting_time \(booking\)/);
    assert.match(described, /live calendar/);
    assert.match(described, /can schedule a meeting/);
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

  test('rejects unknown fields instead of silently dropping them', async () => {
    const r = await call('magnet_start', { nope: 'x' });
    assert.equal(r.isError, true);
    assert.match(text(r), /Unknown field/);
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
    assert.match(text(await call('magnet_status')), /Not submitted yet/);

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
    assert.match(d, /can schedule "30-min meeting" via ms_bookings/);
    assert.doesNotMatch(d, /cannot schedule/);
  });

  test('still says the visitor books it, not the agent', async () => {
    installRuntime([SELECT, EMAIL, MESSAGE], { mag_actions: [BOOK_ACTION] });
    await mount();
    assert.match(text(await call('magnet_describe')), /cannot book on their behalf/);
  });

  test('lists other entry points so the agent knows what exists', async () => {
    installRuntime([SELECT, EMAIL, MESSAGE], { mag_actions: [BOOK_ACTION, { type: 'chat' }] });
    await mount();
    assert.match(text(await call('magnet_describe')), /Entry points: chat/);
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
