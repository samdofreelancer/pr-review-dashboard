# Feature Specification: AI-Assisted PR Review Board

**Feature Branch**: `001-ai-pr-review-board`

**Created**: 2026-10-28

**Status**: Revised after specification review — awaiting approval

**Input**: Local-first AI-assisted pull request review dashboard for a single GitHub user: sync pull requests into a GitHub-derived kanban board, inspect local diffs, run a read-only AI review, triage validated findings, and publish an approved review to GitHub.

## Glossary

- **Lane**: One of the five board columns: Draft, In review, Request changes, Approved, Done. A lane is always derived from current GitHub pull request data, never manually assigned.
- **Head commit**: The latest commit on the pull request branch at the time a local diff or review run is created.
- **Local copy**: An isolated local retrieval of one pull request head commit used for inspection and AI review. It is separate from the user's normal repository checkout.
- **Review run**: One AI-assisted analysis attempt bound to one pull request and one head commit.
- **Finding**: One structured review observation produced by a run or added manually, with a location, severity, category, explanation, and triage state.
- **Review draft**: The human-curated set of accepted findings, summary, selected GitHub event, and target commit. A draft is either AI-origin (created from a completed review run) or manual (created from the board review composer).
- **Publish**: Submit one review draft to GitHub as a single review.
- **Review post**: One publish attempt or successful GitHub review, identified by the draft's hidden idempotency marker.
- **Stale**: A local diff, finding set, review run, or draft whose head commit or pull request state no longer matches GitHub.
- **Anchor**: A file path, side, and line number identifying where an inline review comment will attach.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Monitor and triage pull requests on an accurate board (Priority: P1)

As a developer who reviews pull requests across several GitHub repositories, I want one board that reflects the real GitHub state of every pull request, so I can see what needs my attention and act without opening each repository separately.

**Why this priority**: The board is the entry point for every other workflow. Without trustworthy synchronization between GitHub and the five lanes, AI review and posting add risk instead of removing work.

**Independent Test**: Connect a test repository containing open, draft, approved, changes-requested, review-required, merged, and closed pull requests. Sync it and verify every pull request appears in the correct lane, search and "Needs my review" return the expected items, and marking a draft ready updates both GitHub and the board without changing any other lane.

**Acceptance Scenarios**:

1. **Given** the local GitHub credential is missing, expired, or lacks repository access, **When** the user opens the app, **Then** the app explains the authentication problem, gives repair instructions, and does not offer an in-app token entry form in MVP.
2. **Given** a valid credential has repositories, **When** the user opens the repository picker, **Then** the user can search accessible repositories or enter an `owner/repository` reference, and connect one without restarting the app.
3. **Given** a repository is connected, **When** the user synchronizes, **Then** open pull requests and pull requests updated within the last 30 days appear with title, repository, author, body availability, timestamps, size, labels, review state, requested reviewers, checks state, mergeability, head commit, base branch, and draft state.
4. **Given** a draft pull request with prior approvals, **When** it is synchronized, **Then** it appears in Draft.
5. **Given** a merged or closed pull request last updated within 30 days, **When** it is synchronized, **Then** it appears in Done and shows whether it was merged or closed.
6. **Given** a non-draft pull request whose GitHub review decision is changes requested, **When** it is synchronized, **Then** it appears in Request changes.
7. **Given** a non-draft pull request whose GitHub review decision is approved, **When** it is synchronized, **Then** it appears in Approved.
8. **Given** a non-draft pull request whose GitHub review decision is review required, **When** it is synchronized, **Then** it remains In review even if one approval exists.
9. **Given** GitHub provides no review decision because the base branch has no required-review rule, **When** current non-dismissed reviews contain an approval and no changes-requested decision, **Then** the pull request appears in Approved; if no approval exists, it remains In review.
10. **Given** a previously approving review was dismissed or superseded after a new commit, **When** the pull request is synchronized, **Then** that review does not keep the pull request in Approved unless GitHub still reports the current decision as approved.
11. **Given** a draft pull request, **When** the user drags it to In review and confirms, **Then** the app marks it ready for review on GitHub and refreshes the card before moving it.
12. **Given** any unsupported drag transition, **When** the user drops the card, **Then** the card returns to its original lane and a message explains the available alternative action.
13. **Given** a populated board, **When** the user searches or filters, **Then** matches are constrained by the selected repository, "Needs my review" includes direct requests and requests to teams the user belongs to, and clearing filters preserves the selected repository.
14. **Given** a lane is displayed, **When** it contains pull requests, **Then** cards are sorted by most recently updated by default and the lane header shows the visible count.
15. **Given** synchronization is rate-limited, partially fails, or the device is offline, **When** the user views the board, **Then** the last known good data remains visible with an explicit freshness/error banner, failed operations are retryable, and the app does not claim the data is current.
16. **Given** the pull request is already in a non-draft review state, **When** the user opens its action menu, **Then** Request changes and Approve are available and open the review composer, while merging or closing from the board is not offered.

---

### User Story 2 - Inspect a pull request's changes locally (Priority: P2)

As a reviewer, I want to inspect the exact changed files and lines from a pull request in the app, using a local isolated copy, so I can understand the change and trust that the review is based on the latest commit.

**Why this priority**: Local code is necessary for grounded AI findings and for validating that every inline comment points to a real changed line. The diff viewer also provides value without AI.

**Independent Test**: Open a pull request in a test repository and request its local diff. Verify changed-file navigation, additions/deletions, anchored line numbers, special-file handling, and commit identity. Change the pull request head, reopen it, and verify the app marks the displayed diff stale and prevents a subsequent publish.

**Acceptance Scenarios**:

1. **Given** a pull request with changed files, **When** the user opens the local diff, **Then** the app prepares an isolated local copy of the displayed head commit and shows a navigable list of changed files with additions and deletions.
2. **Given** the diff is displayed, **When** the user selects a file, **Then** the app shows its change blocks, old and new line numbers, and added, removed, and unchanged lines without modifying the user's existing repository checkout.
3. **Given** a renamed, copied, binary, submodule, symlink, or metadata-only file, **When** it is selected, **Then** the app identifies its change type and shows all safely available information without following links or executing content.
4. **Given** a diff larger than the supported viewing limit, **When** it is prepared, **Then** the app clearly marks it as truncated and directs the user to GitHub for the remainder.
5. **Given** GitHub's head has changed since the board was synchronized, **When** the local diff is prepared, **Then** the app highlights that the board data is stale and identifies the commit actually displayed.
6. **Given** the device is offline or GitHub cannot confirm the current head, **When** the user opens a cached local diff, **Then** the diff is read-only with an unverified/stale warning, and AI review and publishing remain blocked.
7. **Given** the local copy cannot be prepared because Git is unavailable, disk space is insufficient, authentication fails, the network is down, a ref is missing, or the repository is invalid, **When** preparation fails, **Then** the user sees an actionable explanation and no partial or corrupted data is presented as a valid diff.
8. **Given** preparation succeeds, **When** the user switches files, **Then** a previously prepared diff responds without repeating the full repository retrieval.

---

### User Story 3 - Run an AI-assisted review and triage findings (Priority: P2)

As a reviewer, I want a read-only AI reviewer to analyze the local pull request diff and produce structured findings, so I can find real risks faster while retaining full control over what is accepted.

**Why this priority**: This is the core value of the product. It must run against the same commit and diff the user sees, and its output must be validated before it can become a GitHub comment.

**Dependency**: User Story 3 requires the local diff capability from User Story 2. It can be demonstrated independently with a successful local diff and a test repository containing known issues.

**Independent Test**: Run a review on a pull request with known issues. Verify provider acknowledgement, progress, cancellation, structured findings, anchor validation, inline cap, token and cost reporting, stale marking after a new commit, and finding triage.

**Acceptance Scenarios**:

1. **Given** a repository has not been acknowledged for AI processing, **When** the user starts the first review, **Then** the app states whether code may leave the machine, identifies the configured AI destination when known, and requires acknowledgement before proceeding.
2. **Given** a pull request is selected and GitHub head is verified, **When** the user starts an AI review, **Then** the run is associated with that exact head commit and the current local diff.
3. **Given** a review is running, **When** the user observes the review panel, **Then** status, current phase, elapsed time, and cancellation are visible and token usage/cost appear when available.
4. **Given** the user cancels a run, **When** cancellation completes, **Then** the run is marked cancelled, partial findings are not proposed for publishing, and a retry creates a new run.
5. **Given** the AI reviewer returns structured findings and a summary, **When** they are displayed, **Then** each finding contains a verdict-compatible severity, category, file, side, single line, title, explanation, confidence, validation status, and optional single-line suggestion.
6. **Given** a finding references a file, side, or line that is not eligible for an inline comment, **When** validation runs, **Then** it is either re-anchored by one unique quoted-code match or demoted to the summary and never proposed inline.
7. **Given** more than 15 valid findings, **When** the review is prepared, **Then** only the top 15 by severity, confidence, then file/line order are eligible inline and the remainder appear in the summary.
8. **Given** a new commit arrives during or after a review, **When** the run finishes or the app next verifies GitHub, **Then** the run is marked stale and cannot be published without a new review.
9. **Given** the AI output is malformed, incomplete, exceeds limits, or the reviewer is unavailable, **When** the run finishes, **Then** the failure is reported clearly, partial output is not presented as a valid review, and a safe retry is offered.
10. **Given** the user triages findings, **When** they accept, dismiss, edit, or add a manual finding, **Then** the review draft updates immediately and the original AI output remains available for audit.
11. **Given** the user opens the same pull request twice or requests another review while one is active, **When** the second request arrives, **Then** the app returns the existing active run rather than starting a competing run.
12. **Given** AI output contains Markdown, HTML, links, or text that looks like instructions, **When** it is displayed, **Then** it is rendered as sanitized content and cannot modify application state or execute code.

---

### User Story 4 - Publish a human-approved review to GitHub (Priority: P3)

As a reviewer, I want to preview and publish the accepted findings as a GitHub review with the correct review event, so I can deliver a polished review without copying comments manually and without risking duplicate or misplaced feedback.

**Dependency**: User Story 4 requires a completed, non-stale review run from User Story 3. It can be demonstrated independently with seeded accepted findings and a target test pull request.

**Why this priority**: Publishing closes the loop, but it is only safe after the board, local diff, and finding validation are trustworthy. It is the highest-risk action and must be the most guarded.

**Independent Test**: Prepare a review with inline findings, preview it, publish it as a comment, request changes, and approve where allowed. Verify the GitHub review contains only accepted findings and is anchored correctly; verify stale, offline, duplicate, own-PR, draft, and rejected-anchor cases.

**Acceptance Scenarios**:

1. **Given** accepted findings, **When** the user opens the review preview, **Then** the preview shows the target pull request, event, commit, summary body, every inline comment, and any truncation or fallback warnings.
2. **Given** the user has not explicitly confirmed the preview, **When** any review action occurs, **Then** nothing is posted to GitHub.
3. **Given** the pull request head no longer matches the reviewed commit or the current head cannot be verified, **When** the user attempts to publish, **Then** publishing is blocked and the user is offered a re-review or retry.
4. **Given** the pull request is closed, merged, or no longer accessible, **When** the user attempts to publish, **Then** publishing is blocked.
5. **Given** the user authored the pull request, **When** they select approve or request changes, **Then** the app explains that GitHub disallows that action and offers a comment review.
6. **Given** the pull request is a draft and GitHub rejects an approval, **When** publishing fails, **Then** the app offers a comment review retry with the same selected findings and explains why.
7. **Given** a previous attempt timed out or its outcome is unknown, **When** the user retries, **Then** the app detects a review with the draft's hidden identity marker and treats it as already published rather than posting again.
8. **Given** GitHub rejects one or more inline anchors, **When** the app retries once, **Then** rejected comments move into the summary, valid comments remain inline, and the user is told what changed.
9. **Given** a review is successfully published, **When** the user returns to the board or reopens the pull request, **Then** the app refreshes GitHub state and shows the posted result in the pull request's Activity.
10. **Given** the app restarts during a run or publish, **When** the user reopens it, **Then** incomplete work is marked interrupted, cannot be published accidentally, and can be retried without duplicate comments.
11. **Given** a summary or inline comment would exceed the supported GitHub-safe size, **When** preview is generated, **Then** the app shows the truncation before confirmation and never sends oversized content.
12. **Given** two browser tabs attempt to publish the same draft, **When** both requests arrive, **Then** at most one GitHub review is created and both views show the same result.

### Edge Cases

- GitHub credentials are missing, expired, revoked, rate-limited, or lack the permission needed to read contents or write pull request reviews; the app must preserve local data and explain how to repair authentication.
- A repository is private, empty, renamed, transferred, archived, or no longer accessible.
- A team reviewer request exists but the user's credential cannot determine team membership; the team request is shown, but it must not be silently counted as a direct personal request.
- A pull request's base branch is renamed or deleted while local preparation or review is in progress.
- A pull request is closed, merged, converted to draft, or updated while local preparation, AI review, or publishing is in progress.
- GitHub reports mergeability as unknown; the app must show Unknown and refresh it on a later sync rather than guessing.
- Checks include failures, pending runs, neutral or skipped runs, and statuses from multiple systems; the aggregate must follow the precedence defined in FR-024.
- A pull request has no changed files, only binary files, only renamed files, or exceeds diff, file-count, rendering, or review-body limits.
- File paths contain spaces, Unicode, tabs, or case-only changes; files are symlinks, submodules, or generated artifacts.
- A PR modifies a secret-looking or agent-instruction file: it remains visible to the human reviewer with a warning, but is excluded from AI context.
- AI output contains invalid JSON, invented files or lines, duplicate findings, prompt injection attempts, secrets, or more findings than allowed.
- The configured AI provider is local or remote, unavailable, unauthenticated, slow, rate-limited, or returns a non-zero exit status.
- Publishing times out after GitHub accepted the review but before the app received a response.
- The user navigates away, refreshes, closes the app, or changes repository/filter/selected pull request while work is in progress.
- Two reviews are requested for the same pull request, or the same draft is opened in multiple browser tabs.
- The board contains many repositories and pull requests; filters, lane counts, and cards must remain responsive.
- The device is offline, disk space is exhausted, Git is missing, or a local copy is corrupted.

## Requirements *(mandatory)*

### GitHub Authentication and Repository Connection

- **FR-001**: The app MUST reuse an existing GitHub authentication already configured on the user's machine, resolving it in this precedence order: `GH_TOKEN`, `GITHUB_TOKEN`, then the `gh` CLI session. The MVP MUST NOT require the user to type a token into the application, and MUST report which source and GitHub identity were used.
- **FR-002**: The app MUST validate the credential by identifying the current GitHub user and checking access to each connected repository before relying on it for synchronization or publishing.
- **FR-003**: The app MUST NOT display the GitHub credential in the interface, persist it inside application data, or write it to logs or activity history.
- **FR-004**: When authentication is missing, expired, revoked, rate-limited, or insufficient, the app MUST show an actionable repair message, retain the last known good board, and allow retry after repair without reinstalling the app.
- **FR-005**: A credential rotated in the user's external authentication source MUST be picked up after the app refreshes credentials or restarts; the app MUST NOT keep using an old credential after a successful refresh.
- **FR-006**: Users MUST be able to connect a repository by selecting it from repositories accessible to their credential or by entering an `owner/repository` reference.
- **FR-007**: Users MUST be able to disconnect a repository after confirmation; disconnecting removes its local board data, local copies, raw review output, and run history without changing anything on GitHub.
- **FR-008**: Before the first AI review for a repository, the app MUST disclose the configured AI processing destination when known, state whether code may leave the machine, and require a per-repository acknowledgement that can be revoked.
- **FR-009**: The app MUST limit GitHub operations to the permissions required for repository metadata, contents, checks, pull requests, and requested-team visibility; missing permissions must produce an explicit capability warning rather than silent partial data.

### Synchronization and Lanes

- **FR-010**: The app MUST synchronize open pull requests and merged or closed pull requests updated within the last 30 days, including title, repository, author, body availability, timestamps, additions, deletions, changed files, labels, review state, requested reviewers, checks state, mergeability, head commit, base branch, and draft state.
- **FR-011**: The app MUST derive each pull request's lane using this order: terminal state; draft; changes requested; approved; otherwise in review.
- **FR-012**: For an open non-draft pull request, the app MUST map GitHub's current review decision as follows: changes requested maps to Request changes; approved maps to Approved; review required maps to In review; no decision maps to the fallback in FR-013.
- **FR-013**: When GitHub returns no review decision, the app MUST use the latest decision-bearing review per reviewer as a fallback. Only APPROVED, CHANGES_REQUESTED, and DISMISSED reviews carry a decision; COMMENTED and PENDING reviews MUST NOT override an earlier decision. Any current CHANGES_REQUESTED maps to Request changes; otherwise any current APPROVED maps to Approved; otherwise In review.
- **FR-014**: Dismissed, superseded by a later decision-bearing review, pending, or stale reviews MUST NOT count toward Approved; a COMMENTED review MUST NOT erase an earlier approval. A new commit MUST cause the lane to be re-evaluated from current GitHub data.
- **FR-015**: Local metadata and manual actions MUST NOT override a lane in MVP; there are no pin, snooze, priority, or manual-lane features in scope.
- **FR-016**: The five lanes MUST be Draft, In review, Request changes, Approved, and Done; Done contains both merged and closed pull requests.
- **FR-017**: Users MUST be able to search by pull request title, author, repository, label, or number, filter by connected repository, and filter to pull requests that need their review.
- **FR-018**: "Needs my review" MUST include direct user requests and requests to teams the current user belongs to. When team membership cannot be determined, the app MUST show the team request but MUST NOT silently count it as a personal request.
- **FR-019**: Each lane MUST show its visible count and MUST sort cards by most recently updated first by default.
- **FR-020**: The app MUST show the last successful synchronization time for each repository and retain the last known good board when synchronization fails.
- **FR-021**: Synchronization MUST be idempotent and MUST NOT mark a pull request closed unless a complete open-pull-request refresh confirms it disappeared.
- **FR-022**: The app MUST serialize synchronization per repository, respect GitHub rate-limit retry guidance, back off safely, and show the retry or reset time when GitHub provides it.
- **FR-023**: Mergeability MUST be displayed as mergeable, conflicting, or unknown; an unknown value MUST NOT be treated as mergeable or conflicting.
- **FR-024**: Checks MUST be displayed as one aggregate state using this precedence: any failed check maps to failing; otherwise any pending check maps to pending; otherwise any successful check maps to passing; otherwise, when checks or statuses exist but are all neutral or skipped, the aggregate maps to neutral; otherwise no checks maps to none. Both check runs and commit statuses are included, and required-check filtering is not separate in MVP.
- **FR-025**: After any GitHub state-changing action, the app MUST re-fetch the affected pull request rather than assuming success or updating the lane optimistically.
- **FR-026**: When a refresh fails while online or GitHub state cannot be verified, the board MUST remain readable from the last known data with an explicit stale banner and a retry action. Offline behavior, including disabled synchronization, AI review, and publishing, is defined by FR-093.

### Board Actions and Pull Request Detail

- **FR-027**: Every drag-and-drop transition is governed by this matrix; transitions not listed are unsupported and must snap back with an explanation.

  | From | To | Action |
  |---|---|---|
  | Draft | In review | Confirm and mark ready for review |
  | Draft | Request changes, Approved, Done | Unsupported |
  | In review | Request changes | Open review composer with Request changes event |
  | In review | Approved | Open review composer with Approve event |
  | In review | Draft, Done | Unsupported in MVP |
  | Request changes | Request changes | No-op |
  | Request changes | Approved | Open review composer with Approve event |
  | Request changes | Draft, In review, Done | Unsupported in MVP |
  | Approved | Request changes | Open review composer with Request changes event |
  | Approved | Approved | No-op |
  | Approved | Draft, In review, Done | Unsupported in MVP |
  | Done | Any lane | Unsupported; terminal state is read-only |
  | Any lane | Same lane | No-op |

- **FR-028**: Every GitHub-changing transition MUST require explicit confirmation that names the pull request and resulting GitHub action.
- **FR-029**: Moving a draft to In review MUST mark the pull request ready for review on GitHub and MUST refresh before it appears in the new lane.
- **FR-030**: Moving to Approved or Request changes MUST open the review composer with the matching event and MUST NOT publish immediately. When no review draft exists, the composer MUST create a manual draft bound to the verified head so the user can add a summary and manual findings.
- **FR-031**: Merging and closing pull requests from the board are outside MVP; the app MUST direct the user to GitHub for those actions and keep the Done lane read-only.
- **FR-032**: Every drag action MUST also be available through a keyboard-accessible card action menu, with visible focus, accessible names, and status conveyed by more than color alone.
- **FR-033**: The pull request detail surface MUST include Overview, Diff, AI review, and Activity; Overview shows the sanitized pull request body, author, branches, size, labels, reviewers, checks, mergeability, head commit, and last sync; Activity shows app-recorded events and the posted review result.
- **FR-034**: Full GitHub conversation threads, review-thread replies, and commit history browsing are outside MVP; the app MUST link to GitHub for those surfaces.
- **FR-035**: Pull request titles, bodies, comments, labels, and other GitHub-provided text MUST be rendered as sanitized Markdown or plain text; embedded HTML and scripts MUST NOT execute.

### Local Code and Diff

- **FR-036**: The app MUST prepare pull request code in an isolated local copy tied to a specific head commit and MUST NOT modify, reset, checkout, or otherwise touch the user's existing repository checkout.
- **FR-037**: Local preparation MUST NOT execute pull request code, installs, tests, scripts, hooks, filters, or submodules.
- **FR-038**: The app MUST show the local diff with a file list, change type, additions, deletions, change blocks, old and new line numbers, and clear indicators for binary, renamed, copied, symlink, submodule, metadata-only, and truncated files.
- **FR-039**: The local diff MUST exclude changes that landed on the base branch after the pull request diverged, so only changes introduced by the pull request are shown.
- **FR-040**: The human diff viewer MUST display every changed text file, including secret-looking files and repository instruction files, without executing or following them. Displaying a file to the human reviewer does not authorize sending it to the AI reviewer.
- **FR-041**: The AI reviewer MUST NOT receive content from repository instruction or secret-bearing paths, including at minimum: `.env` and `.env.*`, `.git/**`, `.opencode/**`, repository `opencode.json` or `opencode.jsonc`, `AGENTS.md`, `CLAUDE.md`, `.github/copilot-instructions.md`, `.cursorrules`, `.cursor/rules/**`, and common credential or private-key files. The exact default denylist MUST be documented and configurable only by a trusted local setting.
- **FR-042**: Symlinks MUST be displayed as links and never followed; submodules MUST be displayed as commit references and their content MUST NOT be fetched for review.
- **FR-043**: Case-only renames and paths containing spaces, Unicode, or tabs MUST remain distinct and displayable.
- **FR-044**: When a diff exceeds 400 changed files, 20,000 changed lines, 1 MiB per text file, or 20 MiB of total text, the app MUST mark it truncated, preserve the file list and available portions, and direct the user to GitHub for the remainder.
- **FR-045**: The app MUST re-check GitHub head when the user opens a pull request's diff, when starting an AI review, at the end of a review run, and immediately before publishing.
- **FR-046**: If head cannot be verified, the app MUST present the local diff as read-only/unverified and MUST block AI review and publishing.
- **FR-047**: The displayed local diff MUST identify the commit it uses; if it differs from the board or GitHub, the app MUST show a stale warning.
- **FR-048**: Preparation errors MUST identify whether the cause is credential, permission, network, missing ref, missing Git, insufficient disk, or corrupt local cache, and MUST allow a safe retry without presenting partial data as valid.
- **FR-049**: The app MUST clean superseded local copies and remove local copies not accessed for 14 days; it MUST NOT delete a copy used by an active run.

### AI Review

- **FR-050**: Users MUST be able to start an AI review for a selected pull request only after GitHub head and pull request state have been verified and the repository AI acknowledgement is current.
- **FR-051**: The AI reviewer MUST be read-only and MUST NOT execute shell commands, modify files, follow symlinks, fetch submodules, invoke subagents, write to GitHub, or use network-capable tools such as web fetch or web search.
- **FR-052**: The only external communication permitted during an AI review is the configured AI model endpoint. The app MUST disclose when that endpoint may receive pull request code outside the local machine.
- **FR-053**: Pull request titles, descriptions, code, labels, and repository files included in the AI context MUST be treated as untrusted data; instructions found inside them MUST NOT override the reviewer's operating rules. GitHub conversation comments and review threads are not sent to the AI reviewer in MVP.
- **FR-054**: A review run MUST expose status, current phase, elapsed time, cancellation, token usage, and cost when available.
- **FR-055**: Cancellation MUST stop the run promptly, mark it cancelled rather than completed, discard partial findings from the publishable draft, and leave prior completed runs untouched.
- **FR-056**: At most one active review run may exist per pull request; duplicate start requests MUST return the existing run. Starting a new run after a completed, failed, cancelled, or stale run MUST create a new run with a new identity.
- **FR-057**: A finding MUST contain: path; side; one line number; severity; category; title; explanation; confidence; optional quoted code for validation; and an optional suggestion.
- **FR-058**: The allowed finding enums are:
  - **Verdict** (review-level): `approve`, `comment`, `request_changes`.
  - **Severity**: `critical`, `high`, `medium`, `low`, `nit`, ordered from highest to lowest.
  - **Category**: `bug`, `security`, `performance`, `concurrency`, `error_handling`, `api_contract`, `tests`, `maintainability`, `style`.
  - **Confidence**: a number from `0.0` to `1.0`, displayed as a whole percentage.
- **FR-059**: A finding's suggestion MUST be an optional replacement for exactly one RIGHT-side line and MUST be omitted for LEFT-side findings or multi-line replacements.
- **FR-060**: Inline comments are limited to single-line anchors on added lines with side RIGHT or deleted lines with side LEFT. Context lines, multi-line ranges, invented paths, and anchors outside a change block are not eligible inline.
- **FR-061**: A finding with a valid path, side, and line MUST also match its quoted code when provided. If the line is invalid or the quote does not match, the app MUST search the same file for exactly one eligible line matching the quote; zero or multiple matches MUST demote the finding to the summary.
- **FR-062**: The app MUST deduplicate findings by normalized path, side, line, and explanation, retaining the highest-confidence version.
- **FR-063**: Only the top 15 valid findings may be proposed inline, ordered by severity, then confidence descending, then path ascending, then line ascending. Remaining findings and all demoted findings MUST be represented in the summary with their file and line when available, subject to the summary limit in FR-075.
- **FR-064**: The review MUST include a verdict, summary, findings, tests-missing list, files reviewed, files skipped, commit identity, and run metadata. The summary MUST explain when no findings were produced and when files were skipped.
- **FR-065**: Review summaries and finding content MUST be fixed to English in MVP. No language setting is provided; the interface remains Vietnamese.
- **FR-066**: If the AI output is invalid, incomplete, or times out, or the reviewer exits unsuccessfully, the app MUST mark the run failed, preserve redacted diagnostic output for at most 30 days, and MUST NOT present partial output as a valid review. Cancellation behavior is defined by FR-055.
- **FR-067**: If the app restarts while a review is running, the run MUST be marked interrupted and MUST NOT be publishable.
- **FR-068**: AI-generated Markdown, links, HTML, and apparent instructions MUST be rendered as sanitized content and MUST NOT change application state, navigation, or permissions.
- **FR-069**: If GitHub head changes during a run, the app MUST mark the run stale at completion or at the next head verification and MUST prevent publishing.

### Triage and Review Draft

- **FR-070**: Users MUST be able to accept, dismiss, edit, manually add, and select findings for the review draft. Users MUST also be able to create a manual draft from the review composer without starting an AI review.
- **FR-071**: Manually added comments MUST either be summary-only or attach to an eligible added or deleted line using the same validation rules as AI findings.
- **FR-072**: The review draft MUST show a live count of accepted inline comments and summary-only findings, and MUST distinguish valid, demoted, and stale findings.
- **FR-073**: Users MUST be able to choose a review event of comment, request changes, or approve, subject to GitHub permissions and pull request state.
- **FR-074**: The preview MUST show the target pull request, current head verification, event, summary, every inline comment, truncation warnings, and empty states before confirmation.
- **FR-075**: The app MUST enforce a maximum of 60,000 characters for the review summary and 10,000 characters for each inline comment, below GitHub's hard limit. Content over the limit MUST be visibly truncated before confirmation while preserving the marker, commit identity, and highest-severity remaining findings. The preview MUST report how many represented findings were omitted by truncation, and truncation MUST never drop the marker or commit identity.
- **FR-076**: The review draft MUST be bound to the reviewed commit and MUST become non-publishable when that commit or the pull request state changes.

### Publishing and Idempotency

- **FR-077**: Publishing MUST require explicit confirmation after preview and MUST use the user's GitHub credential; the AI reviewer MUST never publish.
- **FR-078**: The app MUST block publishing when the pull request is closed, merged, inaccessible, offline, unverified, or when its head commit differs from the reviewed commit.
- **FR-079**: When the user authored the pull request, or GitHub otherwise disallows an approval or change request, the app MUST explain the restriction and offer a comment review with the same selected findings.
- **FR-080**: When a draft pull request cannot be approved, the app MUST offer a comment-review fallback and preserve the user's selected event intent in the audit record.
- **FR-081**: Each review draft MUST have a stable hidden idempotency marker derived from the immutable review draft identity; for AI-origin drafts that identity incorporates the review run identity. The marker MUST be included in the GitHub review body, MUST NOT be visible in the rendered review, and MUST be stored with the draft and post record.
- **FR-082**: Before publishing and before any retry with an uncertain outcome, the app MUST check existing GitHub reviews for the marker. If found, the app MUST treat the review as already published, display the existing result, and MUST NOT create another review.
- **FR-083**: If a review request times out and no marker is found, the app MUST allow one explicit retry using the same marker. If a marker appears later, no further post may be made.
- **FR-084**: If GitHub rejects one or more inline anchors, the app MUST move the rejected comments into the summary, retry once with valid comments preserved and the same marker, and report the fallback.
- **FR-085**: The app MUST preserve an audit record for every run, draft, publish attempt, fallback, and post, including target pull request, commit, event, selected findings, outcome, and error, without storing credentials or full secret-bearing content.
- **FR-086**: Only one publish request may be in flight for a review draft; concurrent requests from multiple views MUST be idempotent and MUST produce at most one GitHub review.
- **FR-087**: After publishing or fallback, the app MUST refresh the pull request and show the posted review in the pull request's Activity.
- **FR-088**: On app restart after a publish was in flight, the app MUST mark the post attempt uncertain, check for its marker before allowing retry, and never auto-retry without user confirmation.

### Data Lifecycle, Offline, and Reliability

- **FR-089**: Board data, review runs, findings, drafts, posts, and activity MUST persist locally across restarts until intentionally removed.
- **FR-090**: Local copies, review artifacts, and logs MUST be stored in an application-private location with user-only access; credentials MUST NOT be stored there.
- **FR-091**: Superseded local copies and copies not accessed for 14 days MUST be removed. Redacted raw AI diagnostics MUST be retained for no more than 30 days. Structured review history and audit records MUST remain until the repository is disconnected or the user clears them.
- **FR-092**: Disconnecting a repository MUST remove its board data, local copies, raw diagnostics, runs, findings, drafts, posts, and activity after explicit confirmation.
- **FR-093**: When offline, the board and completed review history MUST remain readable, but synchronization, AI review, and publishing MUST be disabled with an offline/stale banner.
- **FR-094**: On startup, any run or publish left in progress MUST be marked interrupted or uncertain; no interrupted run may become publishable and no uncertain post may be retried without marker verification.
- **FR-095**: The app MUST redact credentials, tokens, private keys, and secret-bearing excluded content from logs, activity, and diagnostic output.
- **FR-096**: Duplicate UI actions, rapid retries, and concurrent requests MUST NOT create duplicate synchronization, review runs, drafts, or GitHub reviews for the same target and commit.
- **FR-097**: The app MUST show clear empty, loading, partial-failure, authentication-failure, and offline states; no failed operation may be represented as successful.
- **FR-098**: Keyboard users MUST be able to reach and perform every board action, open pull request detail, switch tabs, navigate changed files, start/cancel a review, and confirm or cancel a publish without relying on drag-and-drop.

### Key Entities

- **Repository**: A connected GitHub repository, including owner, name, visibility, default branch, authentication capability, connection time, last successful synchronization, and AI processing acknowledgement.
- **Pull request**: A current snapshot of GitHub pull request data, including body, commits, branches, size, checks aggregate, mergeability, labels, reviewers, review decision, terminal state, and derived lane.
- **Local copy**: An isolated retrieval of one pull request head commit, including merge context, changed files, change blocks, line mappings, special-file metadata, preparation status, last access, and stale/invalid status. It is not the user's working checkout.
- **Review run**: One AI-assisted review attempt bound to a pull request and head commit, with immutable identity, status, phase, cancellation, provider/model identity, usage, cost, duration, redacted raw diagnostics, summary, findings, verdict, and interrupted/stale state. No deep-mode property exists in MVP.
- **Finding**: A structured observation from a run or a human, with path, side, single line, severity, category, title, explanation, confidence, optional quoted code, optional single-line suggestion, validation result, deduplication fingerprint, and accepted/dismissed state.
- **Review draft**: The curated accepted findings, summary, selected event, origin (AI run or manual), idempotency marker, reviewed commit, preview state, and publishability state.
- **Review post**: A publication attempt or successful GitHub review, including external review identity, marker, event, commit, payload summary, response, fallback details, outcome, and timestamps.
- **Activity event**: A local audit entry for synchronization, review runs, triage, publish attempts, fallbacks, and posted reviews associated with a repository or pull request.
- **Repository acknowledgement**: A revocable record that the user approved sending that repository's eligible code to the disclosed AI destination.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: In a validation set of 50 pull requests spanning draft, in-review, review-required, changes-requested, approved, dismissed-approval, merged, and closed states, 100% appear in the lane that matches the defined mapping after synchronization.
- **SC-002**: A user with an existing valid GitHub credential can connect a repository and reach a populated five-lane board in under two minutes without editing configuration files or entering a token in the app.
- **SC-003**: Synchronizing five repositories containing up to 100 open pull requests completes in under 30 seconds on a 50 Mbps connection, excluding time spent waiting on GitHub rate-limit responses, which MUST be reported separately with the retry or reset time; the board remains usable while synchronization is in progress.
- **SC-004**: For PRs under 500 changed lines in repositories with a working tree up to 1 GB, the first local preparation completes within 10 minutes for at least 90% of attempts on a 50 Mbps connection; once prepared, the diff opens within two seconds and file switching responds within one second for at least 95% of interactions.
- **SC-005**: For PRs under 500 changed lines, an AI review completes within three minutes for at least 90% of attempts when the configured provider's p90 response time is at most 90 seconds; orchestration from verified head through validated draft MUST stay within 60 seconds p90. Configured provider outages, provider-side rate limits, and GitHub rate-limit waits are excluded and reported separately.
- **SC-006**: Zero GitHub anchor-rejection (422) responses occur across the acceptance suite because the app proposes only validated inline anchors and demotes all invalid findings before publishing.
- **SC-007**: Zero reviews are published without explicit confirmation, and across the 20 timeout, retry, restart, double-click, and multi-tab tests at most one review is created per draft.
- **SC-008**: 100% of attempts to publish against a changed head, unverifiable head, offline state, closed pull request, or merged pull request are blocked with an actionable explanation.
- **SC-009**: A user can triage ten findings, preview the result, and reach the confirmation step in under three minutes.
- **SC-010**: 100% of completed review runs show commit identity and, when the provider reports them, token usage and cost.
- **SC-011**: All primary interface labels, actions, statuses, and errors are presented in Vietnamese, and 100% of generated review content is English in MVP.
- **SC-012**: A user can recover from GitHub authentication, local preparation, AI execution, offline, or publishing failure without losing the last known good board and without creating duplicate feedback.
- **SC-013**: In credential, log, activity, and diagnostic tests, the GitHub token and excluded secret-bearing content never appear in visible output or stored logs.
- **SC-014**: Every board action can be completed without drag-and-drop, and keyboard-only tests can reach and activate all primary workflows.
- **SC-015**: 100% of team-reviewer requests are either correctly included for a known team member or visibly marked as indeterminate rather than silently counted as personal review requests.

## Assumptions

- The first release serves one developer on one local Windows 10/11 machine and targets GitHub.com only.
- The user already has GitHub authentication configured outside the app. Supported sources, in precedence order, are the `GH_TOKEN` environment variable, the `GITHUB_TOKEN` environment variable, and the `gh` CLI session. The MVP does not provide PAT entry, OAuth onboarding, credential-at-rest storage, or credential revocation inside the app.
- The GitHub credential has, or can be granted, read access to repository metadata, contents, checks, and pull requests; review write permission is required only for publishing.
- Team-reviewer detection depends on the credential's permission to read organization team membership. When that permission is unavailable, the app must expose the limitation and must not claim team requests are personal.
- The user's machine has a supported browser, Git available on the command path, sufficient free disk space for isolated copies, and network access to GitHub.
- The configured AI reviewer may use a local or remote provider. When remote, eligible code may leave the machine; the app discloses this and requires a per-repository acknowledgement. The AI reviewer itself has no general network tools beyond the model endpoint.
- The application interface is Vietnamese. Generated review summaries and comments are fixed to English in MVP; no language selector is provided.
- The default Done window is the last 30 days of merged and closed pull requests.
- Mergeability may be unknown while GitHub computes it; the app displays Unknown and refreshes it on a later sync.
- Checks shown on the board use all available checks and statuses, not only required checks.
- The local diff is intentionally stricter than GitHub: inline comments are single-line and only on added or deleted lines. Findings on context lines are demoted to the summary.
- The review summary and inline comment limits are 60,000 and 10,000 characters respectively, below GitHub's hard limits.
- Local data is retained according to FR-091. The app does not store the GitHub token or encrypt a credential because it does not persist one in MVP.
- Merging and closing pull requests from the board, manual lane overrides, pin/snooze/priority/notes, deep multi-turn code exploration, code execution, test or lint execution, auto-approval, full GitHub conversation and commit browsing, GitLab, Bitbucket, multi-user collaboration, hosted deployment, webhooks, and bidirectionally synchronized project metadata are outside MVP.
- AI review is advisory. The human reviewer remains responsible for every published comment, event, and approval.
- GitHub conversation comments and review threads are not sent to the AI reviewer in MVP.
- GitHub may accept a review after the app's final marker check. The retry verification window bounds but cannot eliminate this race; the app records an uncertain outcome, never auto-retries, and surfaces any later marker match instead of claiming a different result.
- The app must remain usable with repositories containing hundreds of pull requests and diffs containing hundreds of files, using truncation and clear limits where necessary.
