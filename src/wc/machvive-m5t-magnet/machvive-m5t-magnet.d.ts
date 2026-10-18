/** One capture observed on the page. */
export interface MagnetCapture {
  at: string;
  [key: string]: unknown;
}

/**
 * Bridges a MachFive Magnet to WebMCP. Tools are derived from the magnet's own
 * configuration, so adding a step in the admin adds it to the agent surface.
 */
export type MagnetToolTier = 'all' | 'read' | 'none';

export class MachviveM5tMagnet extends HTMLElement {
  /**
   * Which tools to publish. The `tools` attribute wins; otherwise the magnet's
   * own `mag_agent_tools` decides (`true`/`false` map to `all`/`none`).
   * `read` withholds `magnet_start`, the only tool with a visible side effect.
   */
  readonly tools: MagnetToolTier;
  /** (Re)publishes this element's tools, taking the namespace if it is free. */
  publishTools(): this;
  /**
   * Withdraws this element's tools while leaving it on the page, releasing the
   * namespace for a surviving element. The counterpart to `publishTools`, and
   * the only way to stop advertising them short of removing the element —
   * the spec withdraws a tool through the signal its registrant holds.
   */
  withdrawTools(): this;
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
