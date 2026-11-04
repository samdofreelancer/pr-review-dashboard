/**
 * Board payload schemas: five lanes, cards, and search/filter inputs.
 */
import { z } from 'zod';
import {
  CHECKS_STATES,
  LANES as LANE_NAMES,
  MERGEABILITY_STATES,
  PR_STATES,
  REVIEW_DECISIONS,
} from '../types/domain.js';
import { RepositorySchema } from './repository.js';

export const LabelSchema = z
  .object({
    name: z.string(),
    color: z.string().optional(),
  })
  .strict();
export type Label = z.infer<typeof LabelSchema>;

export const BoardCardRepositorySchema = z
  .object({
    id: z.string(),
    owner: z.string(),
    name: z.string(),
  })
  .strict();
export type BoardCardRepository = z.infer<typeof BoardCardRepositorySchema>;

export const BoardCardSchema = z
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
    /** A requested team whose membership could not be determined (FR-018, SC-015). */
    teamRequestIndeterminate: z.boolean().optional(),
  })
  .strict();
export type BoardCard = z.infer<typeof BoardCardSchema>;

export const LaneSchema = z
  .object({
    name: z.enum(LANE_NAMES),
    count: z.number().int(),
    cards: z.array(BoardCardSchema),
  })
  .strict();
export type Lane = z.infer<typeof LaneSchema>;

export const BoardSchema = z
  .object({
    /** Exactly five lanes, always present in display order. */
    lanes: z.array(LaneSchema).min(5).max(5),
    repositories: z.array(RepositorySchema).optional(),
    lastSyncAt: z.string().datetime().nullable().optional(),
    offline: z.boolean(),
    stale: z.boolean(),
    message: z.string().nullable().optional(),
  })
  .strict();
export type Board = z.infer<typeof BoardSchema>;
