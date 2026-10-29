/**
 * Shared numeric limits (T011).
 *
 * One source of truth for every budget named by FR-044, FR-063, FR-075,
 * FR-049/091, and the Session limits payload. Server and web code read these
 * instead of hard-coding numbers so contract tests can catch drift.
 */

export const LIMITS = {
  // Diff budget (FR-044)
  /** Maximum changed files displayed before the diff is marked truncated. */
  maxDiffFiles: 400,
  /** Maximum changed lines displayed before the diff is marked truncated. */
  maxDiffLines: 20_000,
  /** Maximum text bytes kept per text file before truncation (1 MiB). */
  maxFileTextBytes: 1_048_576,
  /** Maximum total text bytes kept across all files (20 MiB). */
  maxTotalTextBytes: 20 * 1_048_576,

  // AI context budget
  /** Maximum characters of untrusted repository/PR text sent to the AI model. */
  maxAiContextChars: 300_000,

  // Review output budget (FR-063, FR-075)
  /** Hard cap of findings proposed inline, ordered by severity then confidence. */
  maxInlineFindings: 15,
  /** Maximum characters of the review summary. */
  maxSummaryChars: 60_000,
  /** Maximum characters of each inline comment body. */
  maxInlineCommentChars: 10_000,

  // Retention (FR-049, FR-091)
  /** Local copies not accessed within this many days are removed. */
  copyRetentionDays: 14,
  /** Redacted AI diagnostics retained at most this many days. */
  diagnosticsRetentionDays: 30,

  // Board window (FR-010)
  /** Merged/closed pull requests updated within this many days stay on the board. */
  doneWindowDays: 30,
} as const;
