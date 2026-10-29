/**
 * Loopback-only request security (T021).
 *
 * A localhost HTTP server is reachable by every local process and by
 * malicious pages through the browser, so three independent checks run on
 * every request:
 * - Host must name a loopback hostname (DNS-rebinding defense).
 * - A present Origin must be same-origin with the request Host.
 * - Mutations must carry the in-memory CSRF token from `GET /api/session`.
 *
 * No CORS headers are ever emitted: a cross-origin page can issue a request
 * but cannot read `/api/session` to obtain the token. Responses carry a strict
 * CSP plus anti-framing and sniffing headers.
 */
import type { FastifyInstance } from 'fastify';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { AppError } from '../api/errors.js';

export const CSRF_HEADER = 'x-csrf-token';
export const CSRF_TOKEN_BYTES = 32;

/** Hostnames that resolve to this machine; ports are intentionally unrestricted for dev proxying. */
const LOOPBACK_HOSTNAMES: ReadonlySet<string> = new Set([
  '127.0.0.1',
  'localhost',
  '::1',
  '0:0:0:0:0:0:0:1',
]);

const SAFE_METHODS: ReadonlySet<string> = new Set(['GET', 'HEAD', 'OPTIONS']);

const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "base-uri 'none'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https://avatars.githubusercontent.com https://*.githubusercontent.com",
  "font-src 'self' data:",
  "connect-src 'self'",
  "manifest-src 'self'",
  "worker-src 'none'",
].join('; ');

/** Headers applied to every non-hijacked response; SSE adds its own content type. */
export const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  'content-security-policy': CONTENT_SECURITY_POLICY,
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'no-referrer',
  'cross-origin-resource-policy': 'same-origin',
  'cross-origin-opener-policy': 'same-origin',
  'permissions-policy': 'camera=(), microphone=(), geolocation=()',
};

interface ParsedAuthority {
  readonly hostname: string;
  readonly port: string;
}

function parseAuthority(value: string): ParsedAuthority | null {
  if (value.length === 0 || /[\s/\\]/.test(value)) return null;
  try {
    const url = new URL(`http://${value}`);
    const hostname = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
    if (hostname.length === 0 || url.username !== '' || url.password !== '') return null;
    return { hostname, port: url.port };
  } catch {
    return null;
  }
}

function parseOrigin(value: string): ParsedAuthority | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (url.username !== '' || url.password !== '') return null;
  return {
    hostname: url.hostname.replace(/^\[|\]$/g, '').toLowerCase(),
    port: url.port,
  };
}

function isLoopbackHostname(hostname: string): boolean {
  return LOOPBACK_HOSTNAMES.has(hostname);
}

/** Timing-safe comparison via fixed-size digests, so length never leaks. */
export function constantTimeEqual(left: string, right: string): boolean {
  const leftDigest = createHash('sha256').update(left, 'utf8').digest();
  const rightDigest = createHash('sha256').update(right, 'utf8').digest();
  return timingSafeEqual(leftDigest, rightDigest);
}

export function generateCsrfToken(): string {
  return randomBytes(CSRF_TOKEN_BYTES).toString('base64url');
}

export interface LocalSecurityOptions {
  /** Override for tests; a fresh random token is generated when omitted. */
  readonly csrfToken?: string;
}

export interface LocalSecurity {
  readonly csrfToken: string;
  checkHost(hostHeader: string | undefined): boolean;
  checkOrigin(originHeader: string | undefined, hostHeader: string | undefined): boolean;
  checkCsrf(method: string, headerValue: string | string[] | undefined): boolean;
}

export function createLocalSecurity(options: LocalSecurityOptions = {}): LocalSecurity {
  const csrfToken = options.csrfToken ?? generateCsrfToken();
  return {
    csrfToken,
    checkHost(hostHeader) {
      if (hostHeader === undefined) return false;
      const authority = parseAuthority(hostHeader);
      return authority !== null && isLoopbackHostname(authority.hostname);
    },
    checkOrigin(originHeader, hostHeader) {
      // Non-browser clients may omit Origin; the CSRF token still guards them.
      if (originHeader === undefined) return true;
      if (originHeader === 'null') return false;
      const origin = parseOrigin(originHeader);
      if (origin === null || !isLoopbackHostname(origin.hostname)) return false;
      if (hostHeader === undefined) return false;
      const host = parseAuthority(hostHeader);
      if (host === null) return false;
      return origin.hostname === host.hostname && origin.port === host.port;
    },
    checkCsrf(method, headerValue) {
      if (SAFE_METHODS.has(method.toUpperCase())) return true;
      if (typeof headerValue !== 'string' || headerValue.length === 0) return false;
      return constantTimeEqual(headerValue, csrfToken);
    },
  };
}

/**
 * Fastify hooks: enforce Host/Origin/CSRF on every request and attach the
 * security headers to every response. No `Access-Control-*` header is ever
 * set, which keeps cross-origin reads impossible.
 */
export function registerLocalSecurity(app: FastifyInstance, security: LocalSecurity): void {
  // Fastify 5 requires hooks to be async or callback-style; a sync hook that
  // returns undefined never completes. `done` is therefore explicit here.
  app.addHook('onRequest', (request, _reply, done) => {
    const host = request.headers.host;
    if (!security.checkHost(host)) {
      done(new AppError('PERMISSION_DENIED', 'Requests must target this application on loopback.'));
      return;
    }
    if (!security.checkOrigin(request.headers.origin, host)) {
      done(new AppError('PERMISSION_DENIED', 'Cross-origin requests are not allowed.'));
      return;
    }
    if (!security.checkCsrf(request.method, request.headers[CSRF_HEADER])) {
      done(
        new AppError(
          'PERMISSION_DENIED',
          'Missing or invalid CSRF token; reload the application session.',
        ),
      );
      return;
    }
    done();
  });

  app.addHook('onSend', (_request, reply, payload, done) => {
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
      reply.header(name, value);
    }
    done(null, payload);
  });
}
