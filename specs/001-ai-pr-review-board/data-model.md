# Phase 1 Data Model — AI-Assisted PR Review Board

**Date**: 2026-10-28 | **Plan**: [plan.md](./plan.md) | **Spec**: [spec.md](./spec.md)

## Storage layout

| Data | Location | Notes |
|---|---|---|
| Relational state | `%LOCALAPPDATA%\PRReviewDashboard\data\app.db` | SQLite, WAL, `foreign_keys=ON`, `busy_timeout=5000` |
| Bare Git caches | `%LOCALAPPDATA%\PRReviewDashboard\repos\<repoId>.git` | One cache per connected repository; never a user checkout |
| Redacted diagnostics | `%LOCALAPPDATA%\PRReviewDashboard\artifacts\<runId>.log` | Debug output only; expires in 30 days |
| Logs | `%LOCALAPPDATA%\PRReviewDashboard\logs\app.log` | Redacted structured logs; rotated |
| Migration files | `server/migrations/NNNN_description.sql` | Forward-only; recorded in `schema_migrations` |

Conventions: IDs are UUID v4 strings; timestamps are ISO-8601 UTC strings; booleans are `0`/`1`; JSON columns are TEXT validated with the shared Zod schema before write; paths use Git's forward-slash form. No table stores a GitHub token, AI key, cookie, or raw secret-bearing file body.

## Entity overview

```text
repositories 1──N pull_requests 1──N pull_request_reviews
     │                │
     │                ├──N local_copies
     │                ├──N review_runs 1──N findings
     │                │        │ 1
     │                │        └──1 review_drafts 1──N draft_findings
     │                │                    └──N review_posts
     │                └──N activity_events
     ├──N sync_runs
     ├──N repo_acknowledgements
     └──N team_membership_cache (by team/org)

artifacts 1──0..1 review_runs (diagnostics)
```

Spec entities map to tables: Repository → `repositories`; Pull request → `pull_requests` + `pull_request_reviews`; Local inspection → `local_copies`; Review run → `review_runs`; Finding → `findings` + `draft_findings`; Review draft → `review_drafts`; Review post → `review_posts`; Activity event → `activity_events`; Repository acknowledgement → `repo_acknowledgements`.

## Tables

### schema_migrations

| Column | Type | Constraints |
|---|---|---|
| version | TEXT | PK, filename prefix |
| applied_at | TEXT | NOT NULL |

### repositories

| Column | Type | Constraints |
|---|---|---|
| id | TEXT | PK |
| owner | TEXT | NOT NULL |
| name | TEXT | NOT NULL |
| github_repo_id | INTEGER | NOT NULL, UNIQUE |
| visibility | TEXT | `public` \| `private` \| `internal` |
| default_branch | TEXT | NOT NULL |
| is_archived | INTEGER | NOT NULL DEFAULT 0 |
| capabilities_json | TEXT | NOT NULL; `{contents, checks, pullRequests, reviews, teams}` booleans from FR-009 |
| connected_at | TEXT | NOT NULL |
| last_successful_sync_at | TEXT | NULL |
| last_sync_status | TEXT | `never` \| `succeeded` \| `partial` \| `failed` |

Unique: expression index on `lower(owner) || '/' || lower(name)` because GitHub names are case-insensitive. Delete cascades all rows below and removes cache/artifact directories.

### repo_acknowledgements

| Column | Type | Constraints |
|---|---|---|
| id | TEXT | PK |
| repo_id | TEXT | FK → repositories, ON DELETE CASCADE |
| destination | TEXT | NOT NULL; disclosed AI base URL/model identity |
| acknowledged_at | TEXT | NOT NULL |
| revoked_at | TEXT | NULL |

Current acknowledgement = latest row with `revoked_at IS NULL` matching the current configured destination. A destination change invalidates the acknowledgement (FR-008/025).

### team_membership_cache

| Column | Type | Constraints |
|---|---|---|
| github_team_id | TEXT | PK part |
| org_login | TEXT | PK part |
| team_slug | TEXT | NOT NULL |
| is_member | INTEGER | NULL = indeterminate |
| checked_at | TEXT | NOT NULL |

Refresh every 15 minutes or on demand. `is_member = NULL` renders the team request as indeterminate (FR-018, SC-015).

### pull_requests

| Column | Type | Constraints |
|---|---|---|
| id | TEXT | PK |
| repo_id | TEXT | FK → repositories, ON DELETE CASCADE |
| number | INTEGER | NOT NULL |
| github_id | TEXT | NOT NULL |
| title | TEXT | NOT NULL |
| body | TEXT | NOT NULL DEFAULT '' |
| author_login | TEXT | NOT NULL |
| state | TEXT | `open` \| `merged` \| `closed` \| `inaccessible` |
| is_draft | INTEGER | NOT NULL DEFAULT 0 |
| base_ref | TEXT | NOT NULL |
| head_ref | TEXT | NOT NULL |
| head_sha | TEXT | NOT NULL |
| additions | INTEGER | NOT NULL DEFAULT 0 |
| deletions | INTEGER | NOT NULL DEFAULT 0 |
| changed_files | INTEGER | NOT NULL DEFAULT 0 |
| labels_json | TEXT | NOT NULL; array of `{name,color}` |
| requested_users_json | TEXT | NOT NULL; array of logins |
| requested_teams_json | TEXT | NOT NULL; array of `{org,slug,githubId}` |
| review_decision | TEXT | NULL \| `APPROVED` \| `CHANGES_REQUESTED` \| `REVIEW_REQUIRED` |
| lane | TEXT | `Draft` \| `In review` \| `Request changes` \| `Approved` \| `Done` |
| checks_state | TEXT | `failing` \| `pending` \| `passing` \| `neutral` \| `none` |
| mergeable_state | TEXT | `mergeable` \| `conflicting` \| `unknown` |
| merged_at | TEXT | NULL |
| closed_at | TEXT | NULL |
| github_created_at | TEXT | NOT NULL |
| github_updated_at | TEXT | NOT NULL |
| first_seen_at | TEXT | NOT NULL |
| last_synced_at | TEXT | NOT NULL |
| last_seen_open_sync_id | TEXT | NULL; FK → sync_runs |
| checks_detail_json | TEXT | NULL; per-context cache keyed by `head_sha` |
| checks_cached_sha | TEXT | NULL |

Unique: `(repo_id, number)`; index `(repo_id, lane, github_updated_at DESC)`; index `(repo_id, state)`; index `(repo_id, head_sha)`. Lane, checks, and mergeability are recomputed on every upsert and never assigned by users (FR-015).

### pull_request_reviews

| Column | Type | Constraints |
|---|---|---|
| id | TEXT | PK |
| pr_id | TEXT | FK → pull_requests, ON DELETE CASCADE |
| github_review_id | TEXT | NOT NULL |
| reviewer_login | TEXT | NOT NULL |
| state | TEXT | `APPROVED` \| `CHANGES_REQUESTED` \| `DISMISSED` \| `COMMENTED` \| `PENDING` |
| submitted_at | TEXT | NULL |
| commit_sha | TEXT | NOT NULL |
| is_decision_bearing | INTEGER | NOT NULL; 1 only for APPROVED/CHANGES_REQUESTED/DISMISSED |

Unique: `(pr_id, github_review_id)`; index `(pr_id, reviewer_login, submitted_at DESC)`. The fallback lane rule reads the latest decision-bearing row per reviewer; COMMENTED/PENDING never override (FR-013/014). Rows for replaced heads are kept for audit but only rows matching the current head participate in the fallback.

### sync_runs

| Column | Type | Constraints |
|---|---|---|
| id | TEXT | PK |
| repo_id | TEXT | FK → repositories, ON DELETE CASCADE |
| trigger | TEXT | `startup` \| `manual` \| `after_action` |
| status | TEXT | `running` \| `succeeded` \| `partial` \| `failed` |
| started_at | TEXT | NOT NULL |
| finished_at | TEXT | NULL |
| open_seen | INTEGER | NOT NULL DEFAULT 0 |
| closed_seen | INTEGER | NOT NULL DEFAULT 0 |
| partial_reason | TEXT | NULL |
| error_code | TEXT | NULL |
| error_message | TEXT | NULL |
| rate_limit_reset_at | TEXT | NULL |

Partial sync retains the last known good rows and must never mark PRs closed (FR-007/021). A complete open refresh is identified by `status = succeeded` and a recorded open list scan.

### local_copies

| Column | Type | Constraints |
|---|---|---|
| id | TEXT | PK |
| repo_id | TEXT | FK → repositories, ON DELETE CASCADE |
| pr_id | TEXT | FK → pull_requests, ON DELETE CASCADE |
| head_sha | TEXT | NOT NULL |
| base_sha | TEXT | NOT NULL |
| merge_base_sha | TEXT | NOT NULL |
| path | TEXT | NOT NULL; cache-relative |
| status | TEXT | `preparing` \| `ready` \| `stale` \| `invalid` \| `deleted` |
| file_count | INTEGER | NOT NULL DEFAULT 0 |
| total_bytes | INTEGER | NOT NULL DEFAULT 0 |
| truncated | INTEGER | NOT NULL DEFAULT 0 |
| prepared_at | TEXT | NULL |
| last_accessed_at | TEXT | NOT NULL |
| error_code | TEXT | NULL |
| error_message | TEXT | NULL |

Unique: `(pr_id, head_sha)`; index `(last_accessed_at)`; index `(repo_id, status)`. A copy is reusable only for the same head SHA. Cleanup skips copies referenced by a `queued`/`running` run (FR-049).

### artifacts

| Column | Type | Constraints |
|---|---|---|
| id | TEXT | PK |
| kind | TEXT | `ai_diagnostics` \| `git_error` |
| path | TEXT | NOT NULL, cache-relative |
| bytes | INTEGER | NOT NULL |
| created_at | TEXT | NOT NULL |
| expires_at | TEXT | NOT NULL |
| redacted | INTEGER | NOT NULL DEFAULT 1 |

Diagnostics expire in 30 days (FR-066/091).

### review_runs

| Column | Type | Constraints |
|---|---|---|
| id | TEXT | PK |
| pr_id | TEXT | FK → pull_requests, ON DELETE CASCADE |
| local_copy_id | TEXT | FK → local_copies |
| head_sha | TEXT | NOT NULL |
| provider | TEXT | NOT NULL; base URL identity or configured name |
| model | TEXT | NOT NULL |
| status | TEXT | `queued` \| `running` \| `completed` \| `failed` \| `cancelled` \| `interrupted` |
| phase | TEXT | `waiting` \| `preparing` \| `building_context` \| `calling_model` \| `validating` \| `finalizing` \| `done` |
| verdict | TEXT | NULL \| `approve` \| `comment` \| `request_changes` |
| summary | TEXT | NULL |
| tests_missing_json | TEXT | NOT NULL DEFAULT '[]' |
| files_reviewed_json | TEXT | NOT NULL DEFAULT '[]' |
| files_skipped_json | TEXT | NOT NULL DEFAULT '[]'; `{path, reason}` |
| usage_json | TEXT | NULL; prompt/completion tokens when reported |
| cost_usd | REAL | NULL |
| started_at | TEXT | NULL |
| completed_at | TEXT | NULL |
| cancel_requested_at | TEXT | NULL |
| interrupted_at | TEXT | NULL |
| stale_at | TEXT | NULL |
| diagnostics_artifact_id | TEXT | NULL; FK → artifacts |
| error_code | TEXT | NULL |
| error_message | TEXT | NULL |

Partial unique index: one row per `pr_id` with `status IN ('queued','running')` (FR-056). Index `(pr_id, started_at DESC)`; index `(status)`. A run is publishable only when `status = completed`, `stale_at IS NULL`, and `head_sha` still matches GitHub. Verdict is advisory and never selects a publish event (FR-064/073).

### findings

| Column | Type | Constraints |
|---|---|---|
| id | TEXT | PK |
| run_id | TEXT | NULL; FK → review_runs, ON DELETE CASCADE; NULL only for manual findings |
| source | TEXT | `ai` \| `manual` |
| path | TEXT | NOT NULL |
| side | TEXT | `LEFT` \| `RIGHT` |
| line | INTEGER | NOT NULL, ≥1 |
| severity | TEXT | `critical` \| `high` \| `medium` \| `low` \| `nit` |
| category | TEXT | `bug` \| `security` \| `performance` \| `concurrency` \| `error_handling` \| `api_contract` \| `tests` \| `maintainability` \| `style` |
| title | TEXT | NOT NULL |
| explanation | TEXT | NOT NULL |
| confidence | REAL | NOT NULL, 0.0–1.0 |
| quoted_code | TEXT | NULL |
| suggestion | TEXT | NULL; single RIGHT-side line only |
| validation_status | TEXT | `pending` \| `valid` \| `reanchored` \| `demoted` \| `invalid` |
| resolved_path | TEXT | NULL |
| resolved_side | TEXT | NULL |
| resolved_line | INTEGER | NULL |
| dedupe_key | TEXT | NOT NULL; normalized path/side/line/explanation hash |
| created_at | TEXT | NOT NULL |

AI rows are immutable; user edits live in `draft_findings` so the original output stays auditable (US3-10, FR-070). Index `(run_id)`; unique `(run_id, dedupe_key)` for AI rows.

### review_drafts

| Column | Type | Constraints |
|---|---|---|
| id | TEXT | PK |
| pr_id | TEXT | FK → pull_requests, ON DELETE CASCADE |
| run_id | TEXT | NOT NULL, UNIQUE; FK → review_runs |
| summary | TEXT | NOT NULL; editable, ≤60,000 chars before publish |
| event | TEXT | `comment` \| `request_changes` \| `approve` |
| marker | TEXT | NOT NULL, UNIQUE; `<!-- pr-review-dashboard:run=<runId> -->` |
| target_head_sha | TEXT | NOT NULL |
| status | TEXT | `building` \| `previewed` \| `publishing` \| `published` \| `failed` \| `uncertain` \| `blocked` |
| preview_token_hash | TEXT | NULL; SHA-256 |
| preview_digest | TEXT | NULL; SHA-256 of draft/event/head/PR state |
| preview_expires_at | TEXT | NULL; 10 minutes |
| created_at | TEXT | NOT NULL |
| updated_at | TEXT | NOT NULL |

One draft per completed run. A draft is blocked when the PR is closed/merged/inaccessible/offline, the head differs, or the run is stale (FR-076/078).

### draft_findings

| Column | Type | Constraints |
|---|---|---|
| draft_id | TEXT | PK part; FK → review_drafts, ON DELETE CASCADE |
| finding_id | TEXT | PK part; FK → findings, ON DELETE CASCADE |
| decision | TEXT | `accepted` \| `dismissed` |
| inline_selected | INTEGER | NOT NULL DEFAULT 1 |
| edited_title | TEXT | NULL |
| edited_explanation | TEXT | NULL |
| edited_suggestion | TEXT | NULL |
| edited_path | TEXT | NULL |
| edited_side | TEXT | NULL |
| edited_line | INTEGER | NULL |
| updated_at | TEXT | NOT NULL |

Edits are stored as overrides; the base finding is never mutated. Manual findings are inserted into `findings` and linked here.

### review_posts

| Column | Type | Constraints |
|---|---|---|
| id | TEXT | PK |
| draft_id | TEXT | FK → review_drafts, ON DELETE CASCADE |
| attempt_no | INTEGER | NOT NULL, ≥1 |
| marker | TEXT | NOT NULL |
| event | TEXT | `comment` \| `request_changes` \| `approve` |
| target_head_sha | TEXT | NOT NULL |
| status | TEXT | `pending` \| `succeeded` \| `failed` \| `uncertain` \| `duplicate_detected` |
| github_review_id | TEXT | NULL |
| github_review_url | TEXT | NULL |
| payload_summary_json | TEXT | NOT NULL; counts, event, commit, body hash, comment anchors |
| response_json | TEXT | NULL; redacted GitHub response |
| fallback_json | TEXT | NULL; demoted anchors or event fallback details |
| error_code | TEXT | NULL |
| error_message | TEXT | NULL |
| started_at | TEXT | NOT NULL |
| finished_at | TEXT | NULL |

Unique: `(draft_id, attempt_no)`; partial unique index one `pending` row per draft (FR-086). `attempt_no` increments per user-confirmed retry; the marker stays constant for the draft (FR-081/083).

### activity_events

| Column | Type | Constraints |
|---|---|---|
| id | TEXT | PK |
| repo_id | TEXT | FK → repositories, ON DELETE CASCADE |
| pr_id | TEXT | NULL; FK → pull_requests, ON DELETE CASCADE |
| type | TEXT | `repo_connected` \| `sync_completed` \| `mark_ready` \| `review_started` \| `review_completed` \| `review_failed` \| `review_cancelled` \| `finding_triaged` \| `draft_previewed` \| `publish_attempted` \| `publish_succeeded` \| `publish_failed` \| `publish_uncertain` |
| occurred_at | TEXT | NOT NULL |
| data_json | TEXT | NOT NULL; redacted summary |

Index `(pr_id, occurred_at DESC)`; index `(repo_id, occurred_at DESC)`. No token, full secret-bearing content, or raw model output is stored here (FR-085/095).

## Derived values

### Lane

```text
lane(pr, reviews):
  if pr.state in {merged, closed}: Done
  if pr.state == inaccessible: return last known lane, marked stale/inaccessible
  if pr.is_draft: Draft
  if pr.review_decision == CHANGES_REQUESTED: Request changes
  if pr.review_decision == APPROVED: Approved
  if pr.review_decision == REVIEW_REQUIRED: In review
  latest = latest decision-bearing review per reviewer at pr.head_sha
  if any latest.state == CHANGES_REQUESTED: Request changes
  if any latest.state == APPROVED: Approved
  return In review
```

An inaccessible PR is not terminal and MUST NOT be moved to Done; it keeps its last derived lane with an explicit accessibility warning because the app cannot verify its current state (FR-020, edge cases). DISMISSED removes that reviewer's approval; COMMENTED/PENDING never override an earlier decision. A new head re-evaluates from current GitHub data (FR-014).

### Checks aggregate

```text
if any check failed/error: failing
else if any check pending/expected: pending
else if any check successful: passing
else if checks or statuses exist (all neutral/skipped): neutral
else: none
```

Include check runs and commit statuses; required-check filtering is not separate (FR-024).

### Needs my review

True when `requested_users_json` contains the viewer login, or a requested team's cached membership is true at the current head. Indeterminate team requests are displayed with a warning and are not counted (FR-018, SC-015).

### Publishability

`publishable = draft.status in {building, previewed} AND run.status == completed AND run.stale_at IS NULL AND draft.target_head_sha == verified_github_head AND pr.state == open AND pr.is_draft is compatible with event AND online`.

Own-PR, draft-approval, and closed/merged restrictions surface as blocked reasons with the comment fallback (FR-079/080).

## State machines

### Review run

```text
queued → running → completed | failed | cancelled
queued/running → interrupted        (app restart)
completed → stale                   (head or PR state changes)
```

No transition out of `interrupted`, `failed`, or `cancelled` except a new run. Partial findings are never persisted as publishable findings (FR-055/066/067).

### Local copy

```text
preparing → ready → stale (head changed) | invalid (ref/network/auth/cache) | deleted (cleanup/disconnect)
preparing → failed error state (surfaced as invalid, no partial diff)
```

A newer copy for the same PR supersedes the old one after it is ready; the old copy is cleaned up unless referenced by an active run (FR-049).

### Draft and post

```text
draft: building → previewed → publishing → published | failed | uncertain
draft: any active state → blocked (head/state/offline)
draft: uncertain → previewed (re-confirm) → publishing (same marker)

post: pending → succeeded | failed | uncertain
post: uncertain → duplicate_detected (marker found) | failed (verified absent after window)
```

Only one `pending` post per draft. No automatic retry after `uncertain` (FR-083/088).

### Sync

```text
running → succeeded (complete open + closed refresh)
running → partial (some detail failed; last good data retained)
running → failed (auth/network; last good data retained)
```

Terminal state requires a complete closed/merged refresh before a PR may be marked closed (FR-021).

## Business invariants

1. One active review run per PR and one pending post per draft, enforced by partial unique indexes.
2. A draft exists only for a completed, non-stale run and one target head SHA; any head/state change blocks it.
3. Findings are immutable after creation; triage edits are overrides in `draft_findings`.
4. Inline eligibility is single-line LEFT/RIGHT changed lines only; context, multi-line, and outside-change-block anchors are demoted (FR-060).
5. Deduplication keeps the highest-confidence finding per normalized key; inline selection is deterministic (FR-062/063).
6. Hidden marker is appended after truncation and is never dropped (FR-075/081).
7. Activity and diagnostics are redacted before persistence; credential and denylisted content never enter either (FR-085/095).
8. Lane is never user-assigned; only GitHub-derived values are written (FR-015).
9. Retention: copies 14 days (skip active), diagnostics 30 days, structured audit until disconnect/clear (FR-049/091).
10. Disconnect is one transaction plus cache/artifact deletion; if file deletion fails, the DB rows still go and the directory is queued for retry (FR-092).

## Migration and cleanup jobs

- Migrations run at startup in a transaction, recorded in `schema_migrations`; the app refuses to start if a migration fails.
- Cleanup runs at startup and every 6 hours: expired artifacts, stale copies, orphaned artifact files, WAL checkpoint, and deletion retries.
- Sync refreshes `last_seen_open_sync_id`. A successful sync hides PRs outside the 30-day Done window from the board, but keeps their rows, runs, findings, drafts, posts, and activity until the repository is disconnected (FR-091/092).
