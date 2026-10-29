-- 0001_initial.sql — full initial schema (T018) per specs/001-ai-pr-review-board/data-model.md
-- Conventions: UUID v4 TEXT ids; ISO-8601 UTC timestamps; booleans 0/1; JSON in TEXT validated by shared Zod schemas.
-- schema_migrations is owned by the migration runner and is not created here.

CREATE TABLE repositories (
    id                      TEXT PRIMARY KEY,
    owner                   TEXT NOT NULL,
    name                    TEXT NOT NULL,
    github_repo_id          INTEGER NOT NULL UNIQUE,
    visibility              TEXT NOT NULL CHECK (visibility IN ('public', 'private', 'internal')),
    default_branch          TEXT NOT NULL,
    is_archived             INTEGER NOT NULL DEFAULT 0 CHECK (is_archived IN (0, 1)),
    capabilities_json       TEXT NOT NULL CHECK (json_valid(capabilities_json)),
    connected_at            TEXT NOT NULL,
    last_successful_sync_at TEXT,
    last_sync_status        TEXT NOT NULL DEFAULT 'never' CHECK (last_sync_status IN ('never', 'succeeded', 'partial', 'failed'))
);

-- GitHub names are case-insensitive (data-model.md).
CREATE UNIQUE INDEX repositories_owner_name_lower
    ON repositories (lower(owner) || '/' || lower(name));

CREATE TABLE repo_acknowledgements (
    id             TEXT PRIMARY KEY,
    repo_id        TEXT NOT NULL REFERENCES repositories (id) ON DELETE CASCADE,
    destination    TEXT NOT NULL,
    acknowledged_at TEXT NOT NULL,
    revoked_at     TEXT
);

CREATE INDEX repo_acknowledgements_current
    ON repo_acknowledgements (repo_id, acknowledged_at DESC);

CREATE TABLE team_membership_cache (
    github_team_id TEXT NOT NULL,
    org_login      TEXT NOT NULL,
    team_slug      TEXT NOT NULL,
    is_member      INTEGER CHECK (is_member IS NULL OR is_member IN (0, 1)), -- NULL = indeterminate (FR-018/SC-015)
    checked_at     TEXT NOT NULL,
    PRIMARY KEY (github_team_id, org_login)
);

CREATE TABLE sync_runs (
    id                 TEXT PRIMARY KEY,
    repo_id            TEXT NOT NULL REFERENCES repositories (id) ON DELETE CASCADE,
    trigger            TEXT NOT NULL CHECK (trigger IN ('startup', 'manual', 'after_action')),
    status             TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'succeeded', 'partial', 'failed')),
    started_at         TEXT NOT NULL,
    finished_at        TEXT,
    open_seen          INTEGER NOT NULL DEFAULT 0,
    closed_seen        INTEGER NOT NULL DEFAULT 0,
    partial_reason     TEXT,
    error_code         TEXT,
    error_message      TEXT,
    rate_limit_reset_at TEXT
);

CREATE INDEX sync_runs_by_repo ON sync_runs (repo_id, started_at DESC);

CREATE TABLE pull_requests (
    id                   TEXT PRIMARY KEY,
    repo_id              TEXT NOT NULL REFERENCES repositories (id) ON DELETE CASCADE,
    number               INTEGER NOT NULL CHECK (number >= 1),
    github_id            TEXT NOT NULL,
    title                TEXT NOT NULL,
    body                 TEXT NOT NULL DEFAULT '',
    author_login         TEXT NOT NULL,
    state                TEXT NOT NULL CHECK (state IN ('open', 'merged', 'closed', 'inaccessible')),
    is_draft             INTEGER NOT NULL DEFAULT 0 CHECK (is_draft IN (0, 1)),
    base_ref             TEXT NOT NULL,
    head_ref             TEXT NOT NULL,
    head_sha             TEXT NOT NULL,
    additions            INTEGER NOT NULL DEFAULT 0,
    deletions            INTEGER NOT NULL DEFAULT 0,
    changed_files        INTEGER NOT NULL DEFAULT 0,
    labels_json          TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(labels_json)),
    requested_users_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(requested_users_json)),
    requested_teams_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(requested_teams_json)),
    review_decision      TEXT CHECK (review_decision IS NULL OR review_decision IN ('APPROVED', 'CHANGES_REQUESTED', 'REVIEW_REQUIRED')),
    lane                 TEXT NOT NULL CHECK (lane IN ('Draft', 'In review', 'Request changes', 'Approved', 'Done')),
    checks_state         TEXT NOT NULL CHECK (checks_state IN ('failing', 'pending', 'passing', 'neutral', 'none')),
    mergeable_state      TEXT NOT NULL CHECK (mergeable_state IN ('mergeable', 'conflicting', 'unknown')),
    merged_at            TEXT,
    closed_at            TEXT,
    github_created_at    TEXT NOT NULL,
    github_updated_at    TEXT NOT NULL,
    first_seen_at        TEXT NOT NULL,
    last_synced_at       TEXT NOT NULL,
    last_seen_open_sync_id TEXT REFERENCES sync_runs (id) ON DELETE SET NULL,
    checks_detail_json   TEXT CHECK (checks_detail_json IS NULL OR json_valid(checks_detail_json)),
    checks_cached_sha    TEXT,
    UNIQUE (repo_id, number)
);

CREATE INDEX pull_requests_lane_order ON pull_requests (repo_id, lane, github_updated_at DESC);
CREATE INDEX pull_requests_by_state ON pull_requests (repo_id, state);
CREATE INDEX pull_requests_by_head ON pull_requests (repo_id, head_sha);

CREATE TABLE pull_request_reviews (
    id                  TEXT PRIMARY KEY,
    pr_id               TEXT NOT NULL REFERENCES pull_requests (id) ON DELETE CASCADE,
    github_review_id    TEXT NOT NULL,
    reviewer_login      TEXT NOT NULL,
    state               TEXT NOT NULL CHECK (state IN ('APPROVED', 'CHANGES_REQUESTED', 'DISMISSED', 'COMMENTED', 'PENDING')),
    submitted_at        TEXT,
    commit_sha          TEXT NOT NULL,
    is_decision_bearing INTEGER NOT NULL CHECK (is_decision_bearing IN (0, 1)),
    UNIQUE (pr_id, github_review_id)
);

CREATE INDEX pull_request_reviews_by_reviewer ON pull_request_reviews (pr_id, reviewer_login, submitted_at DESC);

CREATE TABLE local_copies (
    id                TEXT PRIMARY KEY,
    repo_id           TEXT NOT NULL REFERENCES repositories (id) ON DELETE CASCADE,
    pr_id             TEXT NOT NULL REFERENCES pull_requests (id) ON DELETE CASCADE,
    head_sha          TEXT NOT NULL,
    base_sha          TEXT NOT NULL,
    merge_base_sha    TEXT NOT NULL,
    path              TEXT NOT NULL,
    status            TEXT NOT NULL DEFAULT 'preparing' CHECK (status IN ('preparing', 'ready', 'stale', 'invalid', 'deleted')),
    file_count        INTEGER NOT NULL DEFAULT 0,
    total_bytes       INTEGER NOT NULL DEFAULT 0,
    truncated         INTEGER NOT NULL DEFAULT 0 CHECK (truncated IN (0, 1)),
    prepared_at       TEXT,
    last_accessed_at  TEXT NOT NULL,
    error_code        TEXT,
    error_message     TEXT,
    UNIQUE (pr_id, head_sha)
);

CREATE INDEX local_copies_by_access ON local_copies (last_accessed_at);
CREATE INDEX local_copies_by_status ON local_copies (repo_id, status);

CREATE TABLE artifacts (
    id         TEXT PRIMARY KEY,
    kind       TEXT NOT NULL CHECK (kind IN ('ai_diagnostics', 'git_error')),
    path       TEXT NOT NULL,
    bytes      INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    redacted   INTEGER NOT NULL DEFAULT 1 CHECK (redacted IN (0, 1))
);

CREATE INDEX artifacts_by_expiry ON artifacts (expires_at);

CREATE TABLE review_runs (
    id                       TEXT PRIMARY KEY,
    pr_id                    TEXT NOT NULL REFERENCES pull_requests (id) ON DELETE CASCADE,
    local_copy_id            TEXT REFERENCES local_copies (id),
    head_sha                 TEXT NOT NULL,
    provider                 TEXT NOT NULL,
    model                    TEXT NOT NULL,
    status                   TEXT NOT NULL CHECK (status IN ('queued', 'running', 'completed', 'failed', 'cancelled', 'interrupted')),
    phase                    TEXT NOT NULL DEFAULT 'waiting' CHECK (phase IN ('waiting', 'preparing', 'building_context', 'calling_model', 'validating', 'finalizing', 'done')),
    verdict                  TEXT CHECK (verdict IS NULL OR verdict IN ('approve', 'comment', 'request_changes')),
    summary                  TEXT,
    tests_missing_json       TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(tests_missing_json)),
    files_reviewed_json      TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(files_reviewed_json)),
    files_skipped_json       TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(files_skipped_json)),
    usage_json               TEXT CHECK (usage_json IS NULL OR json_valid(usage_json)),
    cost_usd                 REAL,
    started_at               TEXT,
    completed_at             TEXT,
    cancel_requested_at      TEXT,
    interrupted_at           TEXT,
    stale_at                 TEXT,
    diagnostics_artifact_id  TEXT REFERENCES artifacts (id),
    error_code               TEXT,
    error_message            TEXT
);

-- At most one active run per PR (FR-056).
CREATE UNIQUE INDEX review_runs_one_active
    ON review_runs (pr_id) WHERE status IN ('queued', 'running');

CREATE INDEX review_runs_by_pr ON review_runs (pr_id, started_at DESC);
CREATE INDEX review_runs_by_status ON review_runs (status);

CREATE TABLE findings (
    id                TEXT PRIMARY KEY,
    run_id            TEXT REFERENCES review_runs (id) ON DELETE CASCADE, -- NULL only for manual findings
    source            TEXT NOT NULL CHECK (source IN ('ai', 'manual')),
    path              TEXT NOT NULL,
    side              TEXT NOT NULL CHECK (side IN ('LEFT', 'RIGHT')),
    line              INTEGER NOT NULL CHECK (line >= 1),
    severity          TEXT NOT NULL CHECK (severity IN ('critical', 'high', 'medium', 'low', 'nit')),
    category          TEXT NOT NULL CHECK (category IN ('bug', 'security', 'performance', 'concurrency', 'error_handling', 'api_contract', 'tests', 'maintainability', 'style')),
    title             TEXT NOT NULL,
    explanation       TEXT NOT NULL,
    confidence        REAL NOT NULL CHECK (confidence >= 0.0 AND confidence <= 1.0),
    quoted_code       TEXT,
    suggestion        TEXT,
    validation_status TEXT NOT NULL DEFAULT 'pending' CHECK (validation_status IN ('pending', 'valid', 'reanchored', 'demoted', 'invalid')),
    resolved_path     TEXT,
    resolved_side     TEXT CHECK (resolved_side IS NULL OR resolved_side IN ('LEFT', 'RIGHT')),
    resolved_line     INTEGER CHECK (resolved_line IS NULL OR resolved_line >= 1),
    dedupe_key        TEXT NOT NULL,
    created_at        TEXT NOT NULL
);

-- Unique source+dedupe pairs for AI rows; manual findings are deduped by the draft layer.
CREATE UNIQUE INDEX findings_run_dedupe
    ON findings (run_id, dedupe_key) WHERE run_id IS NOT NULL;

CREATE INDEX findings_by_run ON findings (run_id);

CREATE TABLE review_drafts (
    id                  TEXT PRIMARY KEY,
    pr_id               TEXT NOT NULL REFERENCES pull_requests (id) ON DELETE CASCADE,
    run_id              TEXT UNIQUE REFERENCES review_runs (id), -- UNIQUE when not null (T020 invariant)
    origin              TEXT NOT NULL CHECK (origin IN ('ai', 'manual')),
    summary             TEXT NOT NULL DEFAULT '',
    event               TEXT NOT NULL CHECK (event IN ('comment', 'request_changes', 'approve')),
    marker              TEXT NOT NULL UNIQUE,
    target_head_sha     TEXT NOT NULL,
    status              TEXT NOT NULL DEFAULT 'building' CHECK (status IN ('building', 'previewed', 'publishing', 'published', 'failed', 'uncertain', 'blocked')),
    preview_token_hash  TEXT,
    preview_digest      TEXT,
    preview_expires_at  TEXT,
    created_at          TEXT NOT NULL,
    updated_at          TEXT NOT NULL
);

CREATE INDEX review_drafts_by_pr ON review_drafts (pr_id);

CREATE TABLE draft_findings (
    draft_id          TEXT NOT NULL REFERENCES review_drafts (id) ON DELETE CASCADE,
    finding_id        TEXT NOT NULL REFERENCES findings (id) ON DELETE CASCADE,
    decision          TEXT NOT NULL CHECK (decision IN ('accepted', 'dismissed')),
    inline_selected   INTEGER NOT NULL DEFAULT 1 CHECK (inline_selected IN (0, 1)),
    edited_title      TEXT,
    edited_explanation TEXT,
    edited_suggestion TEXT,
    edited_path       TEXT,
    edited_side       TEXT CHECK (edited_side IS NULL OR edited_side IN ('LEFT', 'RIGHT')),
    edited_line       INTEGER CHECK (edited_line IS NULL OR edited_line >= 1),
    updated_at        TEXT NOT NULL,
    PRIMARY KEY (draft_id, finding_id)
);

CREATE TABLE review_posts (
    id                  TEXT PRIMARY KEY,
    draft_id            TEXT NOT NULL REFERENCES review_drafts (id) ON DELETE CASCADE,
    attempt_no          INTEGER NOT NULL CHECK (attempt_no >= 1),
    marker              TEXT NOT NULL,
    event               TEXT NOT NULL CHECK (event IN ('comment', 'request_changes', 'approve')),
    target_head_sha     TEXT NOT NULL,
    status              TEXT NOT NULL CHECK (status IN ('pending', 'succeeded', 'failed', 'uncertain', 'duplicate_detected')),
    github_review_id    TEXT,
    github_review_url   TEXT,
    payload_summary_json TEXT NOT NULL CHECK (json_valid(payload_summary_json)),
    response_json       TEXT CHECK (response_json IS NULL OR json_valid(response_json)),
    fallback_json       TEXT CHECK (fallback_json IS NULL OR json_valid(fallback_json)),
    error_code          TEXT,
    error_message       TEXT,
    started_at          TEXT NOT NULL,
    finished_at         TEXT,
    UNIQUE (draft_id, attempt_no)
);

-- At most one in-flight (pending) post per draft (FR-086).
CREATE UNIQUE INDEX review_posts_one_pending
    ON review_posts (draft_id) WHERE status = 'pending';

CREATE TABLE activity_events (
    id          TEXT PRIMARY KEY,
    repo_id     TEXT NOT NULL REFERENCES repositories (id) ON DELETE CASCADE,
    pr_id       TEXT REFERENCES pull_requests (id) ON DELETE CASCADE,
    type        TEXT NOT NULL CHECK (type IN (
        'repo_connected', 'sync_completed', 'mark_ready',
        'review_started', 'review_completed', 'review_failed', 'review_cancelled', 'finding_triaged', 'draft_previewed',
        'publish_attempted', 'publish_succeeded', 'publish_failed', 'publish_uncertain'
    )),
    occurred_at TEXT NOT NULL,
    data_json   TEXT NOT NULL CHECK (json_valid(data_json))
);

CREATE INDEX activity_events_by_pr ON activity_events (pr_id, occurred_at DESC);
CREATE INDEX activity_events_by_repo ON activity_events (repo_id, occurred_at DESC);
