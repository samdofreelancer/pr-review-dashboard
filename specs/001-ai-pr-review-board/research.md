# Phase 0 Research — AI-Assisted PR Review Board

**Date**: 2026-10-28 | **Feature**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md)

All Technical Context unknowns are resolved below. There are no open `NEEDS CLARIFICATION` items.

## R1. Application architecture

**Decision**: Local web application composed of a loopback-only Node.js service and a React SPA. Fastify serves the built SPA in production and the Vite dev server proxies `/api` in development. The launcher opens the default browser at `http://127.0.0.1:<port>`.

**Rationale**: The spec explicitly assumes a supported browser and multi-tab behavior (FR-086, US4-12, SC-007), while privileged work (Git, SQLite, GitHub token, AI endpoint) must stay server-side. A local server gives one authoritative job/queue, one SQLite writer, and one publish lock across tabs. It keeps the MVP packaging cost near zero on Windows and avoids bundling a browser runtime.

**Alternatives considered**: Electron/Tauri desktop shell (adds packaging and update surface without removing browser tabs; can wrap later); pure client-side SPA (cannot safely run Git or hold the GitHub token, and cannot enforce cross-tab single-flight); remote server (violates local-first and credential assumptions).

## R2. Runtime and language

**Decision**: TypeScript 5.x on Node.js 22.13+ (LTS 22, also 24), React 19, Vite 7, Fastify 5.

**Rationale**: The machine currently resolves Node 22.13 with npm 10.9 and Git 2.38, so the plan targets the installed runtime rather than an unavailable one. Node 22+ provides `AbortSignal`, native `fetch`, `node:sqlite`, and stable ESM. TypeScript is shared across the server, SPA, and contracts. Fastify provides schema validation, structured logging with redaction hooks, SSE, and static hosting.

**Alternatives considered**: Node 24-only (not guaranteed on every target machine); Python/Go backend (separate toolchain, no shared contracts); Next.js (SSR and bundler complexity not needed for a local tool).

## R3. SQLite engine

**Decision**: Use Node's built-in `node:sqlite` (`DatabaseSync`) behind a small repository layer. Enable WAL, foreign keys, and a busy timeout. Pin the supported runtime to Node ≥22.13. If the experimental API changes, only the repository layer changes.

**Rationale**: Verified locally that `node:sqlite` creates and queries an in-memory database on the installed runtime. It removes a native build step on Windows, which is the largest install-failure risk for a local tool. All database work is short and transactional; the synchronous API is acceptable and keeps cross-tab locking simple.

**Alternatives considered**: `better-sqlite3` (mature but requires prebuilt or compiled native binaries per Node ABI); JSON/lowdb (no constraints, indexes, or transactional locks; unsafe for idempotency); PostgreSQL (external service violates local-first).

## R4. GitHub authentication

**Decision**: Resolve the credential at call time in this order: `GH_TOKEN`, `GITHUB_TOKEN`, then `gh auth token`. Validate it with a `viewer { login }` query. Re-resolve after a 401 and on restart. Never write the token to SQLite, logs, activity, crash output, or the UI; report only the source and identity.

**Rationale**: This matches `gh` CLI precedence, supports CI-like environments, and satisfies FR-001 without an in-app token form. Re-resolution satisfies FR-005; source reporting makes SC-002 and multi-source conflicts debuggable.

**Alternatives considered**: OAuth device flow (excluded by assumptions); storing a PAT (forbidden by FR-003/090); GitHub App (multi-user/hosted scope).

## R5. GitHub API shape

**Decision**: Hybrid GitHub access.
- GraphQL for repository/PR list data: number, title, body, author, timestamps, additions/deletions/changed files, draft, base/head refs and OIDs, labels, review decision, review requests (users and teams), mergeable, state, merged/closed time.
- GraphQL review queries filtered to decision-bearing states when `reviewDecision` is null or a PR detail is opened.
- REST `GET /user/teams` (cached) for team membership, with 403/404 treated as indeterminate.
- REST for per-head checks (check runs + commit statuses) when the head SHA is not cached, so FR-024's neutral/skipped precedence can be computed exactly.
- REST for publishing (`POST .../pulls/{number}/reviews`), listing existing reviews, and refreshing a PR after an action.

**Rationale**: GraphQL collapses the board query into few requests and returns `reviewDecision`, `mergeable`, and review requests directly. Checks detail needs per-context data to honor FR-024; caching by head SHA avoids repeated cost. REST covers team membership and review publication, which GraphQL does not replace cleanly.

**Alternatives considered**: REST only (hundreds of calls for SC-003); GraphQL only (review creation still effectively REST, team membership awkward); `gh` CLI for data (unstructured, no throttling contract, harder to test).

## R6. Synchronization and lane derivation

**Decision**: Sync open PRs (all pages) plus merged/closed PRs updated within 30 days, ordered by update time. Upsert by `(repository, number)`. Run at most one sync per repository; up to three repositories in parallel. Treat a sync as `partial` when any detail fetch fails, keep the last good rows, and never mark a PR closed unless the complete merged/closed refresh confirms it. A previously open PR absent from both lists becomes `inaccessible`, not `closed`.

Lane derivation (shared pure function):
1. merged or closed → Done.
2. draft → Draft.
3. `reviewDecision = CHANGES_REQUESTED` → Request changes.
4. `reviewDecision = APPROVED` → Approved.
5. `reviewDecision = REVIEW_REQUIRED` → In review.
6. `reviewDecision` absent → use the latest decision-bearing review per reviewer (APPROVED, CHANGES_REQUESTED, DISMISSED; COMMENTED/PENDING never override); any changes requested → Request changes, else any approval → Approved, else In review.

**Rationale**: The order matches FR-011–FR-014 and handles repositories without branch-protection required reviews. Storing the review snapshot makes offline lane display possible and keeps the fallback auditable. Rate-limit waits are excluded from SC-003 measurement, matching SC-005's treatment of provider outages.

**Alternatives considered**: `reviewDecision` only (approved lanes disappear for repos without required reviews); counting all reviews (stale/dismissed approvals would keep incorrect lanes); optimistic lane updates (forbidden by FR-025).

## R7. Isolated Git retrieval

**Decision**: Maintain one bare cache per repository at `repos/<repoId>.git`. Fetch `+refs/pull/<n>/head:refs/pr/<n>` and the base branch into the cache. Compute `merge-base <base> <head>`, then diff `mergeBase..head`. Read file contents with `git show <head>:<path>` instead of checking out a worktree. Disable hooks, fsmonitor, external diff, textconv, and LFS smudge; never fetch submodules; never follow symlinks; validate paths against traversal.

**Rationale**: A bare cache plus blob reads means no working tree exists to run hooks, filters, or symlink targets, and the user's checkout is never touched (FR-036/037). `mergeBase..head` is exactly the PR-introduced change set (FR-039). Fetching `refs/pull/<n>/head` works for fork PRs. Preparation runs as a job: `POST /api/prs/{id}/diff` returns 202 and SSE reports progress, so a multi-minute first fetch never holds a browser request open.

**Alternatives considered**: Worktree checkout in a temp directory (triggers filters/hooks and LFS smudging; larger attack surface); GitHub compare API (lacks full hunks/renames and is rate-limited); isomorphic-git (slow on large repos, incomplete packfile behavior); cloning with `--filter=blob:none` (useful optimization, but a full bare fetch is simpler and still safe because nothing is checked out).

## R8. Diff, file, and rendering limits

**Decision**: Store and render at most 400 changed files, 20,000 changed lines, 1 MiB per text file, and 20 MiB of total text per PR. The file list is complete up to the file limit; content beyond any limit is marked truncated with a GitHub link. Binary, symlink, submodule, rename/copy, and mode-only changes are identified from `git raw`/`name-status` output and never treated as text failures.

**Rationale**: The spec requires truncation but named no values (FR-044). These limits keep the browser responsive and bound AI context and memory. The GitHub stats remain the source for board size; local diff limits apply to reading and rendering.

**Alternatives considered**: Unlimited rendering (freezes on generated/vendor files); per-file-only limit (total payload still unbounded); 1,000+ file rendering (violates responsiveness assumptions).

## R9. AI provider

**Decision**: One adapter for OpenAI-compatible `POST {AI_BASE_URL}/chat/completions`, supporting local (Ollama, LM Studio, llama.cpp) and remote endpoints. Configuration is environment-only: base URL, model, optional API key, timeout (default 180 s), and optional input/output token prices. Request a JSON schema response; if the endpoint rejects `json_schema`, retry once in the same run with JSON mode plus the schema embedded in the prompt. Abort on cancellation or timeout. Store model identity, usage, and computed cost only when all required values are available.

**Rationale**: A single compatibility layer covers the spec's "local or remote provider" assumption without vendor lock-in. JSON schema mode plus strict local validation prevents malformed output from becoming a review. The 180 s timeout is a ceiling; SC-005's 3-minute p90 target assumes provider p90 latency of at most 90 s and orchestration of at most 60 s, with provider outages and rate limits excluded and reported separately.

**Alternatives considered**: Provider-specific SDKs (multiple auth/error models); agent frameworks with tools (forbidden by FR-051); free-form text parsing (fails FR-057/066).

## R10. AI context and exclusions

**Decision**: Build a single bounded context from the reviewed head: PR title/body (untrusted), changed-file metadata, unified diff, and full text of eligible changed files up to 200 KiB each, under a 300,000-character budget. Exclude by default: `.env`/`.env.*`, `.git/**`, `.opencode/**`, `opencode.json(c)`, `AGENTS.md`, `CLAUDE.md`, `.github/copilot-instructions.md`, `.cursorrules`, `.cursor/rules/**`, credential/key patterns, binary files, symlinks, and submodules. Record reviewed and skipped files with reasons. Wrap all repository text in explicit untrusted-data delimiters and state that content cannot change reviewer rules.

**Rationale**: Full changed-file content grounds findings; the budget bounds cost and latency. The denylist is the FR-041 privacy boundary, and the skip list makes omissions visible (FR-064). The human diff remains complete (FR-040); only AI context is filtered. GitHub conversation comments and review threads are excluded from the context entirely in MVP (FR-053).

**Alternatives considered**: Sending only the diff (misses surrounding context, more false positives); sending whole repository (cost, privacy, prompt-injection surface); allowing repository instruction files (violates FR-041).

## R11. AI output validation

**Decision**: Validate the response against the JSON schema in `contracts/ai-review.schema.json` with Zod after JSON parsing. Require all review-level fields. Reject the whole run on invalid JSON, schema violations, unknown severity/category values, out-of-range confidence, or a missing verdict; never salvage partial findings. Preserve redacted diagnostics for at most 30 days. A user retry creates a new run.

**Rationale**: FR-066 forbids presenting partial output as a valid review. All-or-nothing validation keeps the draft trustworthy and makes failure states explicit. Redacted diagnostics support debugging without storing code or secrets indefinitely.

**Alternatives considered**: Best-effort repair of malformed JSON (can invent findings); accepting unknown categories (breaks filtering/UI); auto-retry inside the same run (hides failures and doubles cost).

## R12. Anchor validation, deduplication, and inline cap

**Decision**: Build a line map from the unified diff: eligible anchors are single added lines (RIGHT) or deleted lines (LEFT) inside change blocks. Context lines are ineligible, matching the documented stricter policy. For each finding: validate path, side, and line; if a quoted code block is present it must match that line after line-ending and trailing-space normalization. If the line is invalid or the quote mismatches, search the same file for exactly one eligible line matching the quote; zero or multiple matches demote to summary. Deduplicate by normalized path, side, line, and whitespace-normalized explanation, keeping the highest confidence. Sort by severity, confidence descending, path ascending, line ascending; propose the top 15 inline and represent the rest in the summary subject to FR-075 truncation.

**Rationale**: This makes SC-006's zero-422 outcome structural: only anchors that exist in the diff are ever sent. The deterministic order makes tests and previews reproducible. Demotion preserves information without risking misplaced comments.

**Alternatives considered**: Commenting on context lines (GitHub allows it, but the spec chose the stricter rule); fuzzy quote matching (risks wrong anchors); sending all valid findings inline (noise and payload risk).

## R13. Draft, preview, and publish idempotency

**Decision**: A draft is either AI-origin (created from a completed, non-stale run) or manual (created from the board composer and bound to the verified head). The preview is generated server-side and returns a short-lived token bound to a digest of the draft, event, head, and PR state. Publishing requires that token and explicit confirmation. Each draft carries a hidden marker `<!-- pr-review-dashboard:draft=<draftId> -->` derived from the immutable draft identity (the AI draft identity incorporates the run identity), appended to the review body after any truncation. Before sending, list existing reviews and search for the marker; if found, treat the review as published. Allow one in-flight post per draft via a DB lock. On timeout: mark uncertain, re-check the marker, wait at least 10 seconds and re-check once more, then allow one user-confirmed retry with the same marker. On 422 anchor rejection: move rejected comments to the summary, retry once with valid comments and the same marker. On own-PR or draft approval rejection: offer a comment review with the same findings and preserve the intended event in audit.

**Rationale**: Server-generated previews cannot drift from what is submitted. The marker plus pre-check and lock covers retries, restarts, and multi-tab races (FR-081–FR-086). The 10-second window bounds the unavoidable race where GitHub accepted a review but the response was lost but does not eliminate it; the spec records this residual risk in Assumptions, SC-007 is scoped to at most one review per draft across the defined test scenarios, and the UI never claims a different outcome without marker verification.

**Alternatives considered**: Client-generated payload (can diverge from preview); relying on commit SHA alone (multiple reviews per commit are legitimate); no marker (cannot detect a timed-out success); optimistic UI (forbidden by FR-025/077).

## R14. Jobs, concurrency, and restart recovery

**Decision**: In-process async queue with: one sync per repository, up to three repositories in parallel, at most two AI runs globally, one active AI run per PR, and one publish in flight per draft. Persist every state change before emitting SSE. On startup, queued/running runs become `interrupted`, pending posts become `uncertain`, and no post is retried without marker verification. Cancellation uses `AbortController` and marks the run `cancelled`; partial findings are discarded.

**Rationale**: Single-process ownership makes locks simple and reliable; limits protect GitHub rate limits and AI cost. Persist-before-emit prevents the UI from showing states the database cannot recover. Startup recovery directly implements FR-067/069/088/094.

**Alternatives considered**: External queue/worker (operational overhead for one user); per-request stateless jobs (no crash recovery); parallel sync of every repository (secondary rate-limit risk).

## R15. Local security model

**Decision**: Bind only `127.0.0.1`; choose an ephemeral port; allow only the app's own Host and Origin; require `X-CSRF-Token` from `GET /api/session` on every mutation; send no CORS headers; set a strict CSP; serve no service worker. Sanitize all GitHub and AI Markdown at the AST level. Validate every path against the cache root and reject control characters and traversal. Git authentication uses an ephemeral askpass helper with the token in the child environment, never argv or config files. Log redaction covers authorization headers, tokens, secret-like values, and denylisted file bodies.

**Rationale**: A localhost HTTP server is reachable by any local process and by malicious pages via browser requests; Origin/CSRF and a random path/port reduce drive-by risk. AST sanitization prevents XSS from PR bodies or AI output. Askpass avoids token exposure in process listings or Git config.

**Alternatives considered**: Unix socket/Windows named pipe (browser cannot connect directly); no CSRF protection (localhost CSRF is real); token in remote URL (leaks in config/logs); `dangerouslySetInnerHTML` plus DOMPurify (easier to misuse than rehype-sanitize).

## R16. Persistence and retention

**Decision**: SQLite holds repositories, PR snapshots, decision-bearing reviews, sync runs, local copies, review runs, findings, drafts, draft findings, posts, acknowledgements, team membership cache, artifacts metadata, activity, and migrations. Artifact files hold redacted diagnostics. A cleanup job runs at startup and every 6 hours: delete superseded copies, delete copies not accessed for 14 days unless an active run references them, delete diagnostics older than 30 days, and checkpoint WAL. Disconnect removes the repository's rows in one transaction, then its cache and artifact directories.

**Rationale**: The database is the source of truth for offline reading, audit, and idempotency. Retention matches FR-049/066/091. Disconnect semantics match FR-007/092. Keeping diagnostics out of SQLite bounds database growth.

**Alternatives considered**: Filesystem-only JSON (no transactions/locks); storing diagnostics in SQLite (bloat, harder redaction); indefinite retention (violates 14/30-day rules).

## R17. UI state, offline, and realtime

**Decision**: TanStack Query caches server state; SSE (`/api/events`) pushes sync, review, and publish progress and invalidates board/PR queries. No optimistic lane movement: after mark-ready or publish, the card moves only when GitHub data is re-fetched (FR-025/029). Offline is detected by `navigator.onLine` plus failed GitHub probes; the board renders from SQLite with a freshness banner, while sync, review, and publish controls are disabled (FR-026/093). UI copy is a Vietnamese dictionary; review content is fixed English; dates use `vi-VN`; status uses text + icon.

**Rationale**: SSE is one-way, simpler than WebSocket, and reconnects natively. Server-side data stays authoritative, so tabs converge after every mutation. Offline behavior is a query/disable policy rather than a separate mode.

**Alternatives considered**: Polling only (delays and load); WebSocket (bidirectional complexity); Redux (duplicates query cache); client-side optimistic lanes (wrong lanes on failure).

## R18. Accessibility

**Decision**: dnd-kit keyboard sensor with a "Move to…" card menu as the non-drag path; Radix dialog/menu/tabs for focus trapping and roving focus; visible focus rings; `aria-live` for sync/review/publish progress; status as text + icon; Playwright keyboard-only journeys covering board actions, tabs, file navigation, review start/cancel, and publish confirmation.

**Rationale**: FR-032/098 and SC-014 require every action without drag-and-drop. dnd-kit and Radix provide tested primitives instead of custom focus handling.

**Alternatives considered**: HTML5 drag events (poor keyboard support); custom menus (more accessibility bugs); mouse-only board (violates SC-014).

## R19. Testing strategy

**Decision**:
- Unit: lane derivation, checks aggregate, anchor validation/re-anchoring, dedupe/cap ordering, marker generation, retention math, redaction, schema validation, path guards.
- Contract: OpenAPI route tests, AI schema fixtures, GitHub response fixtures, SSE event shape.
- Integration: SQLite + job queue + real temporary bare Git repos + MSW GitHub + fake OpenAI-compatible server; sync idempotency, partial sync, rate-limit backoff, review cancellation, 422 fallback, timeout/marker, restart recovery, multi-tab publish lock.
- E2E: Playwright against the built app with seeded fixtures: connect/sync, board filters, mark-ready, manual review composer, diff/truncation/stale/offline with disabled mutating controls, AI run progress, triage, preview/publish, own-PR/draft fallback, keyboard-only, multi-tab, redaction checks.
- Performance: seeded 100-PR board, generated 1 GB working-tree repository fixture, and timed triage journey to measure SC-003/SC-004/SC-009 locally; the AI orchestration and provider-latency budgets in SC-005 are measured separately.

**Rationale**: Real Git fixtures exercise the actual isolation and diff code; MSW and a fake AI server make failure modes deterministic; Playwright covers multi-tab, offline, and keyboard requirements that unit tests cannot.

**Alternatives considered**: Mocking Git (would miss filter/hook behavior); live GitHub in CI (rate limits, credentials, flakiness); snapshot-only UI tests (no behavioral coverage).

## R20. Performance approach

**Decision**: GraphQL pagination with 100-item pages; cache checks/reviews by head SHA; sync repositories in parallel up to three; short SQLite transactions with indexes on lane, updated time, PR number, and run status; virtualize board lanes above 100 cards, the diff file list, and long hunks; build the diff once per head and serve file content from memory/disk cache; stream progress over SSE. Rate-limit waits are excluded from SC-003 timing and are surfaced as retry/reset times.

**Rationale**: These choices target the measured criteria directly and avoid re-fetching immutable per-commit data. Virtualization keeps hundreds of files responsive.

**Alternatives considered**: Fetching everything on every sync (slow, rate-limited); rendering every diff line (freezes); a single global sync (underuses the 30-second budget).

## R21. Packaging and operations

**Decision**: npm workspaces with scripts: `npm run dev` (Fastify + Vite), `npm run build`, `npm start` (serves built SPA), `npm run typecheck`, `npm run lint`, `npm test`, `npm run test:integration`, `npm run test:e2e`, `npm run test:perf`. No admin rights, no service install, no auto-update. Data lives under `%LOCALAPPDATA%\PRReviewDashboard\` with an `APP_DATA_DIR` override for tests. Startup verifies Git availability and the SQLite schema before accepting requests.

**Rationale**: A plain Node launch is the lowest-risk Windows distribution for the MVP and keeps the spec's "one local machine" assumption. Environment configuration matches the credential/model assumptions.

**Alternatives considered**: MSI/installer or auto-update (out of scope, adds signing and elevation); Docker (violates local-first simplicity on Windows); Electron packaging (deferred).

## R22. Open questions

None. All spec-level ambiguities that affected design are resolved by the decisions above; remaining product refinements (for example exact diff limits) are recorded as configurable defaults in `plan.md` and `data-model.md`.
