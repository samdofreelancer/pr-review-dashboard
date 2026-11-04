/**
 * Shared Zod schema surface (T012).
 *
 * Every entity in `contracts/openapi.yaml` + the request bodies it accepts.
 * `shared/src/schemas/` and the contract must stay in sync; contract tests
 * (T033, T057, T074, T090) are the drift guard.
 */
export * from './error.js';
export * from './session.js';
export * from './repository.js';
export * from './board.js';
export * from './pr.js';
export * from './diff.js';
export * from './review.js';
export * from './draft.js';
export * from './publish.js';
export * from './activity.js';
