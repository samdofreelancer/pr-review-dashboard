/**
 * Preview and publish payload schemas (US4).
 */
import { z } from 'zod';
import { LIMITS } from '../limits/index.js';
import { DRAFT_EVENTS, FINDING_SIDES, POST_STATUSES } from '../types/domain.js';
import { EmbeddedErrorSchema } from './error.js';

export const PreviewTargetPrSchema = z
  .object({
    number: z.number().int().optional(),
    title: z.string().optional(),
    repository: z.string().optional(),
  })
  .strict();
export type PreviewTargetPr = z.infer<typeof PreviewTargetPrSchema>;

export const InlineCommentSchema = z
  .object({
    path: z.string(),
    side: z.enum(FINDING_SIDES),
    line: z.number().int().min(1),
    body: z.string().max(LIMITS.maxInlineCommentChars),
  })
  .strict();
export type InlineComment = z.infer<typeof InlineCommentSchema>;

export const PreviewSchema = z
  .object({
    draftId: z.string(),
    pr: PreviewTargetPrSchema.optional(),
    event: z.enum(DRAFT_EVENTS),
    headSha: z.string(),
    headVerified: z.boolean(),
    summary: z.string(),
    inlineComments: z.array(InlineCommentSchema),
    warnings: z.array(z.string()),
    omittedFindings: z.number().int(),
    /** 10-minute confirmation token; only its presence crosses the wire. */
    previewToken: z.string(),
    expiresAt: z.string().datetime(),
  })
  .strict();
export type Preview = z.infer<typeof PreviewSchema>;

export const PublishRequestSchema = z
  .object({
    previewToken: z.string(),
    confirmed: z.literal(true),
  })
  .strict();
export type PublishRequest = z.infer<typeof PublishRequestSchema>;

export const PublishResultSchema = z
  .object({
    postId: z.string(),
    status: z.enum(POST_STATUSES),
    githubReviewId: z.string().nullable().optional(),
    url: z.string().nullable().optional(),
    /** Short fallback marker such as `anchors_demoted` (contracts/events.md). */
    fallback: z.string().nullable().optional(),
    error: EmbeddedErrorSchema.optional(),
  })
  .strict();
export type PublishResult = z.infer<typeof PublishResultSchema>;
