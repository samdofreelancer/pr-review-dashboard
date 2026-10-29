/**
 * API error mapping (T022).
 *
 * Every route throws `AppError` with one of the shared `ERROR_CODES` (or lets
 * Zod/Fastify validation failures escape); this module turns any thrown value
 * into the contract `Error` payload and a matching HTTP status. Messages and
 * details are redacted so a stray token can never reach the client.
 */
import { ErrorSchema, type ApiError, type ErrorCode } from '@pr-review-dashboard/shared';
import type { FastifyError, FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import { redactString, redactValue } from '../observability/logger.js';

const STATUS_BY_CODE: Readonly<Record<ErrorCode, number>> = {
  AUTH_MISSING: 401,
  AUTH_INVALID: 401,
  PERMISSION_DENIED: 403,
  RATE_LIMITED: 429,
  OFFLINE: 503,
  NOT_FOUND: 404,
  CONFLICT: 409,
  STALE_HEAD: 409,
  PR_CLOSED: 409,
  PREVIEW_EXPIRED: 409,
  PREVIEW_MISMATCH: 409,
  PUBLISH_IN_FLIGHT: 409,
  AI_FAILED: 502,
  AI_INVALID_OUTPUT: 422,
  GIT_MISSING: 503,
  GIT_PREP_FAILED: 503,
  SECRET_EXCLUDED: 422,
  VALIDATION_FAILED: 422,
  INTERNAL: 500,
};

export interface AppErrorOptions {
  readonly statusCode?: number;
  readonly details?: Record<string, unknown>;
  /** ISO timestamp; also used to derive the `Retry-After` header. */
  readonly retryAfter?: string | null;
  readonly cause?: unknown;
}

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly statusCode: number;
  readonly details: Record<string, unknown> | undefined;
  readonly retryAfter: string | null | undefined;

  constructor(code: ErrorCode, message: string, options: AppErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'AppError';
    this.code = code;
    this.statusCode = options.statusCode ?? STATUS_BY_CODE[code];
    this.details = options.details;
    this.retryAfter = options.retryAfter;
  }
}

export interface MappedError {
  readonly statusCode: number;
  readonly body: ApiError;
}

function buildBody(
  code: ErrorCode,
  message: string,
  details?: Record<string, unknown>,
  retryAfter?: string | null,
): ApiError {
  const body: ApiError = { code, message: redactString(message) };
  if (details !== undefined) {
    body.details = redactValue(details) as Record<string, unknown>;
  }
  if (retryAfter !== undefined && retryAfter !== null) {
    body.retryAfter = retryAfter;
  }
  return ErrorSchema.parse(body);
}

function validationDetails(issues: readonly { path: (string | number)[]; message: string }[]) {
  return {
    issues: issues.map((issue) => ({
      path: issue.path.join('.'),
      message: redactString(issue.message),
    })),
  };
}

/** Map any thrown value to the HTTP status and contract error body. */
export function toApiError(error: unknown): MappedError {
  if (error instanceof AppError) {
    return {
      statusCode: error.statusCode,
      body: buildBody(error.code, error.message, error.details, error.retryAfter),
    };
  }

  if (error instanceof ZodError) {
    return {
      statusCode: 422,
      body: buildBody(
        'VALIDATION_FAILED',
        'Request validation failed.',
        validationDetails(error.issues),
      ),
    };
  }

  const fastifyError = error as Partial<FastifyError> | null;
  if (fastifyError !== null && typeof fastifyError === 'object') {
    if (Array.isArray(fastifyError.validation) && fastifyError.validation.length > 0) {
      return {
        statusCode: 422,
        body: buildBody(
          'VALIDATION_FAILED',
          fastifyError.message ?? 'Request validation failed.',
          validationDetails(
            fastifyError.validation.map((issue) => ({
              path: issue.instancePath.split('/').filter((part) => part.length > 0),
              message: issue.message ?? 'Invalid value',
            })),
          ),
        ),
      };
    }
    if (fastifyError.statusCode === 404) {
      return { statusCode: 404, body: buildBody('NOT_FOUND', 'Resource not found.') };
    }
    if (fastifyError.statusCode === 413) {
      return {
        statusCode: 413,
        body: buildBody('VALIDATION_FAILED', 'Request body is too large.'),
      };
    }
    if (fastifyError.statusCode === 415) {
      return {
        statusCode: 415,
        body: buildBody('VALIDATION_FAILED', 'Unsupported request content type.'),
      };
    }
  }

  return { statusCode: 500, body: buildBody('INTERNAL', 'Unexpected server error.') };
}

/** Install the shared error and 404 handlers. */
export function registerErrorHandling(app: FastifyInstance): void {
  app.setErrorHandler((error, request, reply) => {
    const mapped = toApiError(error);
    if (mapped.statusCode >= 500) {
      request.log.error(
        {
          code: mapped.body.code,
          detail: redactString(error instanceof Error ? error.message : String(error)),
        },
        'Request failed',
      );
    }
    if (mapped.body.retryAfter !== undefined && mapped.body.retryAfter !== null) {
      const waitMs = Date.parse(mapped.body.retryAfter) - Date.now();
      reply.header('retry-after', String(Math.max(0, Math.ceil(waitMs / 1000))));
    }
    void reply.code(mapped.statusCode).send(mapped.body);
  });

  app.setNotFoundHandler((_request, reply) => {
    void reply.code(404).send(buildBody('NOT_FOUND', 'Resource not found.'));
  });
}
