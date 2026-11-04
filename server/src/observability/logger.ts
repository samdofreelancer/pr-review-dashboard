/**
 * Redacting structured logger (T015, FR-090/095).
 *
 * JSON-lines out through a pluggable sink (console in dev, `logs/app.log` at
 * startup in T028). Everything crossing the boundary goes through the
 * redaction pipeline: keys that name secrets get `[REDACTED]`, string values
 * with credential shapes are masked, private key material is collapsed, and
 * callers must pass denylisted file content through `redactContent()` so it
 * never lands raw in a log line.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogRecord {
  readonly time: string;
  readonly level: LogLevel;
  readonly msg: string;
  readonly [extra: string]: unknown;
}

export type LogSink = (record: LogRecord) => void;

/** Replacement marker; stable token for tests. */
export const REDACTED = '[REDACTED]';

/** Keys carrying plausible credentials; `promptTokens` etc. are counters, not keys, and excluded. */
const SECRET_KEY_RE =
  /(^|_)(token|api[-_]?key|access[_-]?token|auth(?:orization)?|password|secret|cookie|credential|private[_-]?key)($|_)/i;

const SECRET_VALUE_PATTERNS: readonly RegExp[] = [
  /Bearer\s+[A-Za-z0-9\-._~+/=]{8,}/g,
  /gh[pousr]_[A-Za-z0-9]{20,}/g,
  /github_pat_[A-Za-z0-9_]{20,}/g,
  /xox[baprs]-[A-Za-z0-9-]{10,}/g,
  /sk-(?:proj-|svcacct-)?[A-Za-z0-9-]{15,}/g,
  /AIza[0-9A-Za-z_-]{25,}/g,
  /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}/g,
  /(?:access_token|token|api_key|apikey|key|secret|password)=[A-Za-z0-9\-._]{8,}/gi,
];

/** Private key PEM blocks are collapsed to a length-neutral marker. */
const PRIVATE_KEY_BLOCK_RE =
  /-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/g;

function maskSecretValue(value: string): string {
  let text = value.replace(PRIVATE_KEY_BLOCK_RE, `${REDACTED} (private key)`);
  for (const pattern of SECRET_VALUE_PATTERNS) {
    text = text.replace(pattern, (match) => `${match.slice(0, 4)}${REDACTED}`);
  }
  return text;
}

/** Redact any credential-shaped text: used for messages and free-form strings. */
export function redactString(text: string): string {
  return maskSecretValue(text);
}

/**
 * Redact file content fetched from denylisted paths before any log write
 * (FR-095): everything is dropped, not pattern-masked, so secrets in
 * `.env`-style files cannot partially survive.
 */
export function redactContent(content: string): string {
  return `${REDACTED} (${Buffer.byteLength(content)} bytes of denylisted content)`;
}

/** Deep redaction of arbitrary values: recursive keys and strings. */
export function redactValue<T>(value: T): unknown {
  if (typeof value === 'string') return maskSecretValue(value);
  if (Array.isArray(value)) return value.map((item) => redactValue(item));
  if (value !== null && typeof value === 'object') {
    const source = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(source)) {
      out[key] = SECRET_KEY_RE.test(key) ? maskSecretValue(String(item)) : redactValue(item);
    }
    return out;
  }
  return value;
}

function consoleSink(record: LogRecord): void {
  const method = record.level === 'error' ? 'error' : record.level === 'warn' ? 'warn' : 'log';
  console[method](JSON.stringify(record));
}

export interface Logger {
  readonly debug: (msg: string, data?: Record<string, unknown>) => void;
  readonly info: (msg: string, data?: Record<string, unknown>) => void;
  readonly warn: (msg: string, data?: Record<string, unknown>) => void;
  readonly error: (msg: string, data?: Record<string, unknown>) => void;
  /** Emit a pre-built record; data already redacted by createLogger callers. */
  readonly log: (record: LogRecord) => void;
}

export function createLogger(
  options: { level?: LogLevel; sinks?: readonly LogSink[]; fields?: Record<string, unknown> } = {},
): Logger {
  const levelOrder: readonly LogLevel[] = ['debug', 'info', 'warn', 'error'];
  const threshold = options.level ?? 'info';
  const sinks = options.sinks ?? [consoleSink];
  const baseFields = options.fields ?? {};

  function emit(level: LogLevel, msg: string, data?: Record<string, unknown>): void {
    if (levelOrder.indexOf(level) < levelOrder.indexOf(threshold)) return;
    const record: LogRecord = {
      time: new Date().toISOString(),
      level,
      msg: maskSecretValue(msg),
      ...(redactValue({ ...baseFields, ...data }) as Record<string, unknown>),
    };
    for (const sink of sinks) sink(record);
  }

  return {
    debug: (msg, data) => emit('debug', msg, data),
    info: (msg, data) => emit('info', msg, data),
    warn: (msg, data) => emit('warn', msg, data),
    error: (msg, data) => emit('error', msg, data),
    log: (record) => {
      for (const sink of sinks) sink(record);
    },
  };
}

/** Standard stderr sink adapter for startup-time failures that precede file logging. */
export function stderrSink(record: LogRecord): void {
  console.error(JSON.stringify(record));
}
