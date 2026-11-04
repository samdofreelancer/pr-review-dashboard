/**
 * Review draft payload schemas: live counts and publishability (US3/US4).
 */
import { z } from 'zod';
import { DRAFT_EVENTS, DRAFT_ORIGINS, DRAFT_STATUSES } from '../types/domain.js';
import { DraftFindingSchema } from './review.js';

export const DraftCountsSchema = z
  .object({
    inline: z.number().int(),
    summaryOnly: z.number().int(),
    demoted: z.number().int(),
    stale: z.number().int(),
  })
  .strict();
export type DraftCounts = z.infer<typeof DraftCountsSchema>;

export const PublishabilitySchema = z
  .object({
    publishable: z.boolean(),
    /** Blocked reasons map to FR-030/070/076/078; destined for the UI banner text. */
    reasons: z.array(z.string()),
  })
  .strict();
export type Publishability = z.infer<typeof PublishabilitySchema>;

export const ReviewDraftSchema = z
  .object({
    id: z.string(),
    prId: z.string(),
    /** `manual` drafts exist without an AI run; `runId` is then null (data-model.md). */
    origin: z.enum(DRAFT_ORIGINS),
    runId: z.string().nullable(),
    summary: z.string().max(60_000),
    event: z.enum(DRAFT_EVENTS),
    status: z.enum(DRAFT_STATUSES),
    targetHeadSha: z.string(),
    findings: z.array(DraftFindingSchema),
    counts: DraftCountsSchema,
    publishability: PublishabilitySchema,
    updatedAt: z.string().datetime().optional(),
  })
  .strict();
export type ReviewDraft = z.infer<typeof ReviewDraftSchema>;

export const DraftPatchSchema = z
  .object({
    summary: z.string().max(60_000).optional(),
    event: z.enum(DRAFT_EVENTS).optional(),
  })
  .strict();
export type DraftPatch = z.infer<typeof DraftPatchSchema>;
