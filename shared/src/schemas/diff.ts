/**
 * Local diff payload schemas (US2). Truncation caps reuse the shared limits.
 */
import { z } from 'zod';
import { LIMITS } from '../limits/index.js';
import { CHANGE_TYPES, DIFF_LINE_KINDS, DIFF_PHASES, DIFF_STATUSES } from '../types/domain.js';
import { EmbeddedErrorSchema } from './error.js';

export const DiffFileSchema = z
  .object({
    path: z.string(),
    previousPath: z.string().nullable().optional(),
    changeType: z.enum(CHANGE_TYPES),
    additions: z.number().int(),
    deletions: z.number().int(),
    binary: z.boolean(),
    symlink: z.boolean(),
    submodule: z.boolean(),
    truncated: z.boolean(),
  })
  .strict();
export type DiffFile = z.infer<typeof DiffFileSchema>;

export const DiffSchema = z
  .object({
    headSha: z.string(),
    baseSha: z.string(),
    mergeBaseSha: z.string(),
    verified: z.boolean(),
    stale: z.boolean(),
    truncated: z.boolean(),
    truncatedReason: z.string().nullable().optional(),
    files: z.array(DiffFileSchema).max(LIMITS.maxDiffFiles),
  })
  .strict();
export type Diff = z.infer<typeof DiffSchema>;

export const DiffStatusSchema = z
  .object({
    prId: z.string(),
    headSha: z.string(),
    status: z.enum(DIFF_STATUSES),
    phase: z.enum(DIFF_PHASES).optional(),
    progress: z.number().min(0).max(1).nullable().optional(),
    stale: z.boolean(),
    verified: z.boolean(),
    truncated: z.boolean().optional(),
    fileCount: z.number().int().optional(),
    error: EmbeddedErrorSchema.optional(),
    updatedAt: z.string().datetime().optional(),
  })
  .strict();
export type DiffStatusPayload = z.infer<typeof DiffStatusSchema>;

export const DiffLineSchema = z
  .object({
    kind: z.enum(DIFF_LINE_KINDS),
    oldLine: z.number().int().nullable().optional(),
    newLine: z.number().int().nullable().optional(),
    text: z.string(),
  })
  .strict();
export type DiffLine = z.infer<typeof DiffLineSchema>;

export const DiffHunkSchema = z
  .object({
    oldStart: z.number().int(),
    oldLines: z.number().int(),
    newStart: z.number().int(),
    newLines: z.number().int(),
    lines: z.array(DiffLineSchema),
  })
  .strict();
export type DiffHunk = z.infer<typeof DiffHunkSchema>;

export const DiffFileContentSchema = z
  .object({
    path: z.string(),
    previousPath: z.string().nullable().optional(),
    headSha: z.string(),
    changeType: z.enum(CHANGE_TYPES),
    binary: z.boolean(),
    truncated: z.boolean(),
    symlinkTarget: z.string().nullable().optional(),
    submoduleSha: z.string().nullable().optional(),
    hunks: z.array(DiffHunkSchema),
  })
  .strict();
export type DiffFileContent = z.infer<typeof DiffFileContentSchema>;
