/**
 * App-recorded activity event schema (REST `GET /api/prs/{prId}/activity`).
 */
import { z } from 'zod';
import { ACTIVITY_TYPES } from '../types/domain.js';

export const ActivityEventSchema = z
  .object({
    id: z.string(),
    type: z.enum(ACTIVITY_TYPES),
    occurredAt: z.string().datetime(),
    summary: z.string(),
    /** Redacted summary data; never tokens, secrets, or raw model output (FR-085/095). */
    data: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();
export type ActivityEvent = z.infer<typeof ActivityEventSchema>;
