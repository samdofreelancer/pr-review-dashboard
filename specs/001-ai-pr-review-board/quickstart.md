# Quickstart and Validation Guide

**Feature**: AI-Assisted PR Review Board | **Plan**: [plan.md](./plan.md) | **Spec**: [spec.md](./spec.md)

This guide is the run and validation reference for the implemented feature. It does not contain implementation code. All API shapes are in [contracts/openapi.yaml](./contracts/openapi.yaml); state rules are in [data-model.md](./data-model.md).

## 1. Prerequisites

- Windows 10/11 x64.
- Node.js 22.13 or newer (`node -v`); npm 10 or newer.
- Git 2.30 or newer on `PATH` (`git --version`). The app refuses to start synchronizing without it.
- A GitHub credential configured outside the app, in precedence order:
  1. `GH_TOKEN`
  2. `GITHUB_TOKEN`
  3. an authenticated `gh` CLI session (`gh auth login`)
- Token permissions: repository metadata/contents/checks/pull requests read; pull request reviews write for publishing; `read:org` for team-review detection. Missing team permission is shown as indeterminate, not as an error.
- An OpenAI-compatible chat completions endpoint, local or remote (Ollama, LM Studio, llama.cpp, or a hosted provider), if AI review is needed.
- Free disk space for isolated caches and artifacts.

## 2. Install and configure

```bash
npm install
```

Environment (set in the shell; the app provides no token or model UI):

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `GH_TOKEN` / `GITHUB_TOKEN` | one source | — | GitHub credential; never stored |
| `AI_BASE_URL` | for AI review | — | OpenAI-compatible base URL, e.g. `http://127.0.0.1:11434/v1` |
| `AI_MODEL` | for AI review | — | Model identity stored on each run |
| `AI_API_KEY` | remote providers | — | Sent only to the AI endpoint |
| `AI_TIMEOUT_MS` | no | `180000` | Review timeout ceiling; cancellation still works |
| `AI_MAX_CONTEXT_CHARS` | no | `300000` | Context budget |
| `AI_PRICE_INPUT_PER_MTOK` | no | — | Enables cost display when usage is reported |
| `AI_PRICE_OUTPUT_PER_MTOK` | no | — | Enables cost display when usage is reported |
| `PORT` | no | `0` (random) | Loopback port |
| `APP_DATA_DIR` | no | `%LOCALAPPDATA%\PRReviewDashboard` | Data root for tests or portable runs |

`AI_TIMEOUT_MS` is a safety ceiling, not a performance target: SC-005 assumes a provider p90 of at most 90 seconds and orchestration from verified head to validated draft within 60 seconds p90, independent of this value. Data is written under `data\app.db`, `repos\`, `artifacts\`, and `logs\`. No GitHub or AI key is written there.

## 3. Run

```bash
npm run dev      # Fastify + Vite, opens http://127.0.0.1:<port>
npm run build
npm start        # serves the built SPA from the local server
npm run typecheck
npm run lint
```

Startup checks Git availability, runs migrations, marks interrupted work, and starts the cleanup job. The default browser is opened by the launcher; any additional tab shares the same server, database, and publish lock.

## 4. First run

1. Open the app. If the credential is missing or invalid, the app shows a repair message and does not offer an in-app token form (FR-001/004).
2. Connect a repository using the picker or `owner/repository` (FR-006).
3. Wait for the first sync. The board shows five lanes, visible counts, freshness, and last successful sync (FR-019/020).
4. Open a pull request, run an AI review, acknowledge the AI destination for that repository on first use, triage findings, preview, and publish (FR-008/025/077). Approve or Request changes can also start from a board card without an AI run, which creates a manual draft bound to the verified head (FR-030).

## 5. Automated validation

```bash
npm test                 # unit + contract
npm run test:integration # SQLite, job queue, real temp Git repos, MSW GitHub, fake AI
npm run test:e2e         # Playwright: board, diff, review, publish, keyboard, offline, multi-tab
npm run test:perf        # seeded 100-PR board and 1 GB working-tree fixture
```

Fixtures are generated per run in a temporary directory: bare Git repositories with PR heads, GitHub GraphQL/REST fixtures, and a fake OpenAI-compatible server. E2E starts the real app against those fixtures; no real GitHub repository or AI key is required.

## 6. Manual validation scenarios

Each scenario maps to the spec. Run `npm run test:e2e -- --grep "<scenario>"` where an automated version exists; otherwise perform the steps in a scratch GitHub repository.

| # | Scenario | Setup | Steps | Expected |
|---|---|---|---|---|
| V1 | Connect and sync | Valid credential, one repository with open/draft/approved/changes-requested/review-required/merged/closed PRs | Open app → connect → sync | Correct lanes for all 50 fixture PRs; titles, authors, size, checks, labels, review state, draft, mergeability, commits visible; <2 min to populated board (SC-001/002) |
| V2 | Lane fallback | Repo without required-review protection; one approval and one commented review | Sync | Approval still maps to Approved; a later COMMENTED review does not remove it (FR-013/014) |
| V3 | Draft ready | Draft PR with prior approvals | Drag Draft → In review → confirm; also use card menu | GitHub draft flag cleared; card is refreshed before moving; maybe lands in Approved if GitHub reports approval; other lanes unchanged (FR-029) |
| V4 | Search and filters | Multiple repos, labels, team request with/without `read:org` | Search title/author/repo/label/number; toggle Needs my review; clear | Matches constrained by selected repo; team requests indeterminate are not counted as personal; repo selection preserved (FR-017/018) |
| V5 | Sync failure and offline | Expire token or block network mid-sync | Observe board | Last good board remains; explicit auth/offline/freshness banner; retry works; no PR falsely closed (FR-020/021/026) |
| V6 | Local diff | PR with renamed, copied, binary, symlink, submodule, mode-only, and oversized files | Open diff (preparation runs as a job with SSE progress); switch files | File list, change types, hunks, old/new line numbers; truncation marked with GitHub link; user checkout untouched; switching reuses prepared copy and does not refetch the repository (FR-038/040/042/043/044) |
| V7 | Stale and unverified diff | Push a new commit after sync; then go offline and open cached diff | Reopen diff; publish attempt | Stale/unverified banner with displayed commit; AI review and publishing blocked (FR-045/046/047) |
| V8 | AI review lifecycle | Fake AI with valid output and one cancel run | Start review; cancel a second run | Progress, phase, elapsed, tokens/cost when reported; cancelled run discards partial findings; new run gets a new identity (FR-054/055/056) |
| V9 | Anchor validation and cap | Fake output with invalid path/line, quote re-anchor, duplicate, 20 valid findings | Run review; inspect draft | Invalid anchors demoted; unique quote re-anchored; duplicates collapsed; top 15 inline by severity/confidence/path/line; rest in summary (FR-061/062/063, SC-006) |
| V10 | Untrusted input | PR modifies `.env`, `AGENTS.md`, `.cursor/rules`, and contains prompt-injection text and HTML | Run review; inspect AI request fixture and UI | Denylisted content absent from AI payload; human diff still shows it with warning; AI Markdown sanitized; no state change from injected text (FR-041/053/068, SC-013) |
| V11 | Triage and preview | Completed run with valid, demoted, and manual findings | Accept/dismiss/edit/add ten findings; preview; reach confirmation | Counts update immediately; original AI output retained; preview shows event, commit, summary, every inline comment, warnings; no post before confirmation; triage to confirmation under three minutes (FR-070/074/075, SC-009) |
| V12 | Publish paths | Own PR; draft PR; normal PR | Publish approve/request changes/comment | Own PR and draft approval offer comment fallback with confirmation; normal publish creates one review with only accepted findings; activity and PR refreshed (FR-079/080/087, SC-007/008) |
| V13 | Anchor rejection | Fake GitHub rejects one inline anchor with 422 | Publish | Rejected comment moved to summary; valid comments preserved; one retry with same marker; user told what changed (FR-084) |
| V14 | Timeout, restart, multi-tab | Fake GitHub times out after accepting; restart during run/publish; publish from two tabs | Retry from both tabs; restart app | At most one review; uncertain post requires marker check and confirmation; interrupted run not publishable; second tab sees same result (FR-083/086/088/094, SC-007) |
| V15 | Keyboard-only | Any populated board | Complete connect-to-publish journey without mouse | All actions reachable; focus visible; status conveyed by text/icon; no drag required (FR-032/098, SC-014) |
| V16 | Redaction and retention | Token, secret-looking files, diagnostics, old copies | Inspect UI, logs, DB, artifacts; advance clock in tests | Token absent everywhere; diagnostics/copies expire at 30/14 days; audit remains until disconnect (FR-091/095, SC-013) |
| V17 | Performance | Seeded 5 repos/100 PRs; 1 GB fixture repo; <500-line PR | Measure sync, first prep, diff open/switch, AI review | SC-003/004/005 targets; rate-limit waits excluded, reported separately with retry/reset time; SC-005 split into provider p90 (≤90 s) and orchestration p90 (≤60 s) |
| V18 | Language | Any review with findings | Inspect UI and generated content | UI labels/errors Vietnamese; review summary/comments English; no language selector (FR-065, SC-011) |
| V19 | Board-initiated manual draft | Open PR with no AI run | Card menu → Approve or Request changes → composer → preview → publish | Manual draft created with no run, a unique marker, and the verified head; the chosen event is preselected; own-PR/draft fallback offers Comment; exactly one review is created (FR-030/079/081/087) |

## 7. Live smoke procedure

1. Use a scratch GitHub repository containing one draft, one in-review, one approved, and one merged PR.
2. Set `GH_TOKEN` (or authenticate `gh`) and a local or remote AI endpoint.
3. `npm run dev`; connect the repository; sync; open each lane.
4. Run an AI review on the in-review PR; verify the request uses the displayed head.
5. Preview a comment review, publish, and confirm exactly one review appears on GitHub with the expected inline comments.
6. Push a new commit; verify the previous run/draft becomes stale and publishing is blocked.
7. Stop the app mid-review, restart, and verify the run is interrupted and not publishable.

## 8. Troubleshooting

| Symptom | Cause | Action |
|---|---|---|
| `AUTH_MISSING` / `AUTH_INVALID` | No credential or expired token | `gh auth login` or set `GH_TOKEN`; retry from the banner |
| Board shows partial data | GitHub detail fetch failed but core list succeeded | Keep working from last good data; retry sync; check rate-limit reset |
| `RATE_LIMITED` | GitHub primary/secondary limit | Wait for the shown reset; the board remains usable |
| `GIT_MISSING` | Git not on `PATH` | Install Git and restart the app |
| `GIT_PREP_FAILED` | Auth, missing ref, disk, network, or corrupt cache | Follow the specific message; retry; the app never shows partial data as valid |
| `AI_INVALID_OUTPUT` | Provider returned invalid JSON/schema | Run failed by design; check model/JSON-schema support and retry as a new run |
| `PREVIEW_EXPIRED` / `CONFLICT` | Draft, head, or PR state changed after preview | Regenerate preview and confirm again |
| `PUBLISH_IN_FLIGHT` | Another tab is publishing | Wait for the current attempt; both tabs converge through SSE |
| `uncertain` publish | Timeout after GitHub may have accepted | Do not retry blindly; the app verifies the hidden marker and requires confirmation |
| Port unavailable | Fixed port in use | Use `PORT=0` or another free port |

## 9. Reset local data

Close the app, then remove `%LOCALAPPDATA%\PRReviewDashboard` (or the `APP_DATA_DIR` override). This deletes the database, bare caches, diagnostics, and logs; nothing on GitHub is changed. Prefer disconnecting repositories in the app when audit history is not needed.

## 10. Acceptance evidence

Store the automated run for each scenario plus a short manual note in the feature folder: command, fixture revision, app version, and observed result. SC-001–SC-015 are covered by V1–V19; any scenario that cannot run (for example, a real rate-limit window) must be recorded as not executed rather than marked passing.
