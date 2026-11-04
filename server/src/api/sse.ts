/**
 * Server-sent event hub (T023, contracts/events.md).
 *
 * One process-wide hub fans out sync/review/publish progress to every open
 * tab. Each connection receives an immediate `ready` frame, then domain
 * events, plus a comment heartbeat every 15 seconds. Frame order is preserved
 * per connection; a slow consumer may miss intermediate progress frames and
 * must refetch the authoritative state after a `*.completed` event.
 */
import type { SseName } from '@pr-review-dashboard/shared';
import type { ServerResponse } from 'node:http';

export const HEARTBEAT_INTERVAL_MS = 15_000;

const EVENT_NAME_RE = /^[a-z][a-z.]*$/;

export function formatSseFrame(event: string, data: unknown): string {
  if (!EVENT_NAME_RE.test(event)) {
    throw new Error(`Invalid SSE event name: ${JSON.stringify(event)}`);
  }
  // JSON.stringify keeps the payload on one physical line (newlines are escaped).
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export function formatHeartbeat(): string {
  return ': ping\n\n';
}

export interface SseHubOptions {
  readonly appVersion: string;
  readonly heartbeatMs?: number;
  readonly now?: () => Date;
}

export class SseHub {
  readonly appVersion: string;
  private readonly heartbeatMs: number;
  private readonly now: () => Date;
  private readonly clients = new Set<ServerResponse>();
  private heartbeat: NodeJS.Timeout | null = null;

  constructor(options: SseHubOptions) {
    this.appVersion = options.appVersion;
    this.heartbeatMs = options.heartbeatMs ?? HEARTBEAT_INTERVAL_MS;
    this.now = options.now ?? (() => new Date());
  }

  get clientCount(): number {
    return this.clients.size;
  }

  /**
   * Start an already-upgraded response stream. The caller writes the SSE
   * headers first; this sends the `ready` frame and registers cleanup.
   */
  attach(res: ServerResponse): () => void {
    this.clients.add(res);
    this.ensureHeartbeat();

    let attached = true;
    const detach = (): void => {
      if (!attached) return;
      attached = false;
      this.removeClient(res);
    };

    res.on('close', detach);
    res.on('error', detach);
    this.write(res, formatSseFrame('ready', this.readyPayload()));
    return detach;
  }

  broadcast(event: SseName, data: Record<string, unknown>): void {
    const frame = formatSseFrame(event, data);
    // Snapshot: a failed write detaches the client mid-iteration.
    for (const client of [...this.clients]) {
      this.write(client, frame);
    }
  }

  close(): void {
    this.stopHeartbeat();
    for (const client of [...this.clients]) {
      this.clients.delete(client);
      try {
        client.end();
      } catch {
        // The socket may already be gone; nothing to clean up.
      }
    }
  }

  private readyPayload(): Record<string, unknown> {
    return { serverTime: this.now().toISOString(), appVersion: this.appVersion };
  }

  private write(res: ServerResponse, chunk: string): void {
    if (res.writableEnded || res.destroyed) {
      this.removeClient(res);
      return;
    }
    try {
      res.write(chunk);
    } catch {
      this.removeClient(res);
    }
  }

  private removeClient(res: ServerResponse): void {
    this.clients.delete(res);
    if (this.clients.size === 0) this.stopHeartbeat();
  }

  private ensureHeartbeat(): void {
    if (this.heartbeat !== null || this.clients.size === 0) return;
    this.heartbeat = setInterval(() => {
      if (this.clients.size === 0) {
        this.stopHeartbeat();
        return;
      }
      for (const client of [...this.clients]) {
        this.write(client, formatHeartbeat());
      }
    }, this.heartbeatMs);
    this.heartbeat.unref();
  }

  private stopHeartbeat(): void {
    if (this.heartbeat === null) return;
    clearInterval(this.heartbeat);
    this.heartbeat = null;
  }
}

export function createSseHub(options: SseHubOptions): SseHub {
  return new SseHub(options);
}
