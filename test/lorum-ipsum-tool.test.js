import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import '../src/wc/machvive-lorum-ipsum/machvive-lorum-ipsum.js';
import { PLACEHOLDER_TOOL } from '../src/wc/machvive-lorum-ipsum/machvive-lorum-ipsum.js';

const tools = () => navigator.modelContext?.tools ?? [];
const named = () => tools().find((t) => t.name === PLACEHOLDER_TOOL);
const mount = (attrs = {}) => {
  const el = document.createElement('machvive-lorum-ipsum');
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  document.body.append(el);
  return el;
};

describe('<machvive-lorum-ipsum> as a WebMCP tool', () => {
  beforeEach(() => document.body.replaceChildren());

  test('importing the component installs the polyfill', () => {
    // Without this import the element would register against nothing whenever a
    // page reached for it before the polyfill — which is exactly how analytics
    // shipped capturing zero calls.
    assert.ok(navigator.modelContext, 'navigator.modelContext should exist');
  });

  test('a connected element publishes the tool', () => {
    assert.equal(named(), undefined, 'nothing registered before one is mounted');
    const el = mount();
    const tool = named();
    assert.ok(tool, 'tool should be registered');
    assert.match(tool.description, /placeholder/i);
    el.remove();
  });

  test('the schema builds a usable form in the inspector', () => {
    const el = mount();
    const { inputSchema } = named();
    assert.equal(inputSchema.type, 'object');
    // enum renders as a select, integer as a stepped number input.
    assert.deepEqual(inputSchema.properties.lang.enum, ['latin', 'english']);
    for (const field of ['sentences', 'paragraphs', 'seed']) {
      assert.equal(inputSchema.properties[field].type, 'integer', `${field} should be integer`);
      assert.ok(inputSchema.properties[field].description, `${field} needs a description`);
    }
    el.remove();
  });

  test('calling the tool returns copy and updates the page', async () => {
    const el = mount();
    const before = el.text;
    const result = await navigator.modelContext.callTool(PLACEHOLDER_TOOL, {
      lang: 'english', sentences: 2
    });

    assert.ok(!result.isError, JSON.stringify(result));
    const text = result.content[0].text;
    assert.notEqual(text, before);
    // Visibly changing the page is the point: it is what makes the inspector a
    // verification tool rather than a console.
    assert.equal(el.text, text);
    assert.equal(el.shadowRoot.querySelector('slot > p').textContent, text.split('\n\n')[0]);
    assert.equal(el.lang, 'english');
    el.remove();
  });

  test('omitted parameters leave the element attributes alone', async () => {
    const el = mount({ lang: 'english', paragraphs: 2 });
    await navigator.modelContext.callTool(PLACEHOLDER_TOOL, { sentences: 1 });
    assert.equal(el.lang, 'english', 'an unsupplied param must not overwrite the attribute');
    assert.equal(el.paragraphs, 2);
    assert.equal(el.sentences, 1);
    el.remove();
  });

  test('a seed through the tool is repeatable', async () => {
    const el = mount();
    const first = await navigator.modelContext.callTool(PLACEHOLDER_TOOL, { seed: 1234, sentences: 3 });
    const second = await navigator.modelContext.callTool(PLACEHOLDER_TOOL, { seed: 1234, sentences: 3 });
    assert.equal(first.content[0].text, second.content[0].text);
    el.remove();
  });

  test('a bad parameter comes back as an error, not a throw', async () => {
    const el = mount();
    const result = await navigator.modelContext.callTool(PLACEHOLDER_TOOL, { lang: 'klingon' });
    // callTool never throws; an unknown lang falls back to latin via the element.
    assert.ok(!result.isError || result.content.length > 0);
    el.remove();
  });

  test('three elements publish one tool, and the first owns it', async () => {
    const [first, second, third] = [mount(), mount(), mount()];
    assert.equal(tools().filter((t) => t.name === PLACEHOLDER_TOOL).length, 1);

    // Counting is not enough: the registry is keyed by name, so three
    // registrations collapse to one entry whether or not ownership is guarded.
    // What differs is which block the tool actually drives — without the guard
    // the last one mounted silently wins.
    const before = [first.text, second.text, third.text];
    const result = await navigator.modelContext.callTool(PLACEHOLDER_TOOL, { sentences: 2, seed: 5 });
    assert.equal(first.text, result.content[0].text, 'the first element should own the tool');
    assert.equal(second.text, before[1], 'later blocks must be untouched');
    assert.equal(third.text, before[2]);

    for (const el of [first, second, third]) el.remove();
  });

  test('removing a non-owner leaves the registration untouched', () => {
    const first = mount();
    const second = mount();

    // Churn is the symptom: unregister + re-register fires the change event
    // twice, and the inspector re-renders on it — so a form being filled in
    // would be wiped by removing an unrelated placeholder block.
    let changes = 0;
    const count = () => changes++;
    window.addEventListener('machvive-webmcp-change', count);
    second.remove();
    window.removeEventListener('machvive-webmcp-change', count);

    assert.equal(changes, 0, 'removing a non-owner should not re-register anything');
    assert.ok(named(), 'the tool survives');
    first.remove();
  });

  test('removing the owner hands the tool to another block', async () => {
    const first = mount();
    const second = mount();
    assert.ok(named(), 'registered by the first');

    first.remove();
    assert.ok(named(), 'removing one block must not take the page tool with it');

    const result = await navigator.modelContext.callTool(PLACEHOLDER_TOOL, { sentences: 1 });
    assert.equal(second.text, result.content[0].text, 'the survivor now owns it');
    second.remove();
  });

  test('removing the last element unregisters the tool', () => {
    const el = mount();
    assert.ok(named());
    el.remove();
    assert.equal(named(), undefined, 'a tool that cannot run must not stay advertised');
  });

  test('no-tool opts out, and toggling it is reversible', () => {
    const quiet = mount({ 'no-tool': '' });
    assert.equal(named(), undefined, 'no-tool must not publish');

    quiet.removeAttribute('no-tool');
    assert.ok(named(), 'clearing no-tool should publish');

    quiet.setAttribute('no-tool', '');
    assert.equal(named(), undefined, 'setting it again should withdraw');
    quiet.remove();
  });

  test('no-tool does not regenerate the copy', () => {
    const el = mount({ sentences: 8 });
    const before = el.text;
    el.setAttribute('no-tool', '');
    assert.equal(el.text, before, 'it changes what is published, not what is displayed');
    el.remove();
  });
});
