/**
 * Review run, finding, and triage payload schemas (US3/US4).
 */
import { z } from 'zod';
import { LIMITS } from '../limits/index.js';
import {
  DRAFT_EVENTS,
  FINDING_CATEGORIES,
  FINDING_SEVERITIES,
  FINDING_SIDES,
  FINDING_SOURCES,
  FINDING_VALIDATION_STATUSES,
  RUN_PHASES,
  RUN_STATUSES,
  RUN_VERDICTS,
  TRIAGE_DECISIONS,
} from '../types/domain.js';
import { EmbeddedErrorSchema } from './error.js';

export const UsageSchema = z
  .object({
    promptTokens: z.number().int().optional(),
    completionTokens: z.number().int().optional(),
  })
  .strict();
export type Usage = z.infer<typeof UsageSchema>;

export const FileSkippedSchema = z
  .object({
    path: z.string(),
    reason: z.string(),
  })
  .strict();
export type FileSkipped = z.infer<typeof FileSkippedSchema>;

export const ResolvedAnchorSchema = z
  .object({
    path: z.string(),
    side: z.enum(FINDING_SIDES),
    line: z.number().int().min(1),
  })
  .strict();
export type ResolvedAnchor = z.infer<typeof ResolvedAnchorSchema>;

export const FindingSchema = z
  .object({
    id: z.string(),
    source: z.enum(FINDING_SOURCES),
    path: z.string(),
    side: z.enum(FINDING_SIDES),
    line: z.number().int().min(1),
    severity: z.enum(FINDING_SEVERITIES),
    category: z.enum(FINDING_CATEGORIES),
    title: z.string(),
    explanation: z.string(),
    /** 0.0–1.0; confidence is reported by the model and kept in the audit trail. */
    confidence: z.number().min(0).max(1),
    quotedCode: z.string().nullable().optional(),
    /** Optional single-line replacement — RIGHT side only (FR-059). */
    suggestion: z.string().nullable().optional(),
    validationStatus: z.enum(FINDING_VALIDATION_STATUSES),
    resolvedAnchor: ResolvedAnchorSchema.nullable().optional(),
  })
  .strict();
export type Finding = z.infer<typeof FindingSchema>;

export const ReviewRunSchema = z
  .object({
    id: z.string(),
    prId: z.string(),
    headSha: z.string(),
    status: z.enum(RUN_STATUSES),
    phase: z.enum(RUN_PHASES),
    progress: z.number().min(0).max(1).nullable().optional(),
    verdict: z.enum(RUN_VERDICTS).nullable().optional(),
    summary: z.string().nullable().optional(),
    usage: UsageSchema.optional(),
    costUsd: z.number().nullable().optional(),
    stale: z.boolean().optional(),
    interrupted: z.boolean().optional(),
    startedAt: z.string().datetime().nullable().optional(),
    completedAt: z.string().datetime().nullable().optional(),
    error: EmbeddedErrorSchema.optional(),
    findings: z.array(FindingSchema).optional(),
    testsMissing: z.array(z.string()).optional(),
    filesReviewed: z.array(z.string()).optional(),
    filesSkipped: z.array(FileSkippedSchema).optional(),
  })
  .strict();
export type ReviewRun = z.infer<typeof ReviewRunSchema>;

export const FindingCreateSchema = z
  .object({
    path: z.string(),
    side: z.enum(FINDING_SIDES),
    line: z.number().int().min(1),
    severity: z.enum(FINDING_SEVERITIES),
    category: z.enum(FINDING_CATEGORIES),
    title: z.string().max(200),
    explanation: z.string().max(4000),
    confidence: z.number().min(0).max(1),
    suggestion: z.string().max(1000).optional(),
  })
  .strict();
export type FindingCreate = z.infer<typeof FindingCreateSchema>;

export const FindingPatchSchema = z
  .object({
    decision: z.enum(TRIAGE_DECISIONS).optional(),
    inlineSelected: z.boolean().optional(),
    editedTitle: z.string().max(200).nullable().optional(),
    editedExplanation: z.string().max(4000).nullable().optional(),
    editedSuggestion: z.string().max(1000).nullable().optional(),
    editedPath: z.string().nullable().optional(),
    editedSide: z.enum(FINDING_SIDES).nullable().optional(),
    editedLine: z.number().int().min(1).nullable().optional(),
  })
  .strict();
export type FindingPatch = z.infer<typeof FindingPatchSchema>;

export const DraftFindingEditsSchema = z
  .object({
    title: z.string().max(200).nullable().optional(),
    explanation: z.string().max(4000).nullable().optional(),
    suggestion: z.string().max(1000).nullable().optional(),
    path: z.string().nullable().optional(),
    side: z.enum(FINDING_SIDES).nullable().optional(),
    line: z.number().int().min(1).nullable().optional(),
  })
  .strict();
export type DraftFindingEdits = z.infer<typeof DraftFindingEditsSchema>;

export const DraftFindingSchema = z
  .object({
    findingId: z.string(),
    decision: z.enum(TRIAGE_DECISIONS),
    inlineSelected: z.boolean(),
    finding: FindingSchema,
    edits: DraftFindingEditsSchema.optional(),
  })
  .strict();
export type DraftFinding = z.infer<typeof DraftFindingSchema>;

/** Board-initiated manual draft creation (FR-070); runs without an AI run. */
export const ManualDraftCreateSchema = z
  .object({
    event: z.enum(DRAFT_EVENTS),
    summary: z.string().max(LIMITS.maxSummaryChars).optional(),
  })
  .strict();
export type ManualDraftCreate = z.infer<typeof ManualDraftCreateSchema>;
