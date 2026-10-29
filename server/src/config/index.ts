/**
 * Environment and trusted-local configuration validation (T013).
 *
 * One pure entry point so tests can pass a synthetic env. Rules:
 * - Credential source detection in precedence order (GH_TOKEN → GITHUB_TOKEN
 *   → gh CLI). Only the source name is ever reported; values stay in memory.
 * - AI settings are optional; a missing model or base URL just disables AI
 *   review. Destination disclosure derives from the base URL only.
 * - Validation errors throw `ConfigError` so startup (T028) can refuse to
 *   boot with a precise, secret-free message.
 */
import { LIMITS, type CredentialSource } from '@pr-review-dashboard/shared';
import { createRequire } from 'node:module';
import { z } from 'zod';
import { resolveAppPaths, type AppPaths } from './paths.js';

export type { CredentialSource } from '@pr-review-dashboard/shared';

export interface CredentialConfig {
  readonly source: CredentialSource;
  /** Token value; never logged or persisted. Null when resolved later via gh CLI (T025). */
  readonly token: string | null;
  /** True when the token must still be resolved from the authenticated gh CLI session. */
  readonly pendingCliResolution: boolean;
}

export interface AiConfig {
  readonly baseUrl: string | null;
  readonly model: string | null;
  readonly hasApiKey: boolean;
  readonly timeoutMs: number;
  readonly maxContextChars: number;
  readonly priceInputPerMTok: number | null;
  readonly priceOutputPerMTok: number | null;
  /** True when the destination endpoint could be determined (FR-008/025). */
  readonly destinationKnown: boolean;
  /** Siloed label like `http://127.0.0.1:11434/v1`; null when unknown. */
  readonly destinationLabel: string | null;
  /** True when the disclosed destination is outside this machine. */
  readonly mayLeaveMachine: boolean;
}

export interface AppConfig {
  readonly credential: CredentialConfig;
  readonly ai: AiConfig;
  readonly port: number;
  readonly dataRoot: string;
  readonly paths: AppPaths;
  readonly appVersion: string;
}

/** Kept in sync with the root package.json; startup logging never embeds secrets. */
export const DEFAULT_PORT = 0;

export class ConfigError extends Error {}

const envSchema = z.object({
  GH_TOKEN: z.string().min(1).optional(),
  GITHUB_TOKEN: z.string().min(1).optional(),
  AI_BASE_URL: z.string().min(1).optional(),
  AI_MODEL: z.string().min(1).optional(),
  AI_API_KEY: z.string().min(1).optional(),
  AI_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(3_600_000).optional(),
  AI_MAX_CONTEXT_CHARS: z.coerce.number().int().min(1).max(LIMITS.maxAiContextChars).optional(),
  AI_PRICE_INPUT_PER_MTOK: z.coerce.number().min(0).max(10_000).optional(),
  AI_PRICE_OUTPUT_PER_MTOK: z.coerce.number().min(0).max(10_000).optional(),
  PORT: z.coerce.number().int().min(0).max(65_535).optional(),
  APP_DATA_DIR: z.string().min(1).optional(),
});

export type RawEnv = z.infer<typeof envSchema>;

/**
 * Prefer loopback endpoints for the "code leaves the machine" disclosure
 * (FR-008): anything that is not a known loopback host counts as remote.
 */
function isLoopbackUrl(url: URL): boolean {
  const host = url.hostname.toLowerCase();
  return host === '127.0.0.1' || host === 'localhost' || host === '[::1]' || host === '::1';
}

export function detectCredentialSource(env: RawEnv): CredentialConfig {
  if (env.GH_TOKEN !== undefined && env.GITHUB_TOKEN !== undefined) {
    // Precedence is explicit; still deterministic rather than accidental.
    return { source: 'GH_TOKEN', token: env.GH_TOKEN, pendingCliResolution: false };
  }
  if (env.GH_TOKEN !== undefined) {
    return { source: 'GH_TOKEN', token: env.GH_TOKEN, pendingCliResolution: false };
  }
  if (env.GITHUB_TOKEN !== undefined) {
    return { source: 'GITHUB_TOKEN', token: env.GITHUB_TOKEN, pendingCliResolution: false };
  }
  // No env token: attempt at runtime through the authenticated gh session.
  return { source: 'gh_cli', token: null, pendingCliResolution: true };
}

export function buildAiConfig(env: RawEnv): AiConfig {
  let baseUrlInternal: URL | null = null;
  if (env.AI_BASE_URL !== undefined) {
    try {
      baseUrlInternal = new URL(env.AI_BASE_URL);
    } catch {
      throw new ConfigError('AI_BASE_URL is not a valid absolute URL');
    }
    if (baseUrlInternal.protocol !== 'http:' && baseUrlInternal.protocol !== 'https:') {
      throw new ConfigError('AI_BASE_URL must use http or https');
    }
    if (baseUrlInternal.username !== '' || baseUrlInternal.password !== '') {
      throw new ConfigError('AI_BASE_URL must not carry inline credentials');
    }
  }
  const baseConfigured = baseUrlInternal !== null;
  const modelConfigured = env.AI_MODEL !== undefined;

  if (baseConfigured !== modelConfigured) {
    throw new ConfigError(
      modelConfigured
        ? 'AI_MODEL set without AI_BASE_URL; set both variables or neither'
        : 'AI_BASE_URL set without AI_MODEL; set both variables or neither',
    );
  }

  const destinationUrl = baseUrlInternal;
  return {
    baseUrl: destinationUrl?.toString() ?? null,
    // Reachable only after the paired-variable guard above: both set or both absent.
    model: env.AI_MODEL ?? null,
    hasApiKey: env.AI_API_KEY !== undefined,
    timeoutMs: env.AI_TIMEOUT_MS ?? 180_000,
    maxContextChars: env.AI_MAX_CONTEXT_CHARS ?? LIMITS.maxAiContextChars,
    priceInputPerMTok: env.AI_PRICE_INPUT_PER_MTOK ?? null,
    priceOutputPerMTok: env.AI_PRICE_OUTPUT_PER_MTOK ?? null,
    destinationKnown: destinationUrl !== null,
    destinationLabel:
      destinationUrl === null
        ? null
        : `${destinationUrl.protocol}//${destinationUrl.host}${destinationUrl.pathname}`.replace(
            /\/$/,
            '',
          ),
    mayLeaveMachine: destinationUrl !== null && !isLoopbackUrl(destinationUrl),
  };
}

/** Load and validate configuration from a raw environment (defaults to process.env). */
export function loadConfig(env: NodeJS.Dict<string> = process.env): AppConfig {
  const parsed = envSchema.safeParse({
    GH_TOKEN: env['GH_TOKEN'],
    GITHUB_TOKEN: env['GITHUB_TOKEN'],
    AI_BASE_URL: env['AI_BASE_URL'],
    AI_MODEL: env['AI_MODEL'],
    AI_API_KEY: env['AI_API_KEY'],
    AI_TIMEOUT_MS: env['AI_TIMEOUT_MS'],
    AI_MAX_CONTEXT_CHARS: env['AI_MAX_CONTEXT_CHARS'],
    AI_PRICE_INPUT_PER_MTOK: env['AI_PRICE_INPUT_PER_MTOK'],
    AI_PRICE_OUTPUT_PER_MTOK: env['AI_PRICE_OUTPUT_PER_MTOK'],
    PORT: env['PORT'],
    APP_DATA_DIR: env['APP_DATA_DIR'],
  });
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const at = issue === undefined ? '' : ` (${issue.path.join('.')})`;
    throw new ConfigError(`Invalid environment configuration${at}: ${issue?.message ?? 'unknown'}`);
  }

  const paths = resolveAppPaths(parsed.data.APP_DATA_DIR);
  return {
    credential: detectCredentialSource(parsed.data),
    ai: buildAiConfig(parsed.data),
    port: parsed.data.PORT ?? DEFAULT_PORT,
    dataRoot: paths.dataRoot,
    paths,
    appVersion: readAppVersionCached(),
  };
}

let cachedAppVersion: string | null = null;

function readAppVersionCached(): string {
  if (cachedAppVersion !== null) return cachedAppVersion;
  try {
    const require = createRequire(import.meta.url);
    const pkg = require('../../package.json') as { version?: string };
    cachedAppVersion = pkg.version ?? '0.0.0';
    return cachedAppVersion;
  } catch {
    cachedAppVersion = '0.0.0';
    return cachedAppVersion;
  }
}

/** Data-root helper re-exported for tests that build paths before config load. */
export { resolveAppPaths } from './paths.js';
export type { AppPaths };
export { defaultDataRoot } from './paths.js';
