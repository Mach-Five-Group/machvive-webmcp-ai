import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';

/**
 * Structural coverage only. jsdom does not evaluate media queries or resolve
 * custom properties, so the colors these rules produce are measured against real
 * Chrome in design/webmcp-playground/verify.mjs.
 */

let THEME_CSS;
const MOUNTED = {};

before(async () => {
  ({ THEME_CSS } = await import('../src/wc/shared/theme.js'));
  await import('../src/wc/machvive-webmcp-inspect/machvive-webmcp-inspect.js');
  await import('../src/wc/machvive-webmcp-analytics/machvive-webmcp-analytics.js');
  await import('../src/wc/machvive-lorum-ipsum/machvive-lorum-ipsum.js');
  for (const tag of [
    'machvive-webmcp-inspect',
    'machvive-webmcp-analytics',
    'machvive-lorum-ipsum'
  ]) {
    const el = document.createElement(tag);
    document.body.append(el);
    MOUNTED[tag] = el;
  }
});

describe('theme tokens', () => {
  test('defines a light palette on bare :host', () => {
    assert.match(THEME_CSS, /:host\s*\{[^}]*--mv-fg:\s*#1a1a1a/s);
  });

  test('redefines tokens under prefers-color-scheme: dark', () => {
    assert.match(THEME_CSS, /@media \(prefers-color-scheme: dark\)/);
  });

  test('lets theme="light" opt out of the OS dark preference', () => {
    // Without the :not() guard, a page forcing light would still go dark.
    assert.match(THEME_CSS, /:host\(:not\(\[theme="light"\]\)\)/);
  });

  test('theme="dark" is declared after the media query so it wins in a light OS', () => {
    assert.ok(
      THEME_CSS.indexOf(':host([theme="dark"])') > THEME_CSS.indexOf('@media (prefers-color-scheme: dark)'),
      'explicit dark must come after the media block or cascade order defeats it'
    );
  });

  test('declares color-scheme so UA-rendered controls follow the palette', () => {
    assert.match(THEME_CSS, /color-scheme:\s*light dark/);
  });

  test('every dark token has a light counterpart', () => {
    const names = (block) => [...block.matchAll(/(--mv-[\w-]+):/g)].map((m) => m[1]);
    const [lightBlock] = THEME_CSS.split('@media');
    const darkBlock = THEME_CSS.slice(THEME_CSS.indexOf('@media'));
    const light = new Set(names(lightBlock));
    for (const token of new Set(names(darkBlock))) {
      assert.ok(light.has(token), `${token} is themed dark but has no light default`);
    }
  });
});

describe('components consume the tokens', () => {
  for (const tag of ['machvive-webmcp-inspect', 'machvive-webmcp-analytics']) {
    test(`${tag} ships both palettes`, () => {
      const css = MOUNTED[tag].shadowRoot.querySelector('style').textContent;
      assert.match(css, /@media \(prefers-color-scheme: dark\)/);
      assert.match(css, /--mv-fg/);
    });

    test(`${tag} has no hardcoded hex left in its own rules`, () => {
      const css = MOUNTED[tag].shadowRoot.querySelector('style').textContent;
      // Remove the token definitions themselves — hex belongs there and nowhere
      // else. Whatever remains must reference vars, not literals.
      const body = css.replace(THEME_CSS, '');
      assert.notEqual(body, css, 'THEME_CSS should be embedded verbatim');
      const leftover = [...body.matchAll(/#[0-9a-f]{3,6}\b/gi)].map((m) => m[0]);
      assert.deepEqual(leftover, [], `hardcoded colors defeat theming: ${leftover.join(', ')}`);
    });

    test(`${tag} observes the theme attribute`, () => {
      assert.ok(customElements.get(tag).observedAttributes.includes('theme'));
    });
  }

  test('machvive-lorum-ipsum adapts too', () => {
    const css = MOUNTED['machvive-lorum-ipsum'].shadowRoot.querySelector('style').textContent;
    assert.match(css, /@media \(prefers-color-scheme: dark\)/);
    assert.match(css, /:host\(\[theme="dark"\]\)/);
  });
});

describe('theme property', () => {
  for (const tag of ['machvive-webmcp-inspect', 'machvive-webmcp-analytics', 'machvive-lorum-ipsum']) {
    test(`${tag} reflects theme between property and attribute`, () => {
      const el = MOUNTED[tag];
      assert.equal(el.theme, null, 'defaults to following the OS');

      el.theme = 'dark';
      assert.equal(el.getAttribute('theme'), 'dark');
      assert.equal(el.theme, 'dark');

      el.setAttribute('theme', 'light');
      assert.equal(el.theme, 'light', 'property reads through to the attribute');

      el.theme = null;
      assert.equal(el.hasAttribute('theme'), false, 'null clears the override');
      assert.equal(el.theme, null);
    });
  }
});

describe('theme attribute is reactive', () => {
  test('setting theme re-renders rather than leaving stale markup', () => {
    const el = MOUNTED['machvive-webmcp-inspect'];
    el.setAttribute('theme', 'dark');
    assert.equal(el.getAttribute('theme'), 'dark');
    assert.ok(el.shadowRoot.querySelector('.panel'), 'panel survives the attribute change');
    el.removeAttribute('theme');
  });
});
