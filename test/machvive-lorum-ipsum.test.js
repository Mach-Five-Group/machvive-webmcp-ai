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

describe('<machvive-lorum-ipsum> generated copy', () => {
  const mount = (attrs = {}) => {
    const el = document.createElement('machvive-lorum-ipsum');
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
    document.body.append(el);
    return el;
  };

  test('the fallback is generated, not one frozen line', () => {
    const a = mount();
    const b = mount({ sentences: 6 });
    assert.ok(a.text.length > 0, 'exposes what it rendered');
    assert.notEqual(a.text, b.text, 'two elements should not read identically');
    a.remove(); b.remove();
  });

  test('renders one paragraph element per paragraph', () => {
    const el = mount({ paragraphs: 3, sentences: 1, seed: 5 });
    const paragraphs = el.shadowRoot.querySelectorAll('slot > p');
    assert.equal(paragraphs.length, 3);
    assert.equal([...paragraphs].map((p) => p.textContent).join('\n\n'), el.text);
    el.remove();
  });

  test('attributes drive the copy', () => {
    const latin = mount({ seed: 3 });
    const english = mount({ seed: 3, lang: 'english' });
    assert.notEqual(latin.text, english.text, 'lang should change the vocabulary');
    assert.ok(latin.text.startsWith('Lorem ipsum'));

    const short = mount({ seed: 3, sentences: 1 });
    const long = mount({ seed: 3, sentences: 8 });
    assert.ok(long.text.length > short.text.length);
    for (const el of [latin, english, short, long]) el.remove();
  });

  test('a seed makes two elements render identically', () => {
    const a = mount({ seed: 77, sentences: 4 });
    const b = mount({ seed: 77, sentences: 4 });
    assert.equal(a.text, b.text);
    a.remove(); b.remove();
  });

  test('changing a generation attribute re-renders', () => {
    const el = mount({ seed: 1 });
    const before = el.text;
    el.setAttribute('lang', 'english');
    assert.notEqual(el.text, before);
    assert.equal(el.shadowRoot.querySelector('slot > p').textContent, el.text.split('\n\n')[0]);
    el.remove();
  });

  test('changing theme does NOT rewrite the copy', () => {
    // Theme is pure CSS here. Re-rendering for it would mean toggling dark mode
    // silently rewrote every placeholder on the page.
    // Unseeded on purpose: with a seed, a spurious re-render would regenerate
    // identical copy and this test would pass while the bug shipped.
    const el = mount({ sentences: 8 });
    const before = el.text;
    el.theme = 'dark';
    assert.equal(el.text, before);
    el.theme = null;
    assert.equal(el.text, before);
    el.remove();
  });

  test('regenerate() produces new copy and returns it', () => {
    const el = mount({ sentences: 5 });
    const before = el.text;
    const returned = el.regenerate();
    assert.equal(returned, el.text);
    assert.notEqual(returned, before);
    el.remove();
  });

  test('a seeded element rerolls to the same copy', () => {
    const el = mount({ seed: 42 });
    const before = el.text;
    assert.equal(el.regenerate(), before, 'a seed is a promise of repeatability');
    el.remove();
  });

  test('slotted content still wins over the generated fallback', () => {
    const el = document.createElement('machvive-lorum-ipsum');
    el.textContent = 'Real copy, written by a human';
    document.body.append(el);
    const assigned = el.shadowRoot.querySelector('slot').assignedNodes();
    assert.equal(assigned.length, 1);
    assert.equal(assigned[0].textContent, 'Real copy, written by a human');
    assert.ok(el.text.length > 0, 'the fallback is still generated underneath');
    el.remove();
  });

  test('copy is text, never markup', () => {
    const el = mount({ sentences: 2 });
    for (const p of el.shadowRoot.querySelectorAll('slot > p')) {
      assert.equal(p.children.length, 0, 'paragraphs hold text nodes only');
    }
    el.remove();
  });

  test('an unknown lang falls back to latin rather than throwing', () => {
    const el = mount({ lang: 'klingon', seed: 2 });
    assert.equal(el.lang, 'latin');
    assert.ok(el.text.startsWith('Lorem ipsum'));
    el.remove();
  });

  test('properties reflect to attributes', () => {
    const el = mount();
    el.lang = 'english';
    assert.equal(el.getAttribute('lang'), 'english');
    el.sentences = 3;
    assert.equal(el.sentences, 3);
    el.seed = 9;
    assert.equal(el.seed, 9);
    el.seed = null;
    assert.equal(el.hasAttribute('seed'), false);
    assert.equal(el.seed, undefined);
    el.remove();
  });
});
