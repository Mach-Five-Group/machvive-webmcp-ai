import type { WebmcpToolResult } from '../machvive-webmcp-polyfill/machvive-webmcp-polyfill.js';

/** One captured tool invocation. */
export interface CapturedCall {
  id: string;
  tool: string;
  params?: unknown;
  result?: unknown;
  error?: string;
  status: 'ok' | 'error';
  startedAt: string;
  durationMs: number;
  pushedToDataLayer?: boolean;
}

export interface CallLogOptions {
  /** Max entries retained; oldest are evicted first. Default 500. */
  limit?: number;
  /** Persist to IndexedDB. Default true. */
  persist?: boolean;
}

export interface CallLogChangeEvent {
  type: 'change';
  detail: {
    reason: 'add' | 'update' | 'remove' | 'clear' | 'import' | 'restore';
    entry: CapturedCall | null;
    entries: CapturedCall[];
  };
}

export class CallLog {
  constructor(options?: CallLogOptions);
  /** Resolves once entries have been loaded from IndexedDB. */
  readonly ready: Promise<void>;
  /** True when entries are being written to IndexedDB. */
  readonly persistent: boolean;
  readonly entries: CapturedCall[];
  readonly size: number;
  addEventListener(type: 'change', listener: (e: CallLogChangeEvent) => void): void;
  removeEventListener(type: 'change', listener: (e: CallLogChangeEvent) => void): void;
  add(entry: Omit<CapturedCall, 'id'>): CapturedCall;
  update(id: string, patch: Partial<CapturedCall>): CapturedCall | null;
  remove(id: string): boolean;
  clear(): void;
  toJSON(space?: number): string;
  /** Merges a previously exported log; returns how many entries were added. */
  import(json: string | { entries: CapturedCall[] }): number;
  /** Re-invokes a captured call, optionally with edited params. */
  replay(id: string, params?: Record<string, unknown>): Promise<WebmcpToolResult>;
  /** Pushes one entry to window.dataLayer. */
  pushToDataLayer(id: string): boolean;
}

/** Shared log used by every <machvive-webmcp-analytics> on the page. */
export const callLog: CallLog;

/** Event dispatched on window whenever the log changes. */
export const CALL_EVENT: 'machvive-webmcp-call';
export const DB_NAME: 'machvive-webmcp';
export const STORE_NAME: 'calls';

/**
 * Instruments navigator.modelContext so future registrations are captured.
 * Tools registered before this runs cannot be instrumented.
 */
export function installAnalytics(log?: CallLog): boolean;

export class MachviveWebmcpAnalytics extends HTMLElement {
  readonly log: CallLog;
}

declare global {
  interface HTMLElementTagNameMap {
    'machvive-webmcp-analytics': MachviveWebmcpAnalytics;
  }
  interface WindowEventMap {
    'machvive-webmcp-call': CustomEvent<{ reason: string; entry: CapturedCall | null }>;
  }
  interface Window {
    dataLayer?: unknown[];
  }
}
