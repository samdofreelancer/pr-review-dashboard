# Tasks: AI-Assisted PR Review Board

**Input**: Design documents from `/specs/001-ai-pr-review-board/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/](./contracts/), [quickstart.md](./quickstart.md)

**Tests**: Included because the plan (R19) and quickstart (§5–6) require automated contract, integration, E2E, and performance validation of SC-001–SC-015. Write each story's tests first and confirm they fail before implementing.

**Organization**: Tasks are grouped by user story so each story can be implemented, tested, and demonstrated as an independent increment.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependency on an incomplete task)
- **[Story]**: Which user story this task belongs to (US1, US2, US3, US4)
- Every task names the exact file path(s) it creates or changes

## Path Conventions

- npm workspaces: `shared/`, `server/`, `web/`
- Shared domain code: `shared/src/`
- Server code: `server/src/`; migrations: `server/migrations/`; tests: `server/tests/`
- SPA code: `web/src/`; tests: `web/tests/`

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Initialize the three-package workspace, toolchain, and run scripts.

- [x] T001 Create the npm workspace root `package.json` with `shared`, `server`, and `web` workspaces, `engines.node >=22.13`, and package-manager metadata per plan.md
- [x] T002 [P] Add `tsconfig.base.json` and per-package `tsconfig.json` files for `shared/`, `server/`, and `web/` with strict mode and workspace path aliases
- [x] T003 [P] Configure ESLint and Prettier in `eslint.config.js` and `.prettierrc.json`, including React/TypeScript rules and no-floating-promises
- [x] T004 [P] Scaffold the shared package in `shared/package.json` and `shared/src/index.ts` exporting types, schemas, lane, checks, limits, and the AI denylist modules
- [x] T005 [P] Scaffold the server package in `server/package.json` with Fastify 5, Octokit GraphQL/REST with throttling and retry, Zod, parse-diff, and Vitest dependencies
- [x] T006 [P] Scaffold the web package in `web/package.json` with React 19, Vite 7, TanStack Query 5, dnd-kit, Radix UI, react-markdown, rehype-sanitize, and react-router
- [x] T007 [P] Configure the test harness in `vitest.config.ts`, `server/tests/setup.ts` (MSW lifecycle), and `playwright.config.ts` with a loopback-only web server
- [x] T008 [P] Add `.gitignore` for `node_modules`, `dist`, SQLite/cache/log paths, and `.env`, plus `.env.example` documenting `GH_TOKEN`, `GITHUB_TOKEN`, `AI_BASE_URL`, `AI_MODEL`, `AI_API_KEY`, `AI_TIMEOUT_MS`, `PORT`, and `APP_DATA_DIR`
- [x] T009 Wire development and production serving in `web/vite.config.ts`, `server/src/api/static.ts`, and root scripts `dev`, `build`, `start`, `typecheck`, `lint`, `test`, `test:integration`, `test:e2e`, `test:perf` per quickstart §3

**Checkpoint**: `npm install`, `npm run typecheck`, and an empty Fastify+SPA boot succeed.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Shared contracts, persistence, configuration, security, job infrastructure, GitHub transport, and the SPA shell required by every story.

**CRITICAL**: No user story work can begin until this phase is complete.

- [x] T010 [P] Define shared domain types and enums in `shared/src/types/domain.ts` for lanes, PR states, review decisions, checks states, run/draft/post statuses, activity types, SSE names, and error codes
- [x] T011 [P] Add all numeric limits in `shared/src/limits/index.ts`: 400 files, 20,000 changed lines, 1 MiB per text file, 20 MiB total text, 300,000 AI context characters, 60,000 summary characters, 10,000 inline characters, 15 inline findings, 14-day copy retention, 30-day diagnostics retention; add the shared AI denylist matcher in `shared/src/ai/denylist.ts` for `.env`, `.git/**`, `.opencode/**`, `opencode.json(c)`, `AGENTS.md`, `CLAUDE.md`, Copilot/Cursor instruction files, credential/key patterns, and generated/vendor paths
- [x] T012 [P] Add shared Zod schemas in `shared/src/schemas/` mirroring every entity in `contracts/openapi.yaml` (Board, PullRequestDetail, Diff, ReviewRun, Finding, ReviewDraft, Preview, PublishResult, ActivityEvent)
- [x] T013 Implement environment and trusted-local configuration validation in `server/src/config/index.ts`, including credential source detection (`GH_TOKEN`, `GITHUB_TOKEN`, `gh` CLI), AI settings, port, and data root; never log or persist secret values
- [x] T014 [P] Implement application path resolution and private directory creation in `server/src/config/paths.ts` for `data/`, `repos/`, `artifacts/`, and `logs/` under `APP_DATA_DIR`
- [x] T015 [P] Implement the redacting structured logger in `server/src/observability/logger.ts`, masking authorization headers, tokens, private keys, and denylisted file content
- [ ] T016 Implement the SQLite connection in `server/src/db/connection.ts` with WAL, `foreign_keys=ON`, `busy_timeout=5000`, and transaction helpers
- [ ] T017 Implement the forward-only migration runner in `server/src/db/migrate.ts`, recording applied versions in `schema_migrations` and refusing startup on failure
- [ ] T018 Write `server/migrations/0001_initial.sql` with every table, constraint, partial unique index, and expression index defined in data-model.md
- [ ] T019 [P] Implement repository, sync-run, acknowledgement, and team-membership data access in `server/src/db/repositoryStore.ts`
- [ ] T020 [P] Implement pull request, review, and activity data access in `server/src/db/pullRequestStore.ts` and `server/src/db/activityStore.ts`, plus draft and draft-finding data access with nullable `run_id`, `origin` (`ai`/`manual`), unique marker, counts, and publishability calculation in `server/src/db/draftStore.ts`
- [ ] T021 Implement loopback-only Host/Origin checks, CSRF validation, no-CORS headers, and CSP in `server/src/security/local.ts`
- [ ] T022 Implement the Fastify app factory, error-code mapping, `/api/health`, and `/api/session` (CSRF token, viewer identity, credential source) in `server/src/api/app.ts`, `server/src/api/session.ts`, and `server/src/api/errors.ts`
- [ ] T023 Implement the SSE hub and `GET /api/events` in `server/src/api/sse.ts` and `server/src/api/routes/events.ts`, including the `ready` frame and 15-second heartbeat per contracts/events.md
- [ ] T024 Implement the in-process job queue in `server/src/jobs/queue.ts` with cancellation, per-repository sync locks, a global AI concurrency limit of two, one active run per PR, and one publish in flight per draft
- [ ] T025 Implement GitHub credential resolution and viewer validation in `server/src/github/auth.ts`, re-resolving on 401 and on restart and reporting only source and login
- [ ] T026 Implement the GitHub client factory in `server/src/github/client.ts` with throttling, retry, rate-limit reset reporting, and consistent `AUTH_*`/`RATE_LIMITED`/`GITHUB_*` error mapping
- [ ] T027 Implement GitHub head and PR-state verification in `server/src/github/verifyHead.ts` for use before diff preparation, review start, review completion, and publish
- [ ] T028 Implement startup and graceful shutdown in `server/src/index.ts`: Git preflight, migrations, interrupted-run/uncertain-post marking, job queue boot, browser launch, and port binding to `127.0.0.1`
- [ ] T029 [P] Create reusable test fixtures in `server/tests/fixtures/git.ts` (temporary bare repositories with PR heads), `server/tests/fixtures/github.ts` (MSW GraphQL/REST handlers), and `server/tests/fixtures/ai.ts` (fake OpenAI-compatible server)
- [ ] T030 [P] Build the SPA shell in `web/src/app/` and `web/src/api/` with router, QueryClient, typed fetch client carrying the CSRF token, SSE hook with reconnect invalidation, and query keys
- [ ] T031 [P] Build shared UI primitives and base Vietnamese dictionary in `web/src/components/` and `web/src/i18n/vi.ts` for dialogs, menus, tabs, toasts, banners, empty/loading/error states, and `vi-VN` date formatting

**Checkpoint**: The app boots, migrates an empty database, serves the SPA, authenticates to GitHub in read-only mode, and streams SSE heartbeats.

---

## Phase 3: User Story 1 — Monitor and triage pull requests on an accurate board (Priority: P1) — MVP

**Goal**: Connect repositories, synchronize GitHub PR data, derive the five lanes, and provide search, filters, mark-ready, offline retention, PR overview/activity, and a board-initiated composer that opens a manual review draft for Approve/Request changes.

**Independent Test**: Connect a test repository containing open, draft, approved, changes-requested, review-required, merged, and closed PRs. Verify every PR lands in the correct lane, search and "Needs my review" behave per FR-018, mark-ready updates GitHub and only the affected card, and a board Approve/Request changes creates a manual draft bound to the verified head.

### Tests for User Story 1

- [ ] T032 [P] [US1] Unit tests for lane derivation, checks aggregate, and needs-my-review in `server/tests/unit/lane.test.ts` and `server/tests/unit/checks.test.ts`
- [ ] T033 [P] [US1] Contract tests for session, repositories, board, PR detail, mark-ready, and manual draft creation (`POST /api/prs/{prId}/draft`, nullable `runId`, `origin`) in `server/tests/contract/us1-board.test.ts` against `contracts/openapi.yaml`
- [ ] T034 [P] [US1] Integration tests for sync idempotency, all lane mappings, dismissed/COMMENTED review handling, partial sync, closed confirmation, and rate-limit backoff in `server/tests/integration/sync.test.ts`
- [ ] T035 [P] [US1] E2E tests for connect/sync, lane counts and ordering, search/filters, unsupported drags, mark-ready, offline banner, and a timed connect-to-populated-board run for SC-002 in `web/tests/e2e/us1-board.spec.ts`

### Implementation for User Story 1

- [ ] T036 [P] [US1] Implement lane derivation in `shared/src/lane/deriveLane.ts` exactly as data-model.md, including the decision-bearing review fallback and inaccessible handling
- [ ] T037 [P] [US1] Implement checks aggregate precedence in `shared/src/checks/aggregate.ts` (failing → pending → passing → neutral → none)
- [ ] T038 [P] [US1] Implement needs-my-review logic in `shared/src/lane/needsMyReview.ts`, treating indeterminate team membership as displayed but not counted
- [ ] T039 [US1] Implement GraphQL repository/PR/review queries and pagination in `server/src/github/queries.ts` for all FR-010 fields and decision-bearing review snapshots
- [ ] T040 [P] [US1] Implement per-head check runs plus commit statuses and team membership REST adapters in `server/src/github/checks.ts` and `server/src/github/teams.ts`
- [ ] T041 [US1] Implement the sync orchestrator in `server/src/github/sync.ts`: open plus 30-day closed lists, upsert by `(repo_id, number)`, review snapshot persistence, lane recompute, partial/failed retention, no false closures, one sync per repository, and inaccessible PRs keeping their last lane instead of falling into Done
- [ ] T042 [US1] Implement repository list/connect/disconnect services in `server/src/github/repositoryService.ts`, including accessible-repository search, `owner/repo` resolution, capability checks, and cascade deletion
- [ ] T043 [US1] Implement the board query service in `server/src/github/boardService.ts` with repository/search/label/author/number filters, needs-my-review, visible lane counts, and updated-descending order
- [ ] T044 [US1] Implement mark-ready as a GitHub mutation followed by a full PR re-fetch in `server/src/github/actions.ts`, never updating the lane optimistically
- [ ] T045 [US1] Implement US1 routes in `server/src/api/routes/repos.ts`, `server/src/api/routes/board.ts`, and `server/src/api/routes/prs.ts` for all operation IDs in the OpenAPI contract, including `POST /api/prs/{prId}/draft` (`createManualDraft`) in `server/src/api/routes/drafts.ts`, which verifies the head and creates a manual draft with `origin=manual`, no run, and the draft marker
- [ ] T046 [US1] Record `repo_connected`, `sync_completed`, and `mark_ready` activity and emit `sync.*` and `board.updated` SSE events from `server/src/observability/activity.ts` and the sync/action call sites
- [ ] T047 [P] [US1] Build the board page in `web/src/pages/BoardPage.tsx` and `web/src/features/board/` with five lanes, visible counts, updated sorting, and lane virtualization above 100 cards
- [ ] T048 [P] [US1] Build the search and filter bar in `web/src/features/board/BoardFilters.tsx`, constrained by selected repository, with needs-my-review and preserved repository selection when filters clear
- [ ] T049 [P] [US1] Build the repository picker, authentication repair state, and capability warnings in `web/src/features/repos/RepositoryPicker.tsx` and `AuthBanner.tsx`, with no in-app token form
- [ ] T050 [P] [US1] Build the drag matrix, snap-back explanation, card action menu, confirmation dialogs, keyboard sensor, and board-initiated `ReviewComposer` in `web/src/features/board/DragBoard.tsx`, `CardMenu.tsx`, `ConfirmActionDialog.tsx`, and `ReviewComposer.tsx`; Approve/Request changes create a manual draft bound to the verified head with the matching event preselected and a Comment fallback when GitHub rejects the event
- [ ] T051 [P] [US1] Build the PR detail shell with Overview and Activity tabs in `web/src/pages/PullRequestPage.tsx`, `web/src/features/pr/OverviewTab.tsx`, and `ActivityTab.tsx`, rendering GitHub text as sanitized Markdown and linking the conversation and commit list to GitHub instead of embedding them
- [ ] T052 [P] [US1] Build freshness, offline, rate-limit, auth, and partial-sync banners with retry controls in `web/src/components/StatusBanner.tsx` and `web/src/features/repos/SyncStatus.tsx`, detecting offline from browser events plus SSE failure and disabling sync, review, and publish while offline
- [ ] T053 [US1] Wire US1 Vietnamese copy and API error messages in `web/src/i18n/vi.ts`, keeping review-related English strings untouched
- [ ] T054 [P] [US1] Add MSW-backed UI unit tests for lane counts, filter state, drag matrix, and confirmation behavior in `web/tests/unit/board.test.tsx`

**Checkpoint**: The full board works against fixtures and a scratch repository; V1–V5 pass.

---

## Phase 4: User Story 2 — Inspect a pull request's changes locally (Priority: P2)

**Goal**: Prepare an isolated bare-Git copy of the displayed head, compute the PR-only diff, and render changed files safely with staleness and truncation.

**Independent Test**: Open a PR with text, renamed, copied, binary, symlink, submodule, mode-only, and oversized files. Verify file navigation, line numbers, special-file labels, truncation, cache reuse, and that a new head marks the diff stale.

**Dependency**: Can start after Foundational. Git/diff core can be built in parallel with US1; UI activation needs the PR detail shell from T051 and routes from T045.

### Tests for User Story 2

- [ ] T055 [P] [US2] Unit tests for safe Git invocation, disabled hooks/filters, path traversal guards, and control-character rejection in `server/tests/unit/git-safety.test.ts`
- [ ] T056 [P] [US2] Integration tests with real temporary bare repositories for fetch, merge-base, PR-only diff, special file types, truncation limits, cache reuse, and paths containing spaces, Unicode, tabs, and case-only renames in `server/tests/integration/diff.test.ts`
- [ ] T057 [P] [US2] Contract tests for diff status, prepare, and diff-file endpoints in `server/tests/contract/diff.test.ts`
- [ ] T058 [P] [US2] E2E tests for diff navigation, special files, truncation, stale head, offline unverified state, and denylisted secret/instruction paths shown in the human diff with a warning in `web/tests/e2e/us2-diff.spec.ts`

### Implementation for User Story 2

- [ ] T059 [US2] Implement Git preflight, repository cache path resolution, and corrupt-cache detection in `server/src/git/cache.ts`
- [ ] T060 [US2] Implement the safe Git runner in `server/src/git/runner.ts` with hooks, fsmonitor, external diff, textconv, and filters disabled, submodules never fetched, and auth via an ephemeral askpass helper
- [ ] T061 [US2] Implement base/`refs/pull/<n>/head` fetching and merge-base computation in `server/src/git/prepare.ts`, returning typed failure codes for auth, permission, network, missing ref, disk, Git missing, and corrupt cache
- [ ] T062 [US2] Implement diff parsing, change-type classification, single-line RIGHT/LEFT anchor maps, and truncation at the shared limits in `server/src/git/diff.ts`
- [ ] T063 [US2] Implement blob reads with cache-root and traversal guards in `server/src/git/blobs.ts`, never following symlinks or submodules
- [ ] T064 [US2] Implement the diff preparation job in `server/src/jobs/diffJob.ts` with `local_copies` status transitions, SSE `diff.*` phases, head verification, and stale/invalid outcomes
- [ ] T065 [US2] Implement `GET`/`POST /api/prs/{prId}/diff` and `GET /api/prs/{prId}/diff/file` in `server/src/api/routes/diff.ts`, returning 202 while preparation runs
- [ ] T066 [P] [US2] Build the diff tab in `web/src/features/diff/DiffView.tsx`, `FileList.tsx`, and `Hunk.tsx` with change blocks, old/new line numbers, additions/deletions, change-type badges, a GitHub link for truncated content, and a visible warning on denylisted secret/instruction paths that are excluded from AI review but still shown to the human
- [ ] T067 [P] [US2] Build stale, unverified, offline, and preparation-error states with retry in `web/src/features/diff/DiffStatus.tsx`, blocking AI and publish entry points when unverified
- [ ] T068 [P] [US2] Add virtualization for the file list and long hunks in `web/src/features/diff/VirtualDiff.tsx`
- [ ] T069 [P] [US2] Add UI unit tests for line-number rendering, truncation markers, and stale-state behavior in `web/tests/unit/diff.test.tsx`

**Checkpoint**: The local diff is complete and trustworthy; V6–V7 pass and the user checkout is untouched.

---

## Phase 5: User Story 3 — Run an AI-assisted review and triage findings (Priority: P2)

**Goal**: Build bounded AI context with exclusions, run one cancellable single-shot review, validate findings against the diff, cap inline comments, and support triage into a draft.

**Independent Test**: Run a review against a repository with known issues. Verify acknowledgement, progress, cancellation, strict schema rejection, anchor validation, dedupe, top-15 ordering, stale marking, triage edits, and sanitized rendering.

**Dependency**: Requires US2's diff line map (T062) and diff job (T064).

### Tests for User Story 3

- [ ] T070 [P] [US3] Unit tests for the denylist, context budget, skip reasons, and untrusted-data framing in `server/tests/unit/ai-context.test.ts`
- [ ] T071 [P] [US3] Unit tests for strict AI JSON/schema validation and all-or-nothing failure modes in `server/tests/unit/ai-validation.test.ts`
- [ ] T072 [P] [US3] Unit tests for anchor validation, unique quote re-anchoring, dedupe, and top-15 ordering in `server/tests/unit/finding-validation.test.ts`
- [ ] T073 [P] [US3] Integration tests for run lifecycle, cancellation, interruption, stale marking, usage/cost, and duplicate start requests in `server/tests/integration/review-run.test.ts`
- [ ] T074 [P] [US3] Contract tests for AI acknowledgement, review-run, AI and manual draft creation, manual-finding, and triage endpoints in `server/tests/contract/review.test.ts`
- [ ] T075 [P] [US3] E2E tests for acknowledgement, start/cancel, progress, triage, sanitized AI content, and a timed SC-009 run (triage ten findings, preview, reach confirmation) in `web/tests/e2e/us3-review.spec.ts`

### Implementation for User Story 3

- [ ] T076 [US3] Implement the OpenAI-compatible provider adapter in `server/src/ai/provider.ts` with timeout, AbortController, single endpoint, usage parsing, and no tools or network access
- [ ] T077 [US3] Implement the bounded context builder in `server/src/ai/context.ts` using the shared denylist from `shared/src/ai/denylist.ts`, excluding binary, symlink, submodule, and generated content without duplicating path rules
- [ ] T078 [US3] Implement the prompt builder and JSON-schema request with one JSON-mode fallback in `server/src/ai/prompt.ts`, wrapping repository and PR text in explicit untrusted-data delimiters
- [ ] T079 [P] [US3] Implement strict Zod output validation in `server/src/ai/validate.ts` against `contracts/ai-review.schema.json`, failing the entire run on any violation and enforcing the LEFT-side `suggestion` prohibition
- [ ] T080 [P] [US3] Implement finding validation, quote re-anchoring, dedupe, deterministic top-15 selection, rejection of LEFT-side suggestions, and summary-metadata assembly (files reviewed/skipped, tests missing) in `server/src/review/validateFindings.ts`
- [ ] T081 [US3] Implement the review run job in `server/src/jobs/reviewRunJob.ts` with phases, two-run global concurrency, cancellation, head re-verification, stale marking, and diagnostic retention
- [ ] T082 [US3] Implement review run and finding persistence in `server/src/db/reviewStore.ts`, keeping AI findings immutable and edits as overrides; draft rows are owned by T020's `draftStore.ts`
- [ ] T083 [US3] Implement AI acknowledgement and review-run routes in `server/src/api/routes/reviewRuns.ts`, returning the existing active run for duplicate starts
- [ ] T084 [US3] Implement AI draft creation, draft update, manual finding, and triage routes in `server/src/api/routes/drafts.ts`, extending the manual draft route from T045 so both `origin=ai` and `origin=manual` drafts share preview and publishing
- [ ] T085 [P] [US3] Build the AI review tab in `web/src/features/ai-review/ReviewPanel.tsx`, `RunProgress.tsx`, and `FindingCard.tsx` with acknowledgement dialog, start/cancel, phases, and sanitized finding Markdown
- [ ] T086 [P] [US3] Build triage controls and live accepted/inline/summary counts in `web/src/features/triage/TriagePanel.tsx` and `DraftCounts.tsx`, with the original AI output available for audit
- [ ] T087 [P] [US3] Build run failure, empty, and retry states plus token/cost display in `web/src/features/ai-review/RunStatus.tsx`, never presenting partial output as valid

**Checkpoint**: A review can run, fail safely, be cancelled, be marked stale, and be triaged; V8–V11 pass.

---

## Phase 6: User Story 4 — Publish a human-approved review to GitHub (Priority: P3)

**Goal**: Generate a server-owned preview, bind it to the reviewed commit, and publish exactly one review with a hidden marker and all fallback paths.

**Independent Test**: Preview accepted findings, publish as comment, request changes, and approve where allowed. Verify only accepted findings post, anchors are correct, and stale/offline/duplicate/own-PR/draft/422 cases behave as specified.

**Dependency**: Requires the shared draft store (T020), US3's triage routes (T084), and either an AI-origin or manual-origin draft.

### Tests for User Story 4

- [ ] T088 [P] [US4] Unit tests for preview body construction for both `origin=ai` and `origin=manual` drafts, summary/inline truncation, marker placement, digest, and token expiry in `server/tests/unit/preview.test.ts`
- [ ] T089 [P] [US4] Integration tests for marker pre-check, timeout/uncertain outcome, one-retry rule, 422 anchor demotion, single-flight, and restart recovery in `server/tests/integration/publish.test.ts`
- [ ] T090 [P] [US4] Contract tests for preview and publish endpoints, expired token, and conflict codes in `server/tests/contract/publish.test.ts`
- [ ] T091 [P] [US4] E2E tests for preview, publish, own-PR and draft fallbacks, anchor rejection, multi-tab publish, and board-initiated approve/request-changes through the manual-draft composer in `web/tests/e2e/us4-publish.spec.ts`

### Implementation for User Story 4

- [ ] T092 [P] [US4] Implement the GitHub review list/create client in `server/src/github/reviews.ts`, including 422 anchor parsing, existing-marker search, and permission errors
- [ ] T093 [P] [US4] Implement the server-side preview builder in `server/src/review/preview.ts` with summary composition (remaining findings by severity, demoted/stale/skipped counts, omitted-inline count, and a no-findings message), summary and inline truncation, marker appended after truncation, digest, and a 10-minute preview token
- [ ] T094 [US4] Implement the publish service in `server/src/review/publish.ts` with marker pre-check, one in-flight post, timeout uncertainty and re-check, one confirmed retry, one 422 retry, and own-PR/draft comment fallback
- [ ] T095 [US4] Implement review-post persistence, publish audit/activity, and startup uncertainty recovery in `server/src/review/publishStore.ts` and `server/src/jobs/publishRecovery.ts`
- [ ] T096 [US4] Implement `GET /api/drafts/{draftId}/preview` and `POST /api/drafts/{draftId}/publish` in `server/src/api/routes/publish.ts` with explicit confirmation, expired-preview, and conflict mapping
- [ ] T097 [US4] Refresh the PR and board after publish, append the posted review to Activity, and emit `publish.*` and `board.updated` in `server/src/review/postRefresh.ts`
- [ ] T098 [P] [US4] Build the preview dialog in `web/src/features/publish/PreviewDialog.tsx` for AI and manual drafts, preselecting the draft event, showing the commit, summary, every inline comment, truncation/fallback warnings, and explicit confirmation
- [ ] T099 [P] [US4] Build publish progress, success, failure, uncertain, and duplicate-detected states with SSE convergence in `web/src/features/publish/PublishStatus.tsx`
- [ ] T100 [P] [US4] Build the own-PR and draft comment-event fallback flow in `web/src/features/publish/EventFallback.tsx`, preserving the intended event in the audit record
- [ ] T101 [P] [US4] Render the published review and fallback details in the PR Activity tab in `web/src/features/pr/ActivityTab.tsx`

**Checkpoint**: At most one review is posted per draft across retries, restarts, and tabs; V12–V14 pass.

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Retention, redaction, accessibility, performance, security hardening, and end-to-end validation.

- [ ] T102 [P] Implement the retention cleanup job in `server/src/jobs/cleanup.ts` (copies 14 days skipping active runs, diagnostics 30 days, WAL checkpoint, deletion retries) and schedule it at startup and every 6 hours, with tests in `server/tests/integration/cleanup.test.ts`
- [ ] T103 [P] Harden repository disconnect in `server/src/github/repositoryService.ts` for one-transaction row deletion, cache/artifact cleanup, and retry of failed directory deletion, with tests in `server/tests/integration/disconnect.test.ts`
- [ ] T104 [P] Add redaction regression tests for logs, activity, artifacts, and API errors in `server/tests/integration/redaction.test.ts` and fix any leak in `server/src/observability/`
- [ ] T105 [P] Add keyboard-only, focus-visibility, and `aria-live` E2E coverage in `web/tests/e2e/keyboard.spec.ts` and fix issues in `web/src/components/` and `web/src/features/`
- [ ] T106 [P] Add performance fixtures and measurements for 5 repositories/100 PRs and a 1 GB working tree in `server/tests/fixtures/largeRepo.ts` and `server/tests/perf/board.perf.test.ts`, targeting SC-003/SC-004/SC-005, reporting rate-limit waits separately with retry/reset time, and splitting SC-005 into provider p90 (≤90 s) and orchestration p90 (≤60 s)
- [ ] T107 Audit and fix empty, loading, partial-failure, authentication-failure, and offline states across `web/src/pages/` and `web/src/components/`, ensuring no failure is shown as success
- [ ] T108 [P] Audit Vietnamese UI copy completeness and English review-content enforcement in `web/src/i18n/vi.ts` and `server/src/ai/prompt.ts`
- [ ] T109 [P] Add security regression tests for CSRF, Host/Origin, CSP, path traversal, and askpass token exposure in `server/tests/integration/security.test.ts`
- [ ] T110 Run `npm run typecheck`, `npm run lint`, `npm test`, `npm run test:integration`, `npm run test:e2e`, and `npm run test:perf`; fix failures in affected files and record results in `specs/001-ai-pr-review-board/quickstart.md` §10
- [ ] T111 Execute quickstart §7 live smoke and manual scenarios V1–V19; record command, fixture revision, app version, and observed results in `specs/001-ai-pr-review-board/quickstart.md` §10

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (T001–T009)**: No dependencies; can start immediately.
- **Foundational (T010–T031)**: Depends on Setup; blocks all user stories.
- **US1 (T032–T054)**: Starts after Foundational; no dependency on other stories.
- **US2 (T055–T069)**: Starts after Foundational; Git/diff core can run in parallel with US1, but UI activation needs T045 and T051.
- **US3 (T070–T087)**: Depends on US2's line map and diff job (T062, T064).
- **US4 (T088–T101)**: Depends on US3's draft persistence and triage routes (T082, T084).
- **Polish (T102–T111)**: Depends on all desired stories being complete.

### Key Task Dependencies

- T002–T008 depend on T001; T009 depends on T005, T006.
- T016 → T017 → T018 → T019/T020.
- T021 → T022 → T023.
- T025 → T026 → T027.
- T028 depends on T013, T017, T018, T022, T024, T025.
- T030 depends on T012 and T022; T031 is independent.
- US1: T036–T038 parallel → T041 depends on T036, T039, T040, T019, T020 → T045 depends on T041–T044 and T020 (manual draft) → T047–T052 depend on T045, T030, T031 → T053 after UI strings.
- US2: T059 → T060 → T061 → T062; T063 after T060; T064 depends on T062, T063, T027, T024; T065 depends on T064; T066–T068 depend on T065.
- US3: T076 and T079 parallel; T077 depends on T011 and T062; T078 depends on T076; T080 depends on T062; T081 depends on T076–T080, T064; T083 depends on T081–T082; T084 depends on T020, T045, and T082; T085–T087 depend on T083–T084.
- US4: T092 and T093 parallel; T094 depends on T092, T093, T082; T095 depends on T018; T096 depends on T094, T095; T097 depends on T096 and T041/T044; T098–T101 depend on T096–T097.
- Polish tasks depend on the stories they harden; T110/T111 run last.

### User Story Dependency Graph

```text
Setup (T001–T009)
        │
Foundational (T010–T031)
        │
        ├───────────────┐
        ▼               ▼
US1 (T032–T054)   US2 Git core (T059–T064)
        │               │
        ├───────────────┘
        ▼
US2 integration & UI (T055–T058, T065–T069)
        │
        ▼
US3 (T070–T087)
        │
        ▼
US4 (T088–T101)
        │
        ▼
Polish (T102–T111)
```

---

## Parallel Execution Examples

### User Story 1

```text
# Tests first (different files):
T032  Unit tests: lane, checks, needs-my-review
T033  Contract tests: session/repos/board/PR/mark-ready
T034  Integration tests: sync and lane mapping
T035  E2E tests: board, filters, mark-ready, offline

# Shared pure rules (different files):
T036  Lane derivation
T037  Checks aggregate
T038  Needs-my-review

# Independent UI surfaces after routes are ready:
T047  Board page          T048  Filters
T049  Repository picker   T050  Drag/menu
T051  PR detail shell     T052  Banners
```

### User Story 2

```text
# Tests first:
T055  Git safety unit tests       T056  Real-repo diff integration tests
T057  Diff contract tests         T058  Diff E2E tests

# After the safe runner exists:
T062  Diff parsing/anchor map     T063  Blob reads

# Independent UI surfaces after routes:
T066  Diff view        T067  Status states        T068  Virtualization
```

### User Story 3

```text
# Tests first:
T070  Context/denylist        T071  AI validation
T072  Finding validation      T073  Run lifecycle
T074  Review contract         T075  Review E2E

# Provider-independent modules:
T076  AI provider adapter     T079  Output validation
T077  Context builder         T078  Prompt builder (after T076)
T080  Finding validation (after T062)
```

### User Story 4

```text
# Tests first:
T088  Preview unit        T089  Publish integration
T090  Publish contract    T091  Publish E2E

# Independent modules:
T092  GitHub reviews client   T093  Preview builder

# Independent UI surfaces after routes:
T098  Preview dialog   T099  Publish status   T100  Event fallback
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Setup (T001–T009).
2. Complete Foundational (T010–T031) — blocks every story.
3. Complete US1 (T032–T054).
4. **STOP and VALIDATE**: run quickstart V1–V5 and the board E2E suite.
5. Demo the connected, synchronized, GitHub-derived five-lane board.

### Incremental Delivery

1. **US1 board** → V1–V5, SC-001/SC-002/SC-003/SC-015.
2. **US2 diff** → V6–V7, SC-004.
3. **US3 AI review** → V8–V11, SC-005/SC-010/SC-013.
4. **US4 publish** → V12–V14, SC-006/SC-007/SC-008.
5. **Polish** → V15–V18, keyboard, performance, redaction, and live smoke.

### Parallel Team Strategy

1. One developer completes Setup + Foundational.
2. After Foundational:
   - Developer A: US1 board.
   - Developer B: US2 Git/diff core, then US2 UI once T045/T051 exist.
3. After US2 line map: Developer C starts US3 context/validation while A finishes US1.
4. After US3 draft: Developer D starts US4 preview/publish.
5. Polish is shared once all stories are merged.

---

## Notes

- Tests are included because the plan and quickstart mandate automated validation; write them first and confirm they fail for the expected reason.
- Never update a lane or publish state optimistically; only server-refetched GitHub data is authoritative (FR-025/029/077).
- A review draft exists without an AI run when the user starts from the board; `review_drafts.run_id` is nullable and `origin` distinguishes `ai` from `manual` (data-model.md).
- Keep `shared/src/schemas/` and `contracts/openapi.yaml` in sync; contract tests are the drift guard.
- No task may add token entry, token persistence, code execution, submodules, or AI tools; these are plan-level gates.
- Commit after each task or logical group; stop at every checkpoint to validate the story independently.
