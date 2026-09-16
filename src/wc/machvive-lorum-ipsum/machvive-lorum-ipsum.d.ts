/** Placeholder-copy element. Projects light DOM through a slot. */
export class MachviveLorumIpsum extends HTMLElement {
  /** Forces a palette regardless of the OS preference. null follows the OS. */
  theme: 'light' | 'dark' | null;
}

declare global {
  interface HTMLElementTagNameMap {
    'machvive-lorum-ipsum': MachviveLorumIpsum;
  }
}
