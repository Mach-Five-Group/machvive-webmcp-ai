/** One capture observed on the page. */
export interface MagnetCapture {
  at: string;
  [key: string]: unknown;
}

/**
 * Bridges a MachFive Magnet to WebMCP. Tools are derived from the magnet's own
 * configuration, so adding a step in the admin adds it to the agent surface.
 */
export class MachviveM5tMagnet extends HTMLElement {
  /** The magnet definition this element bound to, once loaded. */
  readonly config: Record<string, unknown> | null;
  /** Captures observed this session. */
  readonly captures: MagnetCapture[];
}

declare global {
  interface HTMLElementTagNameMap {
    'machvive-m5t-magnet': MachviveM5tMagnet;
  }
  interface WindowEventMap {
    'magnet-ready': CustomEvent<{ magnetId: string; tools: string[] }>;
    'magnet-capture': CustomEvent<Record<string, unknown>>;
    'magnet-error': CustomEvent<{ reason: string }>;
  }
}
