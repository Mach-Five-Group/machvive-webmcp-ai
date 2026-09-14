export class MachviveLorumIpsum extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
  }

  connectedCallback() {
    this.shadowRoot.innerHTML = `
      <style>
        :host { display: block; font-family: sans-serif; color: #333; }
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
