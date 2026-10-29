/**
 * Repository, acknowledgement, and sync payload schemas.
 */
import { z } from 'zod';
import { LAST_SYNC_STATUSES, REPOSITORY_VISIBILITIES, SYNC_RUN_STATUSES } from '../types/domain.js';
import { EmbeddedErrorSchema } from './error.js';

export const CapabilitiesSchema = z.record(z.string(), z.boolean()).optional();
export type Capabilities = z.infer<typeof CapabilitiesSchema>;

export const RepositorySchema = z
  .object({
    id: z.string(),
    owner: z.string(),
    name: z.string(),
    visibility: z.enum(REPOSITORY_VISIBILITIES),
    defaultBranch: z.string(),
    connectedAt: z.string().datetime(),
    lastSuccessfulSyncAt: z.string().datetime().nullable().optional(),
    lastSyncStatus: z.enum(LAST_SYNC_STATUSES),
    aiAcknowledged: z.boolean(),
    capabilities: CapabilitiesSchema,
  })
  .strict();
export type Repository = z.infer<typeof RepositorySchema>;

export const ConnectRepositoryRequestSchema = z
  .object({
    owner: z.string().min(1).max(100),
    name: z.string().min(1).max(200),
  })
  .strict();
export type ConnectRepositoryRequest = z.infer<typeof ConnectRepositoryRequestSchema>;

export const AiAcknowledgementSchema = z
  .object({
    acknowledged: z.boolean(),
    destinationKnown: z.boolean(),
    destinationLabel: z.string().nullable().optional(),
    acknowledgedAt: z.string().datetime().nullable().optional(),
  })
  .strict();
export type AiAcknowledgement = z.infer<typeof AiAcknowledgementSchema>;

export const SyncRunSchema = z
  .object({
    id: z.string(),
    repoId: z.string(),
    status: z.enum(SYNC_RUN_STATUSES),
    startedAt: z.string().datetime(),
    finishedAt: z.string().datetime().nullable().optional(),
    openSeen: z.number().int().optional(),
    closedSeen: z.number().int().optional(),
    rateLimitResetAt: z.string().datetime().nullable().optional(),
    error: EmbeddedErrorSchema.optional(),
  })
  .strict();
export type SyncRun = z.infer<typeof SyncRunSchema>;
