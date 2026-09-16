/**
 * Shared design tokens for the WebMCP UI components.
 *
 * Tokens are plain custom properties on :host, so a consumer can override any of
 * them from outside the shadow DOM — custom properties inherit through shadow
 * boundaries where ordinary styles do not.
 *
 * Resolution order, matching how a component should behave:
 *   1. light palette on :host                      (the default)
 *   2. dark palette when the OS asks for dark      (unless theme="light" opts out)
 *   3. dark palette when theme="dark"              (explicit, wins over the OS)
 */

const LIGHT = `
    --mv-fg: #1a1a1a;
    --mv-muted: #666;
    --mv-faint: #6e6e6e;
    --mv-bg: #fff;
    --mv-surface: #fafafa;
    --mv-input-bg: #fff;
    --mv-border: #e2e2e2;
    --mv-border-soft: #eee;
    --mv-control-border: #ccc;
    --mv-hover: #f2f2f2;
    --mv-selected: #e8f0fe;
    --mv-accent: #1565c0;
    --mv-accent-fg: #fff;
    --mv-ok-bg: #e6f4ea;
    --mv-ok-fg: #0f6b2e;
    --mv-err-bg: #fce8e6;
    --mv-err-fg: #b3261e;
    --mv-err-border: #f5c6c2;
    --mv-danger: #a4161a;
    --mv-danger-border: #d8a0a0;
    --mv-shadow: rgba(0, 0, 0, .18);
`;

const DARK = `
    --mv-fg: #e8eaed;
    --mv-muted: #9aa0a6;
    --mv-faint: #8b9096;
    --mv-bg: #1f2125;
    --mv-surface: #282b30;
    --mv-input-bg: #16181b;
    --mv-border: #3c4046;
    --mv-border-soft: #33363b;
    --mv-control-border: #4a4f56;
    --mv-hover: #32363c;
    --mv-selected: #1e3a5f;
    --mv-accent: #5b9bf8;
    --mv-accent-fg: #0b1220;
    --mv-ok-bg: #16351f;
    --mv-ok-fg: #7ee2a0;
    --mv-err-bg: #3f1d1c;
    --mv-err-fg: #ff9d97;
    --mv-err-border: #5c2c2a;
    --mv-danger: #ff9d97;
    --mv-danger-border: #5c2c2a;
    --mv-shadow: rgba(0, 0, 0, .5);
`;

/**
 * CSS declaring both palettes. Prepend to a component's stylesheet.
 *
 * `color-scheme: light dark` lets UA-rendered parts (scrollbars, select popups,
 * checkboxes, focus rings) follow the same theme as the tokens — without it the
 * browser would paint light controls onto a dark panel.
 */
export const THEME_CSS = `
  :host {
    color-scheme: light dark;
${LIGHT}  }

  @media (prefers-color-scheme: dark) {
    :host(:not([theme="light"])) {
${DARK}    }
  }

  /* Explicit choice beats the OS preference, in both directions. */
  :host([theme="dark"]) {
${DARK}  }

  :host([theme="light"]) {
    color-scheme: light;
${LIGHT}  }
`;
