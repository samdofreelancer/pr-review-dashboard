/**
 * Pull request detail and board-action request schemas.
 */
import { z } from 'zod';
import {
  CHECKS_STATES,
  LANES as LANE_NAMES,
  MERGEABILITY_STATES,
  PR_STATES,
  PR_DIFF_STATES,
  REVIEW_DECISIONS,
} from '../types/domain.js';
import { BoardCardRepositorySchema, LabelSchema } from './board.js';

export const RequestedTeamDetailedSchema = z
  .object({
    org: z.string(),
    slug: z.string(),
    indeterminate: z.boolean().optional(),
  })
  .strict();
export type RequestedTeamDetailed = z.infer<typeof RequestedTeamDetailedSchema>;

export const PullRequestDetailSchema = z
  .object({
    id: z.string(),
    number: z.number().int(),
    title: z.string(),
    author: z.string(),
    repository: BoardCardRepositorySchema,
    lane: z.enum(LANE_NAMES),
    state: z.enum(PR_STATES).optional(),
    isDraft: z.boolean(),
    updatedAt: z.string().datetime(),
    additions: z.number().int().optional(),
    deletions: z.number().int().optional(),
    changedFiles: z.number().int().optional(),
    labels: z.array(LabelSchema).optional(),
    checksState: z.enum(CHECKS_STATES),
    mergeability: z.enum(MERGEABILITY_STATES),
    reviewDecision: z.enum(REVIEW_DECISIONS).nullable().optional(),
    requestedReviewers: z.array(z.string()).optional(),
    requestedTeams: z.array(z.string()).optional(),
    needsMyReview: z.boolean(),
    teamRequestIndeterminate: z.boolean().optional(),
    body: z.string(),
    baseRef: z.string(),
    headRef: z.string(),
    headSha: z.string(),
    baseSha: z.string(),
    requestedTeamsDetailed: z.array(RequestedTeamDetailedSchema).optional(),
    diffStatus: z.enum(PR_DIFF_STATES).optional(),
    activeRunId: z.string().nullable().optional(),
    draftId: z.string().nullable().optional(),
    lastSyncedAt: z.string().datetime(),
  })
  .strict();
export type PullRequestDetail = z.infer<typeof PullRequestDetailSchema>;

/** Mark-ready requires an explicit confirmed intent bound to the expected head. */
export const MarkReadyRequestSchema = z
  .object({
    expectedHeadSha: z.string().regex(/^[0-9a-f]{40}$/),
    confirmed: z.literal(true),
  })
  .strict();
export type MarkReadyRequest = z.infer<typeof MarkReadyRequestSchema>;
