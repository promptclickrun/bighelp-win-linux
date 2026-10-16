# Read-only workspace clients

Evidence recorded 2026-10-16. This is a bounded client implementation tested with
synthetic source-shaped responses and a local HTTP server. It is not a claim of
live-host, desktop UI, or platform parity.

## Source and exact wire operations

The source checkout was verified at
[`d62a545386fb1b63f8ca33365766a46b3b1bd636`](https://github.com/promptclickrun/bighelp/commit/d62a545386fb1b63f8ca33365766a46b3b1bd636),
the Catalyst baseline in [SOURCES](../SOURCES.md). The repository
[Hermes](../contracts/HERMES_API.md) and [plugin](../contracts/PLUGIN_API.md)
contracts were also consulted. No production host was contacted.

| Read | Wire request | Source |
|---|---|---|
| Projects | RPC `projects.list`, params `{profile}` | [Workspace dispatcher, line 371](https://github.com/promptclickrun/bighelp/blob/d62a545386fb1b63f8ca33365766a46b3b1bd636/Bighelp/DirectHermes/DirectHermesWorkspaceClient.swift#L371); [catalog decoder, line 39](https://github.com/promptclickrun/bighelp/blob/d62a545386fb1b63f8ca33365766a46b3b1bd636/Bighelp/WorkspaceManagement/WorkspaceManagementDecoder.swift#L39) |
| Usage | GET `/api/analytics/usage?days=<7,30,90>&profile=<encoded profile>` | [Dispatcher, line 480](https://github.com/promptclickrun/bighelp/blob/d62a545386fb1b63f8ca33365766a46b3b1bd636/Bighelp/DirectHermes/DirectHermesWorkspaceClient.swift#L480); [report, line 76](https://github.com/promptclickrun/bighelp/blob/d62a545386fb1b63f8ca33365766a46b3b1bd636/Bighelp/Usage/HermesUsage.swift#L76); [period choices](https://github.com/promptclickrun/bighelp/blob/d62a545386fb1b63f8ca33365766a46b3b1bd636/Bighelp/Usage/UsageView.swift#L4) |
| Scheduled tasks | GET `/api/cron/jobs?profile=<encoded profile>` | [Dispatcher, line 528](https://github.com/promptclickrun/bighelp/blob/d62a545386fb1b63f8ca33365766a46b3b1bd636/Bighelp/DirectHermes/DirectHermesWorkspaceClient.swift#L528); [task decoder](https://github.com/promptclickrun/bighelp/blob/d62a545386fb1b63f8ca33365766a46b3b1bd636/Bighelp/DirectHermes/DirectHermesScheduledTaskCodec.swift#L7) |
| Feed / Ideas / Goals | GET `/api/plugins/loopdy/native/context`, then POST `/api/plugins/loopdy/native/board/list`, body `{agentId,limit:200}` | [Context validation, line 48](https://github.com/promptclickrun/bighelp/blob/d62a545386fb1b63f8ca33365766a46b3b1bd636/Bighelp/DirectHermes/DirectHermesNativeContext.swift#L48); [route, line 351](https://github.com/promptclickrun/bighelp/blob/d62a545386fb1b63f8ca33365766a46b3b1bd636/Bighelp/DirectHermes/DirectHermesNativeContext.swift#L351); [board call, line 589](https://github.com/promptclickrun/bighelp/blob/d62a545386fb1b63f8ca33365766a46b3b1bd636/Bighelp/Board/AgentBoard.swift#L589) |

The board tab is a local filter of `feed`, `idea`, or `goal`; it is not an invented
wire parameter. No board update/read/accept/promote operation exists in this
client. Listing does not mark posts read, create a schedule, or submit a prompt.

## Public contract

`createWorkspaceClient` in `packages/hermes-client/workspace.ts` accepts:

- An immutable captured `WorkspaceOwner`: `hostId`, opaque `principalId`,
  `profileId`, `authGeneration`, `connectionGeneration`, plus `currentOwner()`.
- A trusted verified `WorkspaceIdentity`: `{kind:'dashboard'}` or
  `{kind:'provider',providerId,userId}`. The main-process authentication owner
  supplies this; renderer input and plugin display names cannot establish it.
- `http(HttpOperation): Promise<HttpResult>` and optional finite
  `projects(profile): Promise<unknown>` callback for the existing RPC gateway.
- `nextRequestId(): string`, returning a lowercase UUID.
- Optional known capability flags `projects`, `usage`, `scheduled`; `false`
  suppresses the request. Unknown support is discovered by the fixed read route.

Methods are `projects()`, `usage(days = 30)`, `scheduled()`, and
`board('feed' | 'ideas' | 'goals')`. Each resolves to
`{status:'loaded',data:<typed projection>}` or
`{status:'unsupported',reason:'host-update'|'plugin-update'}`. Safe failures are
`WorkspaceClientError.kind`: `invalid-response`, `owner-changed`, `unavailable`.
The client has no general URL, arbitrary RPC, mutation, retry, or polling API.

All public data types and standalone decoders are in
`packages/contracts/workspace.ts`:

- `WorkspaceProjects`: `projects[]` with `id`, `name`, optional `description`,
  `archived`, and folder `path`, optional `label`, `primary`; `activeId` is the
  returned active project only if it still exists and is not archived.
- `WorkspaceUsage`: requested `days`, reported `totals`, `daily[]` keyed by
  calendar `day`, `models[]` keyed by display `name`. Metrics are optional
  `inputTokens`, `outputTokens`, `cacheReadTokens`, `reasoningTokens`,
  `estimatedCost`, `actualCost`, `sessions`, `apiCalls`.
- `WorkspaceScheduled`: `tasks[]` with `id`, `name`, `schedule`, exact host
  `state`, `enabled`, optional `nextRunAt` and `lastResult`.
- `WorkspaceBoard`: `tab`, and matching non-dismissed `items[]` with `id`,
  `kind`, `title`, optional `body`, `status`, `note`, `category`, `createdAt`,
  `updatedAt`, `read`, `dismissed`.

Dates are normalized ISO strings only when the host actually supplied them.
Collections and nested returned objects are frozen. Unknown wire fields,
provider context, credentials, schedule prompts/scripts, arbitrary JSON,
attachment locations, and executable actions are not projected. Server text
remains inert display data; folder paths do not grant local filesystem access.

## Response evidence and bounds

Projects consume `{projects:[{id,name,description?,archived,folders:[{path,label?,is_primary}]}],active_id}`;
`active_id` is explicitly string or null. The shipping client deliberately
ignores a stale archived/deleted selection without modifying the host
([source, line 253](https://github.com/promptclickrun/bighelp/blob/d62a545386fb1b63f8ca33365766a46b3b1bd636/Bighelp/DirectHermes/DirectHermesProjectClient.swift#L253)).
Limits: 1,000 projects, 100 folders per project, 4 MiB envelope.

Usage consumes `totals` and/or `daily`, plus optional `by_model`. Total wire
keys are `total_input`, `total_output`, `total_cache_read`, `total_reasoning`,
`total_estimated_cost`, `total_actual_cost`, `total_sessions`, `total_api_calls`.
Daily/model keys are `input_tokens`, `output_tokens`, `cache_read_tokens`,
`reasoning_tokens`, `estimated_cost`, `actual_cost`, `sessions`, `api_calls`.
Missing or invalid numeric metadata is omitted. This implementation deliberately
does not turn missing values into zero or infer totals from partial daily data.
Limits: 800 days, 200 model rows, 2 MiB envelope.

Scheduled tasks consume `{jobs:[{id,profile,name,enabled,state,schedule,...}]}`.
Every task must echo the requested profile. States are `scheduled`, `running`,
`paused`, `completed`, `error`; a scheduled/running row never becomes a fabricated
successful outcome. Schedule is a bounded string, `{kind:'cron',expr}`,
`{kind:'once',run_at}`, or `{kind:'interval',minutes}`; optional
`schedule_display` supplies the display label. `next_run_at` accepts an actual
epoch-seconds number or ISO timestamp. Limit: 500 tasks, 2 MiB envelope.

Board consumes `{items:[{id,kind,title,...}]}`. Required IDs/kinds and duplicate
IDs are strict; optional text is bounded. Items are validated before filtering.
Limits: 200 items, 2 MiB envelope, 1,000-byte titles, 65,536-byte bodies,
8,192-byte notes. These text bounds are local display limits, not assertions
that the upstream parser enforces identical limits.

All endpoints reject mismatched profile/agent echoes when present. Identifiers
reject whitespace, invalid Unicode, controls and bidi overrides. Profiles also
reject `all`, traversal forms and slash/backslash. There is no profile fallback.

## Authority and failure behavior

Every await checks the captured host, principal, profile, authentication
generation and connection generation before accepting the result. The provider
context must match verified provider/user exactly. Dashboard context requires
`principal:null`. Context must contain schema version 1, bounded plugin/runtime
identifiers, at most 64 unique features including `native-context-v1`, an explicit
nullable `servingProfileId`, and the feature declaration when that field is set.
The serving profile is not substituted for the requested agent.

Board additionally requires `native-agent-board-v1`, `Cache-Control: no-store`,
and a strong canonical `"sha256:<64 lowercase hex>"` ETag. The POST carries exact
`If-Match` and lowercase UUID `X-Loopdy-Request-ID`; both response values must
match. Context is read per board load, never silently reused after owner changes.

`HttpStatusError` retains only validated HTTP status, never response bodies or
transport exceptions. Missing fixed catalog/context routes (404/405/501) produce
typed unsupported results. A 404 from `board/list` can mean an absent profile and
remains unavailable. Authentication errors, context conflicts, malformed JSON,
unexpected success receipts and transport failures remain failures. No request
is automatically retried, including a 412.

`boundedHttp` now exposes only the additional safe `cache-control` response
metadata. Comma-separated directives are allowed; duplicate ETag and request-ID
headers remain rejected. Authentication headers never appear in returned DTOs.

## Verification and remaining limits

The new test file was run first and failed because its implementation modules
did not exist. The implemented workspace tests cover source-shaped positive
responses, missing capability suppression, field projection, sizes and
duplicates, host/profile/principal/generation retirement, plugin identity and
cache preconditions, correlation failures, missing routes and strict no-retry.
A local synthetic HTTP server verifies cache directives and duplicate authority
header rejection. Existing transport policy tests also pass.

Checks on the integrated working tree on 2026-10-16:

- `node --experimental-strip-types --test tests/workspace-client.test.mjs tests/transport-policy.test.mjs tests/http-transport.test.mjs`: 35 passed.
- `npm run typecheck`: all three strict configurations passed.
- Integrating agent's `npm test`: 227 passed; production build passed. This
  includes concurrent desktop-service changes and is not isolated workspace-only
  runtime evidence.

The existing transport policy accepts only canonical strong ETags. The Apple
source additionally recognizes specific weak/compression proxy wrappers; that
compatibility is not implemented here and such responses are refused. Usage
does not yet load `/api/analytics/models`, plugin activity or provider limits.
Scheduled run history, delivery targets, blueprints and all writes remain outside
this read client. Board media, links, files, feedback and acceptance are omitted.
These reads have not been exercised against a real plugin host in this change.
