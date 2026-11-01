/**
 * Typed fetch client (T030).
 *
 * One wrapper for every REST call: relative `/api/...` paths, JSON payload
 * parsing, CSRF token attachment on mutations, and stable `ApiRequestError`
 * built from the shared `ErrorSchema` (openapi `Error`) — never raw text.
 */
import { ErrorSchema, type ApiError, type ErrorCode } from '@pr-review-dashboard/shared';

const CSRF_HEADER = 'x-csrf-token';

export class ApiRequestError extends Error {
  readonly code: ErrorCode | 'NETWORK';
  readonly status: number;
  readonly details: Record<string, unknown> | null;

  constructor(error: ApiError, status: number) {
    super(error.message);
    this.name = 'ApiRequestError';
    this.code = error.code;
    this.status = status;
    this.details = error.details ?? null;
  }
}

let csrfToken: string | null = null;

/** Called once from the session bootstrap (T030) and after any session refetch. */
export function setCsrfToken(token: string): void {
  csrfToken = token;
}

export function getCsrfToken(): string | null {
  return csrfToken;
}

function isMutation(method: string): boolean {
  return method !== 'GET' && method !== 'HEAD';
}

interface RequestOptions {
  readonly method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  readonly body?: unknown;
  readonly signal?: AbortSignal;
}

async function parseError(response: Response): Promise<ApiRequestError> {
  let parsed: ApiError;
  try {
    parsed = ErrorSchema.parse(await response.json());
  } catch {
    parsed = { code: 'INTERNAL', message: `Lỗi không xác định (HTTP ${response.status})` };
  }
  return new ApiRequestError(parsed, response.status);
}

export async function apiFetch<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const method = options.method ?? 'GET';
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  const token = csrfToken;
  if (isMutation(method)) {
    if (token === null) {
      throw new ApiRequestError(
        { code: 'VALIDATION_FAILED', message: 'Phiên chưa khởi tạo (thiếu CSRF token)' },
        0,
      );
    }
    headers[CSRF_HEADER] = token;
  }

  let response: Response;
  try {
    response = await fetch(path, {
      method,
      headers,
      ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
      ...(options.signal !== undefined ? { signal: options.signal } : {}),
    });
  } catch {
    throw new ApiRequestError(
      { code: 'OFFLINE', message: 'Không thể kết nối tới máy chủ cục bộ' },
      0,
    );
  }
  if (!response.ok) {
    throw await parseError(response);
  }
  return (await response.json()) as T;
}
