<!--
Sync Impact Report
- Version change: none → 1.0.0
- Modified principles: N/A (initial ratification)
- Added sections: Core Principles I–VII, Security and Data Handling Constraints,
  Development Workflow and Quality Gates, Governance
- Removed sections: none
- Follow-up TODOs: none
-->

# AI-Assisted PR Review Board Constitution

## Core Principles

### I. Credential Secrecy and Local-Only Trust Boundary

The GitHub credential MUST come only from `GH_TOKEN`, `GITHUB_TOKEN`, or an authenticated
`gh` CLI session. It MUST never be collected in the app, displayed, persisted, logged, or
embedded in diagnostics, artifacts, URLs, or error messages. The service MUST bind to
`127.0.0.1`, reject non-loopback Host and Origin values, require a CSRF token for every
mutation, and serve a restrictive Content Security Policy. Secrets MUST be redacted before
any log, activity, or artifact write.

Rationale: a single leaked token compromises every connected repository, and a loopback
service that accepts non-local origins becomes a remote attack surface for the developer's
machine.

### II. GitHub Is the Source of Truth

Lanes, pull request state, checks, mergeability, review decision, and post status MUST be
derived from refreshed GitHub data. The interface MUST NOT move a card, mark a PR ready, or
claim a publish from local intent alone; every mutation MUST re-fetch and render server
state. During sync failure the last known good board MUST remain visible with an explicit
freshness and error state, and no PR may be shown as closed without GitHub confirmation.
Inaccessible pull requests MUST keep their last known lane and MUST NOT fall into Done.

Rationale: the board's value is that it can be trusted without opening GitHub; optimistic
or inferred state destroys that trust silently.

### III. Human-Confirmed, Idempotent Publishing

No review may be posted without explicit human confirmation of a server-generated preview
bound to the verified head. Every draft MUST carry a stable hidden marker derived from its
immutable identity. The app MUST check existing reviews for that marker before publishing
and before any retry, MUST allow at most one in-flight post per draft, and MUST NOT retry an
uncertain outcome automatically. Own-PR, draft-PR, anchor-rejection, timeout, and restart
paths MUST preserve the intended event in audit and MUST never create a second review.

Rationale: published reviews are visible to other people and cannot be unsent; the marker
plus verification is the only reliable duplicate defense available through the GitHub API.

### IV. Isolated, Non-Executing Code Handling

Pull request code MUST be prepared in an isolated bare-Git cache and never in the user's
checkout. It MUST NOT be executed, built, tested, or exposed to hooks, filters, textconv,
external diff drivers, or submodules. Inline anchors MUST exist in the prepared diff;
findings that do not validate MUST be demoted before publishing. Path traversal and control
characters MUST be rejected at every filesystem boundary.

Rationale: reviewing untrusted code must never become running untrusted code, and an anchor
that does not exist produces a rejected review.

### V. Read-Only, Bounded AI with Explicit Disclosure

The AI reviewer MUST make a single bounded, read-only request to the configured model
endpoint, with no tools, no network access beyond that endpoint, and no file writes. Eligible
code may leave the machine only after a per-repository acknowledgement that remains
revocable. Denylisted secret-bearing and instruction files MUST be excluded from the AI
context while remaining visible to the human reviewer. Model output MUST be validated
against the published schema as a whole and MUST NOT change application state on its own. A
failed, cancelled, interrupted, or stale run MUST never become publishable.

Rationale: the human reviewer stays accountable for every comment, so the AI must be
advisory, bounded, and disclosed.

### VI. Vietnamese Interface, English Review Output

All primary labels, actions, statuses, and errors in the interface MUST be Vietnamese.
Generated review summaries and comments MUST be English in the MVP, and no language
selector is provided. This split MUST NOT be configurable at runtime.

Rationale: the product serves a Vietnamese-speaking reviewer publishing into English-language
code reviews; mixing the two without a rule produces inconsistent output.

### VII. Measurable Outcomes and Honest Evidence

Every success criterion MUST have a reproducible measurement or an explicitly recorded
"not executed" result; a scenario that could not run MUST NOT be marked passing. Performance
claims MUST exclude and separately report GitHub rate-limit waits and provider outages.
Contract drift, security, idempotency, and redaction tests MUST pass before a feature is
declared complete.

Rationale: acceptance evidence is only useful if it distinguishes measured success from
assumed success.

## Security and Data Handling Constraints

- The MVP serves one developer on one Windows 10/11 machine, GitHub.com only; hosted
  deployment and multi-user collaboration are out of scope.
- The app provides no token entry, OAuth onboarding, credential-at-rest storage, or
  in-app credential revocation.
- The app MUST NOT execute, lint, test, merge, or close pull request content, and MUST NOT
  embed full conversation or commit browsing; it links to GitHub instead.
- Local data MUST follow the published retention rules: prepared copies for 14 days and
  diagnostics for 30 days; disconnecting a repository removes derived data without changing
  GitHub.
- The application MUST remain fully usable after a refresh using REST alone; SSE is
  auxiliary and never authoritative.
- New dependencies MUST be pinned, reviewed for security and maintenance cost, and justified
  against the simplest alternative.

## Development Workflow and Quality Gates

- Specification, plan, data model, contracts, tasks, and quickstart MUST stay consistent;
  contract tests are the drift guard.
- Each user story MUST be independently testable and demonstrated at its checkpoint before
  the next story is declared done.
- Before merge, typecheck, lint, unit, contract, integration, and end-to-end suites MUST pass,
  together with performance checks for affected targets and security/redaction regressions.
- Tests for a story MUST be written first and confirmed to fail for the expected reason.
- Code review MUST reject optimistic lane or publish updates and any path that persists,
  logs, or renders a credential.
- Any deviation from this constitution MUST be documented in the plan's constitution check
  with rationale and a migration or removal plan, and approved by the project owner.

## Governance

This constitution supersedes other practices when they conflict. Amendments MUST be proposed
in writing with rationale, impact on spec, plan, and tasks, and a migration path; they require
project owner approval and MUST record the amendment date and new version.

Versioning follows semantic rules: MAJOR for removing or redefining a principle in a
backward-incompatible way, MINOR for adding a principle or section or materially expanding
guidance, and PATCH for clarifications and non-semantic refinements.

Compliance is reviewed in every plan, tasks review, analyze run, and code review. A violation
is CRITICAL until it is fixed or the constitution is explicitly amended. Added complexity MUST
be justified against the simplest alternative. Runtime guidance lives in the feature documents;
this constitution defines only non-negotiable constraints.

**Version**: 1.0.0 | **Ratified**: 2026-10-28 | **Last Amended**: 2026-10-28
