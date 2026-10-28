# SSE Event Contract

**Endpoint**: `GET /api/events` (same origin, no CSRF token required)
**Content type**: `text/event-stream`
**Purpose**: Push sync, review, and publish progress so all open tabs converge without polling.

## Transport rules

- The server sends an initial `event: ready` frame, then domain events.
- Every frame uses `event: <name>` and a single-line JSON `data:` payload (no multi-line JSON).
- A comment heartbeat (`: ping`) is sent every 15 seconds.
- Frames are ordered per connection. A slow consumer may miss intermediate progress frames; the final state event is authoritative.
- The client reconnects automatically; on reconnect it invalidates board, PR, run, and draft queries and refetches. The server does not replay history.
- Payloads never contain credentials, token-bearing URLs, file contents, diffs, or raw AI output. They may contain IDs, counts, phases, status, timestamps, and already-public GitHub identifiers.

## Events

### ready

Sent once when the stream opens.

```json
{
  "serverTime": "2026-10-28T14:03:00.000Z",
  "appVersion": "0.1.0"
}
```

### board.updated

Board-visible data changed; clients refetch `/api/board` and any open PR summary.

```json
{
  "reason": "sync_completed",
  "repoId": "0b6c...",
  "prId": null
}
```

`reason` enum: `sync_completed`, `mark_ready`, `publish_completed`, `repo_connected`, `repo_disconnected`, `retention_cleanup`.

### sync.started

```json
{
  "repoId": "0b6c...",
  "syncRunId": "9f2a...",
  "startedAt": "2026-10-28T14:03:01.000Z"
}
```

### sync.progress

```json
{
  "repoId": "0b6c...",
  "syncRunId": "9f2a...",
  "phase": "pull_requests",
  "fetched": 60,
  "total": 100
}
```

`phase` enum: `pull_requests`, `reviews`, `checks`, `teams`, `persisting`. `total` may be null while unknown; `fetched` is monotonic.

### sync.completed

```json
{
  "repoId": "0b6c...",
  "syncRunId": "9f2a...",
  "status": "succeeded",
  "finishedAt": "2026-10-28T14:03:25.000Z",
  "openSeen": 100,
  "closedSeen": 12,
  "error": null
}
```

`status` enum: `succeeded`, `partial`, `failed`. `error` is `{ "code": "...", "message": "..." }` or null. `partial` means last known good board data is retained.

### diff.started

Local preparation is a job because the first fetch can take minutes; opening the diff does not hold an HTTP request open.

```json
{
  "prId": "6a1d...",
  "headSha": "4d9f...",
  "startedAt": "2026-10-28T14:03:40.000Z"
}
```

### diff.progress

```json
{
  "prId": "6a1d...",
  "headSha": "4d9f...",
  "phase": "diff",
  "progress": 0.7
}
```

`phase` enum: `fetch`, `merge_base`, `diff`, `files`. `progress` is 0–1 or null when indeterminate.

### diff.completed

```json
{
  "prId": "6a1d...",
  "headSha": "4d9f...",
  "status": "ready",
  "stale": false,
  "verified": true,
  "truncated": false,
  "fileCount": 23,
  "error": null,
  "finishedAt": "2026-10-28T14:05:10.000Z"
}
```

`status` enum: `ready`, `stale`, `invalid`. `stale` means GitHub's head or PR state differs from the board snapshot; the displayed commit is `headSha`. `error` is `{ "code": "...", "message": "..." }` or null. Clients refetch `/api/prs/{prId}/diff` after this event.

### review.started

```json
{
  "prId": "6a1d...",
  "runId": "c7e4...",
  "headSha": "4d9f...",
  "startedAt": "2026-10-28T14:04:00.000Z"
}
```

### review.progress

```json
{
  "prId": "6a1d...",
  "runId": "c7e4...",
  "status": "running",
  "phase": "calling_model",
  "progress": 0.6,
  "elapsedMs": 42000
}
```

`status` enum: `queued`, `running`, `completed`, `failed`, `cancelled`, `interrupted`. `phase` matches the run phase contract. `progress` is 0–1 or null when indeterminate.

### review.completed

```json
{
  "prId": "6a1d...",
  "runId": "c7e4...",
  "status": "completed",
  "verdict": "comment",
  "stale": false,
  "error": null,
  "finishedAt": "2026-10-28T14:06:30.000Z"
}
```

`verdict` is advisory and may be null. `stale` means the head or PR state changed during the run (FR-069). `error` is `{ "code": "...", "message": "..." }` or null.

### publish.started

```json
{
  "draftId": "d2b8...",
  "prId": "6a1d...",
  "postId": "f3c1...",
  "attemptNo": 1,
  "startedAt": "2026-10-28T14:07:00.000Z"
}
```

### publish.progress

```json
{
  "draftId": "d2b8...",
  "postId": "f3c1...",
  "phase": "verifying_marker",
  "message": "Checking existing reviews for this run"
}
```

`phase` enum: `verifying_head`, `verifying_marker`, `submitting`, `verifying_outcome`. `message` is a short Vietnamese UI-safe status string; it contains no code or token.

### publish.completed

```json
{
  "draftId": "d2b8...",
  "prId": "6a1d...",
  "postId": "f3c1...",
  "status": "succeeded",
  "githubReviewId": "3123456789",
  "url": "https://github.com/owner/repo/pull/42#pullrequestreview-3123456789",
  "fallback": null,
  "error": null,
  "finishedAt": "2026-10-28T14:07:12.000Z"
}
```

`status` enum: `succeeded`, `failed`, `uncertain`, `duplicate_detected`. `fallback` is a short reason such as `anchors_demoted`, `comment_event_fallback`, or null. `uncertain` requires manual retry after marker verification; no automatic retry occurs.

### repo.updated

```json
{
  "repoId": "0b6c...",
  "lastSyncStatus": "partial",
  "lastSuccessfulSyncAt": "2026-10-28T13:55:00.000Z",
  "rateLimitResetAt": "2026-10-28T14:20:00.000Z"
}
```

### retention.cleanup

```json
{
  "removedCopies": 3,
  "removedArtifacts": 1,
  "occurredAt": "2026-10-28T14:00:00.000Z"
}
```

## Client behavior

- Treat `*.completed` events as authoritative and refetch the related resource.
- Do not derive lane changes or publish success from progress events; only the refetched server state is displayed (FR-025).
- While offline or after a stream error, show the offline/stale banner and disable mutating actions (FR-026/093).
- The stream is auxiliary; every screen must remain functional after a refresh using REST only.
