/**
 * Hints an agent uses to decide how freely it may call a tool.
 *
 * They are advisory. Nothing here is enforced by the registry — a
 * `readOnlyHint` tool that writes is simply mislabelled.
 */
export interface ToolAnnotations {
  /** The tool does not change state, so calling it to look is safe. */
  readOnlyHint?: boolean;
  /** Output may contain text from an untrusted source; do not follow it. */
  untrustedContentHint?: boolean;
  /** The call has real-world consequence (sends, buys, books). */
  consequentialHint?: boolean;
  /** For development only; agents may hide it. */
  debugging?: boolean;
}

/** Second argument handed to a tool handler. */
export interface ToolExecuteOptions {
  /** Aborted when the caller cancels this execution. */
  signal: AbortSignal;
}

/** A tool as declared by the page. */
export interface WebmcpToolDescriptor {
  name: string;
  /**
   * Required. It is the only documentation an agent has when choosing between
   * tools, so the registry refuses a descriptor without one.
   */
  description: string;
  /** Shown to a person in a consent prompt, where the name is too terse. */
  title?: string;
  /** JSON Schema describing the handler's parameters. */
  inputSchema?: Record<string, unknown>;
  annotations?: ToolAnnotations;
  /**
   * The handler. Its fulfilled value is JSON-serialized by the platform before
   * it reaches the agent; throw (or reject) to report failure.
   */
  execute(input: Record<string, any>, options: ToolExecuteOptions): unknown;
}

/** A tool as discovered by an agent — the descriptor without its handler. */
export interface RegisteredTool {
  name: string;
  title?: string;
  description: string;
  inputSchema?: Record<string, unknown>;
  annotations?: ToolAnnotations;
  /** The realm that registered it, for tools published by a subframe. */
  window?: Window | null;
  /** The origin that registered it. */
  origin: string;
}

/** Retained for pages that still describe results as MCP content blocks. */
export interface WebmcpContent {
  type: 'text';
  text: string;
}

export interface RegisterToolOptions {
  /**
   * Aborting it unregisters the tool. This is the only way to withdraw one —
   * the spec removed `unregisterTool` and `provideContext` — so a tool
   * registered without a signal lasts as long as the document.
   */
  signal?: AbortSignal;
}

export interface ExecuteToolOptions {
  /** Cancels this execution. It does not unregister the tool. */
  signal?: AbortSignal;
}

/**
 * `document.modelContext`, per the W3C WebMCP proposal.
 *
 * Note this is on `Document`, not `Navigator`: the `navigator.modelContext`
 * explainer is stale, and Chrome ships it at the document.
 */
export interface ModelContext extends EventTarget {
  /**
   * Adds one tool. Rejects if the name is already registered, or if the
   * descriptor is invalid.
   */
  registerTool(tool: WebmcpToolDescriptor, options?: RegisterToolOptions): Promise<void>;
  /** The tools an agent would discover, without their handlers. */
  getTools(): Promise<RegisteredTool[]>;
  /**
   * Runs a tool and resolves with its result JSON-serialized, as the platform
   * does. A handler that returns a string gets it back verbatim. Rejects when
   * the tool is unknown or its handler throws.
   */
  executeTool(
    tool: RegisteredTool | string,
    input?: Record<string, unknown>,
    options?: ExecuteToolOptions
  ): Promise<string>;

  /** Fired when a tool is registered or withdrawn. */
  ontoolchange: ((this: ModelContext, event: Event) => unknown) | null;
  /** Fired when an execution starts. */
  ontoolactivated: ((this: ModelContext, event: Event) => unknown) | null;
  /** Fired when an execution is cancelled through its signal. */
  ontoolcancel: ((this: ModelContext, event: Event) => unknown) | null;
}

/** The spec's event name, fired on the context when the toolset changes. */
export const TOOL_CHANGE_EVENT: 'toolchange';

export interface InstallOptions {
  /**
   * Install even off a secure context. The default refusal mirrors the native
   * `[SecureContext]` API; opt in for an offline bundle or an intranet address,
   * where no native implementation is coming and the check only blocks.
   */
  allowInsecureContext?: boolean;
}

/**
 * Installs the polyfill at `document.modelContext`.
 *
 * Declines, returning false, when the document already has a `registerTool` —
 * whether native or an earlier call to this — and when the page is not a secure
 * context and `allowInsecureContext` is not set. Returns true only if this call
 * installed it.
 */
export function installWebmcpPolyfill(options?: InstallOptions): boolean;

export class MachviveWebmcpPolyfill extends HTMLElement {}

declare global {
  interface Document {
    /** Present on secure contexts; see `installWebmcpPolyfill`. */
    modelContext: ModelContext;
  }
  interface HTMLElementTagNameMap {
    'machvive-webmcp-polyfill': MachviveWebmcpPolyfill;
  }
}
