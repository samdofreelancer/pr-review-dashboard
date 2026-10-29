/**
 * Session bootstrap and health readiness payload schemas.
 */
import { z } from 'zod';
import { LIMITS } from '../limits/index.js';
import { DATABASE_STATUSES, HEALTH_STATUSES } from '../types/domain.js';

/** AI disclosure summary; `destinationLabel` is null when unknown (FR-008). */
export const SessionAiSchema = z
  .object({
    configured: z.boolean(),
    destinationKnown: z.boolean(),
    destinationLabel: z.string().nullable().optional(),
    model: z.string(),
    mayLeaveMachine: z.boolean(),
  })
  .strict();
export type SessionAi = z.infer<typeof SessionAiSchema>;

/** Limits echoed to the web so the UI shares the server's exact budgets. */
export const SessionLimitsSchema = z
  .object({
    maxInlineFindings: z.literal(LIMITS.maxInlineFindings),
    maxSummaryChars: z.literal(LIMITS.maxSummaryChars),
    maxInlineCommentChars: z.literal(LIMITS.maxInlineCommentChars),
    maxDiffFiles: z.literal(LIMITS.maxDiffFiles),
    maxDiffLines: z.literal(LIMITS.maxDiffLines),
  })
  .strict();
export type SessionLimits = z.infer<typeof SessionLimitsSchema>;

export const SessionSchema = z
  .object({
    csrfToken: z.string(),
    appVersion: z.string(),
    ai: SessionAiSchema,
    limits: SessionLimitsSchema,
  })
  .strict();
export type Session = z.infer<typeof SessionSchema>;

export const HealthSchema = z
  .object({
    status: z.enum(HEALTH_STATUSES),
    git: z
      .object({
        available: z.boolean(),
        version: z.string().nullable(),
      })
      .strict(),
    database: z.enum(DATABASE_STATUSES),
    online: z.boolean(),
  })
  .strict();
export type Health = z.infer<typeof HealthSchema>;
