import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';

describe('<machvive-lorum-ipsum>', () => {
  before(async () => {
    await import('../src/wc/machvive-lorum-ipsum/machvive-lorum-ipsum.js');
  });

  test('self-registers its tag on import', () => {
    assert.ok(customElements.get('machvive-lorum-ipsum'));
  });

  test('the registration guard tolerates a tag already in the registry', async () => {
    // Re-importing must not throw NotSupportedError on the duplicate define.
    await assert.doesNotReject(
      import(`../src/wc/machvive-lorum-ipsum/machvive-lorum-ipsum.js?again=1`)
    );
  });

  test('renders a shadow root with scoped styles', () => {
    const el = document.createElement('machvive-lorum-ipsum');
    document.body.append(el);
    assert.ok(el.shadowRoot, 'shadow root is open and reachable');
    assert.match(el.shadowRoot.innerHTML, /:host\s*\{[^}]*display:\s*block/);
    el.remove();
  });

  test('exposes a slot with fallback copy when no content is supplied', () => {
    const el = document.createElement('machvive-lorum-ipsum');
    document.body.append(el);
    const slot = el.shadowRoot.querySelector('slot');
    assert.ok(slot, 'component projects light DOM through a slot');
    assert.match(slot.textContent, /Lorem ipsum/);
    assert.deepEqual(slot.assignedNodes(), [], 'nothing assigned means fallback shows');
    el.remove();
  });

  test('projects light DOM content into the slot', () => {
    const el = document.createElement('machvive-lorum-ipsum');
    el.textContent = 'Custom copy';
    document.body.append(el);
    const assigned = el.shadowRoot.querySelector('slot').assignedNodes();
    assert.equal(assigned.length, 1);
    assert.equal(assigned[0].textContent, 'Custom copy');
    el.remove();
  });
});
