export class MachviveLorumIpsum extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
  }


  /** Forces a palette regardless of the OS preference. null follows the OS. */
  get theme() {
    return this.getAttribute('theme');
  }

  set theme(value) {
    if (value == null) this.removeAttribute('theme');
    else this.setAttribute('theme', value);
  }

  connectedCallback() {
    this.shadowRoot.innerHTML = `
      <style>
        :host { display: block; font-family: sans-serif; color: #333; }
        @media (prefers-color-scheme: dark) {
          :host(:not([theme="light"])) { color: #e8eaed; }
        }
        :host([theme="dark"]) { color: #e8eaed; }
        :host([theme="light"]) { color: #333; }
      </style>
      <div>
        <slot>Lorem ipsum dolor sit amet...</slot>
      </div>
    `;
  }
}

// Automatically register the component if it hasn't been already
if (!customElements.get('machvive-lorum-ipsum')) {
  customElements.define('machvive-lorum-ipsum', MachviveLorumIpsum);
}
