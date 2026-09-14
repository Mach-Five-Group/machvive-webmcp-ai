/** A single block of MCP tool output. */
export interface WebmcpContent {
  type: 'text';
  text: string;
}

/** The normalized shape every tool invocation resolves to. */
export interface WebmcpToolResult {
  content: WebmcpContent[];
  /** True when the tool was unknown or its handler threw. */
  isError?: boolean;
}

/** Second argument handed to a tool handler. */
export interface WebmcpAgent {
  requestUserInteraction<T>(callback: () => T | PromiseLike<T>): Promise<T>;
}

/** A tool as declared by the page. */
export interface WebmcpToolDescriptor {
  name: string;
  description?: string;
  /** JSON Schema describing the handler's parameters. */
  inputSchema?: Record<string, unknown>;
  execute(params: Record<string, any>, agent: WebmcpAgent): unknown;
}

/** A tool as discovered by an agent — the descriptor without its handler. */
export type WebmcpToolSummary = Omit<WebmcpToolDescriptor, 'execute'>;

export interface ModelContext {
  /** Adds one tool, leaving the rest of the registry intact. */
  registerTool(tool: WebmcpToolDescriptor): void;
  /** Removes one tool by name; returns whether it was present. */
  unregisterTool(name: string): boolean;
  /** Replaces the entire toolset. Validates before mutating. */
  provideContext(config?: { tools?: WebmcpToolDescriptor[] }): void;
  /** Non-standard: descriptors an agent would discover, minus handlers. */
  readonly tools: WebmcpToolSummary[];
  /** Non-standard: invokes a registered tool. Never rejects. */
  callTool(name: string, params?: Record<string, unknown>): Promise<WebmcpToolResult>;
}

/** Event name dispatched on `window` whenever the registry changes. */
export const TOOLS_CHANGED_EVENT: 'machvive-webmcp-change';

/**
 * Installs the polyfill. No-op when WebMCP is native or the page is not a
 * secure context. Returns true only if this call installed it.
 */
export function installWebmcpPolyfill(): boolean;

export class MachviveWebmcpPolyfill extends HTMLElement {
  registerTool(tool: WebmcpToolDescriptor): void;
  unregisterTool(name: string): boolean | undefined;
}

declare global {
  interface Navigator {
    /** Present on secure contexts; see `installWebmcpPolyfill`. */
    modelContext: ModelContext;
  }
  interface HTMLElementTagNameMap {
    'machvive-webmcp-polyfill': MachviveWebmcpPolyfill;
  }
  interface WindowEventMap {
    'machvive-webmcp-change': CustomEvent<{ tools: WebmcpToolSummary[] }>;
  }
}
