/**
 * Error payload shared by every problem response (openapi `Error`).
 */
import { z } from 'zod';
import { ERROR_CODES } from '../types/domain.js';

export const ErrorSchema = z
  .object({
    code: z.enum(ERROR_CODES),
    message: z.string(),
    details: z.record(z.string(), z.unknown()).optional(),
    retryAfter: z.string().datetime().nullable().optional(),
  })
  .strict();

export type ApiError = z.infer<typeof ErrorSchema>;

/** Nested error shape used inside SyncRun/ReviewRun/DiffStatus/PublishResult. */
export const EmbeddedErrorSchema = ErrorSchema.nullable();
export type EmbeddedError = z.infer<typeof EmbeddedErrorSchema>;
