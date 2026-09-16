/**
 * Lists registered WebMCP tools, builds a form from each tool's inputSchema,
 * and executes it. Inline by default; `floating` docks it as an overlay.
 */
export class MachviveWebmcpInspect extends HTMLElement {
  /** Opens the panel (floating mode only). */
  show(): void;
  /** Closes the panel (floating mode only). */
  hide(): void;
}

declare global {
  interface HTMLElementTagNameMap {
    'machvive-webmcp-inspect': MachviveWebmcpInspect;
  }
}
