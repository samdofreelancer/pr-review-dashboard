# Implementation Plan: AI-Assisted PR Review Board

**Branch**: `001-ai-pr-review-board` | **Date**: 2026-10-28 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/001-ai-pr-review-board/spec.md`

## Summary

Build a local-first web application for one GitHub reviewer on Windows. A loopback-only Node.js service synchronizes pull requests through GitHub GraphQL/REST, derives the five board lanes strictly from GitHub state, prepares an isolated bare-Git copy and diff for the displayed head commit, runs a single-shot read-only AI review over that diff, validates every finding against eligible diff lines, and publishes only a human-confirmed review carrying a hidden idempotency marker. A React SPA provides the Vietnamese board, diff, AI review, triage, preview, and activity surfaces. SQLite stores board snapshots, runs, findings, drafts, posts, and audit data. Pull request code is never executed, the user's checkout is never touched, and credentials are read from the environment or `gh` CLI and never persisted or logged.

## Technical Context

**Language/Version**: TypeScript 5.x; Node.js 22.13+ (22 LTS and 24 both supported); React 19

**Primary Dependencies**: Fastify 5 (HTTP + static hosting); React 19 + Vite 7; TanStack Query 5; dnd-kit (accessible board drag); Radix UI primitives (dialog, menu, tabs, toast); Octokit GraphQL/REST with throttling and retry plugins; Zod; `node:sqlite`; `parse-diff`; react-markdown + rehype-sanitize; Vitest; Playwright; MSW

**Storage**: SQLite (WAL, foreign keys, busy timeout) at `%LOCALAPPDATA%\PRReviewDashboard\data\app.db`; bare Git cache at `%LOCALAPPDATA%\PRReviewDashboard\repos\<repoId>.git`; redacted diagnostics at `...\artifacts\`; logs at `...\logs\`. No credential is stored.

**Testing**: Vitest for unit, contract, and integration tests; MSW for GitHub and AI HTTP; real temporary bare Git repositories as fixtures; Playwright for E2E (board DnD + keyboard, diff, triage, publish races, multi-tab, offline)

**Target Platform**: Windows 10/11 x64; local server bound to `127.0.0.1` only; current Chromium/Edge/Firefox

**Project Type**: Local web application (Node backend + React SPA served by the backend in production)

**Performance Goals**: Sync 5 repositories / 100 open PRs under 30 s excluding rate-limit wait, reported separately (SC-003); first preparation of a repository with a working tree up to 1 GB within 10 min p90, then diff open ≤2 s and file switch ≤1 s p95 (SC-004); AI orchestration from verified head through validated draft ≤60 s p90 and end-to-end review ≤3 min p90 when provider p90 latency is ≤90 s, excluding provider outages, provider rate limits, and GitHub rate-limit waits (SC-005); triage 10 findings to confirmation under 3 min with measured timing (SC-009)

**Constraints**: No PR code execution, installs, tests, scripts, hooks, filters, or submodules (FR-037/051); user checkout never mutated (FR-036); credential never persisted, displayed, or logged (FR-003/090/095); loopback-only with Host/Origin/CSRF checks; offline read-only board (FR-093); one active review run per PR and one publish in flight per draft (FR-056/086); retention 14 days for local copies and 30 days for diagnostics (FR-049/091); diff limits 400 files, 20,000 changed lines, 1 MiB per text file, 20 MiB total text; AI context budget 300,000 characters; review summary 60,000 characters and inline comment 10,000 characters; top 15 inline findings

**Scale/Scope**: 1 user, up to 5 connected repositories, about 100 open PRs (hundreds stored), diffs with hundreds of files using truncation, 5 lanes, 4 detail tabs, 1 configured AI provider, 1 browser UI

## Constitution Check

No constitution has been ratified: `.specify/memory/constitution.md` does not exist and `.specify/memory/` contains only the install template. The gates below are derived from the specification's non-negotiables and are treated as blocking. They must be re-checked if a constitution is ratified before implementation.

| Gate | Source | Plan response | Status |
|---|---|---|---|
| No execution of pull request code | FR-037, FR-051 | Bare Git cache; only plumbing commands (`fetch`, `merge-base`, `diff`, `show`, `cat-file`); hooks, fsmonitor, external diff, textconv, smudge filters disabled; symlinks and submodules never followed | PASS |
| User checkout untouched | FR-036 | All Git commands target the app-private bare cache; the user's repository path is never used as input | PASS |
| Credential secrecy | FR-003, FR-090, FR-095 | Token resolved per request in memory; Git auth through an ephemeral askpass helper; structured logging redaction; no credential columns, UI fields, activity entries, or diagnostics | PASS |
| Read-only AI, one endpoint | FR-051, FR-052 | Single-shot OpenAI-compatible HTTP request with an abort signal; no tool loop, no web access, no file writes; provider destination disclosed per repository | PASS |
| Human-approved publishing | FR-077 | Server-generated preview plus a short-lived preview token; publish requires that token and explicit confirmation; AI code paths cannot call publish | PASS |
| Idempotent publishing | FR-081–FR-086 | Per-draft hidden marker in the review body; marker pre-check; single-flight DB lock; one anchor-rejection retry; uncertain-outcome verification with a bounded residual race documented in spec Assumptions | PASS |
| Untrusted input | FR-053, FR-068 | Delimited untrusted context, path denylist, schema validation of AI output, AST-level Markdown sanitization, no raw HTML | PASS |
| Accessibility | FR-032, FR-098 | dnd-kit keyboard sensor plus card action menus; Radix focus management; `aria-live` progress; status conveyed by text and icon, not color alone | PASS |
| Data lifecycle | FR-049, FR-091, FR-092 | Cleanup job for copies and diagnostics; audit retained until disconnect; disconnect cascades DB rows and cache directories | PASS |

No violations; Complexity Tracking is empty.

## Project Structure

### Documentation (this feature)

```text
specs/001-ai-pr-review-board/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── openapi.yaml
│   ├── ai-review.schema.json
│   └── events.md
└── checklists/
    └── requirements.md
```

### Source Code (repository root)

```text
package.json                    # npm workspaces: shared, server, web
shared/
└── src/
    ├── types/                  # Lane, PR, run, finding, draft, post, activity contracts
    ├── schemas/                # Zod schemas shared by API and UI
    ├── lane/                   # GitHub-state lane derivation
    ├── checks/                 # checks aggregate precedence
    └── limits/                 # diff, AI context, summary, inline, retention constants

server/
├── migrations/                 # Forward-only SQL migrations
├── src/
│   ├── index.ts                # Startup, browser launch, graceful shutdown
│   ├── config/                 # Env + trusted local config, no secrets in DB
│   ├── api/                    # Fastify routes, session/CSRF, SSE, error mapping
│   ├── github/                 # Auth resolution, clients, sync, reviews, teams
│   ├── git/                    # Bare cache, fetch, merge-base, diff, blob reads, safety
│   ├── ai/                     # Provider adapter, prompt/context builder, output validation
│   ├── review/                 # Anchors, dedupe, cap, draft, preview, publish, marker
│   ├── db/                     # SQLite connection, migrations, repositories, transactions
│   ├── jobs/                   # Queue, cancellation, per-repo locks, restart recovery
│   ├── security/               # Origin/Host checks, redaction, path guards
│   └── observability/          # Logger, activity recording
└── tests/
    ├── contract/
    ├── integration/
    ├── unit/
    └── fixtures/               # Bare repos, GitHub/AI fixtures, seed data

web/
├── src/
│   ├── app/                    # Router, providers, query client
│   ├── api/                    # Typed fetch client, SSE hook
│   ├── pages/                  # Board, pull request detail
│   ├── features/               # board, diff, ai-review, triage, publish, activity
│   ├── components/             # Shared UI, dialogs, banners, empty states
│   └── styles/
└── tests/
    ├── unit/
    └── e2e/
```

**Structure Decision**: Use npm workspaces with three packages. `shared` holds contracts and pure domain rules so the server and UI cannot drift; `server` owns GitHub, Git, AI, SQLite, jobs, and the HTTP API; `web` is a Vite SPA served by Fastify in production and proxied in development. This keeps the domain rules testable without HTTP and keeps all privileged operations server-side. A separate desktop shell is unnecessary because the spec assumes a supported browser and multi-tab behavior.

## Delivery Slices

1. **Foundation**: workspace, configuration, SQLite migrations, security middleware, redacted logging, SSE plumbing, shared schemas.
2. **P1 board**: credential resolution, repository connection, sync pipeline, lane derivation, board/search/filter, mark-ready action, offline/rate-limit retention, activity.
3. **P2 local diff**: bare cache, safe fetch, merge-base diff, file navigation, special files, truncation, staleness and offline unverified state.
4. **P2 AI review**: context builder with denylist, provider adapter, run lifecycle and cancellation, strict schema validation, anchor validation, dedupe and inline cap, stale detection.
5. **P3 publish**: draft editing, preview token, marker idempotency, own-PR/draft fallback, anchor-rejection retry, timeout/restart recovery, multi-tab single-flight.
6. **Hardening**: retention cleanup, redaction tests, accessibility, keyboard E2E, performance fixtures, quickstart validation.

## Post-Design Constitution Re-Check

After Phase 1 design, the data model, HTTP contract, AI output schema, and SSE contract were checked against every gate above. The design introduces no new execution path, credential store, or autonomous publishing path, and all state transitions remain server-enforced. Result: PASS, no violations.
