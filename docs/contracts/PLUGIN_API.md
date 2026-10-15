# Bighelp plugin and optional integration contract

The plugin is [promptclickrun/bighelp-plugin](https://github.com/promptclickrun/bighelp-plugin), installed on the **Hermes host**, not in the desktop app. Its immutable machine ID remains `loopdy`. The audited source and published release differ; see [SOURCES.md](../SOURCES.md).

This file is the conversion map. The [imported plugin contracts](../upstream/README.md), card schemas, workflow vectors, and [API source index](../reference/API_INDEX.md) supply the detailed shapes, limits, and exact source for implementation. There is no single complete OpenAPI document in the app repo; do not mistake this inventory for runtime-verified server conformance.

## 1. Plugin installation and ownership

User-facing name: **bighelp plugin**. Existing install command:

```sh
hermes plugins install promptclickrun/bighelp-plugin --enable
```

This is documentation, not an instruction to install on the maintainer's machine. It runs on the user's authorized host, normally through the reviewed host plugin-management flow.

- App connects to the existing Hermes dashboard. No extra server, port, pairing account, or Link chat socket.
- Discover the latest published GitHub release, resolve its exact commit, install only after confirmation, and read back installed identity. Do not downgrade a newer/equal plugin.
- A possibly running install must be reconciled against the originally requested commit, not a newly fetched release.
- Loaded module/runtime is separate from installed source. Restart support is capability-gated and consequential.
- Hermes version strings are metadata. Actual public helper/hooks and feature support decide availability.
- Client desktop OS does not change host capabilities. Workflows, safe file traversal, provider CLI sign-ins, and in-place restart may require POSIX hosts even though the plugin manifest names Windows too.
- Do not fork the plugin into this repo. Desktop additions need separate, backward-compatible plugin changes and a maintainer-authorized release.

## 2. Native context and request envelope

`GET /api/plugins/loopdy/native/context`, no body/query, returns ≤16 KiB:

```text
{
  schemaVersion: 1,
  pluginVersion: string,
  runtimeId: string,
  servingProfileId: string | null,
  principal: {provider: string, userId: string, displayName: string | null} | null,
  features: string[],
  unavailable?: {[feature: string]: fixedReasonCode}
}
```

- Provider/user must equal the authenticated Hermes identity. `principal:null` is valid only for verified dashboard-session authority; do not synthesize a person.
- `servingProfileId` comes from process-home helpers, not request-local overrides or an assumed `default`.
- Features are finite unique bounded strings (client ≤64); unknown harmless feature names can be retained without enabling behavior.
- Response has `Cache-Control: no-store` and `ETag: "sha256:<64 lowercase hex>"` over canonical safe context.
- Native POSTs require exact `If-Match` plus `X-Loopdy-Request-ID` as a **canonical lowercase UUID**. Success echoes request ID and context ETag. The source normalizes narrowly recognized proxy weak/compression ETag wrappers; do not strip arbitrary data.
- Native-context authority is a precondition, not an ACL upgrade, person identity, phone permission, install receipt, or universal idempotency key.
- Validate owner before and after every await. Credential/context/runtime changes retire the old scope.

Errors are normally `{error:{code,message,retryable,details:{}}}`. Stock authentication or plugin-disabled failures can occur before this envelope/echo is available.

| Result | Client rule |
|---|---|
| 401/403 | Authentication required; retire stale context, never fall back to another transport |
| 404 | Missing domain object/route/profile; distinguish from plugin absent |
| 409 | Domain conflict/refusal; read back and show the specific action needed |
| 412 | Context changed; rediscover. Does **not** authorize replaying a mutation |
| 413 | Input/response bound exceeded; do not truncate authority or silently omit work |
| 422 | Invalid input/schema; retain edits and show a safe explanation |
| 428 | Missing context prerequisite/unsupported path |
| 429 | Bounded capacity or queue; user-visible wait/retry policy, no mutation storm |
| 503 with `runner_unavailable`, `workflows_unavailable`, `store_unavailable` | Source explicitly classifies as refused before starting |
| Other lost/malformed/5xx mutation receipt | **Outcome unknown**, reconcile first |

An older AGENTS sentence suggests refreshing and retrying once after conflict. The lower-level source and plugin contract are stricter: **never blanket-retry writes**. Workflow request receipts and room sends have their own explicit idempotency; templates/voice/Git do not inherit it.

## 3. Feature-to-route registry

All routes in this table are **POST** under `/api/plugins/loopdy/native/`, except context GET. Feature presence and per-operation authorization/preconditions are both required.

| Feature | Route suffixes | Owner / port requirement |
|---|---|---|
| `native-context-v1` | GET `context` | Verified discovery and correlation |
| `serving-profile-v1` | Context evidence only | Enables safely scoped process-wide clients, not a general route |
| `native-card-templates-v1` | `cards/templates/list`, `install`, `remove` | Inert per-profile bundles; strict hash/version parameters |
| `native-voice-v1` | `voice/status`, `offer`, `poll`, `result`, `close` | WebRTC media control; ordinary Hermes chat owns work |
| `native-room-activity-v1` | `groups/activity/open`, `poll`, `close` | Disposable lossy observations, never durable group history |
| `native-wiki-v1` | `wiki/roots`, `connect`, `resolve`, `list`, `read`, `search`, `image`, `save/begin`, `save/chunk`, `save/commit`, `save/status` | Retained principal-bound service; **no current Wiki browsing UI** |
| `native-wiki-disconnect-v1` | `wiki/disconnect` | Explicit registration removal; not arbitrary filesystem deletion |
| `native-project-git-read-v1` | `projects/git/capabilities`, `status`, `diff` | Read-only canonical adapter, separate from editable stock Git |
| `native-agent-templates-v1` | `agent-templates/list`, `derive`, `read`, `save` | Agent instruction/template file operations with revisions; distinct from card-template store and public template catalog |
| `native-workspace-files-v1` | `workspace-files/scope`, `list`, `read` | Confined serving-profile working folder |
| `native-workspace-recent-v1` | `workspace-files/recent` | Bounded artifacts listing; never recursive full-drive scan |
| `native-workspace-hermes-home-v1` | Changes workspace scope interpretation | Safe Hermes profile `workspace` fallback; never expose secret folders |
| `native-agent-board-v1` | `board/list`, `update`, `media`, `activity`, `approvals`, `identity` | Per-profile Feed/Ideas/Goals and history |
| `native-agent-board-feedback-v1` | `board/read`, `promote`; update fields | Read/rating/reason/undo and idea-to-goal |
| `native-agent-board-goal-categories-v1` | Category fields on board DTOs | Health/relationships/finance/career/interests/productivity/other |
| `native-agent-board-answers-v1` | `board/accept` | Exact idea acknowledgement, then explicit chat initiation |
| `native-agent-attachments-v1` | `attachments/resolve`, `fetch` | Validate actual assistant delivery and bounded chunks |
| `native-agent-media-v1` | `attachments/recent` | Media list, 1–36 entries |
| `native-agent-board-files-v1` | `attachments/board` | Exact post/index file, opaque attachment ID |
| `native-host-restart-v1` | `host/restart` | `{confirm:true}`; restart current serving host, connection will drop |
| `native-people-v1` | `people/speaking` | Speaker label, never identity authorization |
| `native-provider-usage-v1` | `usage/list` | Host reads providers/CLI limits; credentials never in response |
| `native-usage-activity-v1` | `usage/activity` | Hours/days/messages/models for Usage charts |
| `native-provider-sign-in-v1` | `provider-sign-in/list`, `start`, `status`, `submit`, `cancel` | Fixed provider CLI sign-in on POSIX host |
| `native-live-alerts-v1` | `alerts/listen`, `ack`, `stop` | **Requires enrolled grants and recipient keys**; not a public notification feed |
| `native-notification-quiet-hours-v1` | `notifications/quiet-hours` | Per-grant IANA time-zone window; skipped alerts are not delayed |
| `native-workflows-v1` | Workflow base routes below | Host-owned durable runs/coordinator |
| `native-workflows-edit-v1` | `workflows/templates/save`, `templates/delete`, `pin`, `unarchive`; v2 definition editing | Graph/layout, own templates, pins; base-only host shows read-only flow |
| `native-workflows-trigger-v1` | `workflows/trigger/set` | Explicit schedule managed through host cron |
| `native-workflows-parallel-v1` | Definition/run extension | Parallel stages, independently gated |
| `native-workflows-delivery-v1` | Definition/output extension | File/image/delivery stages, external recipient confirmation |
| `native-workflows-outcomes-v1` | Decision outcome extension | Explicit succeeded/cancelled/failed decision endings |
| `native-workflows-code-v1` | v3 definition and run extensions | Dev Factory; host Git required |
| `native-device-tools-v1` | `device-tools/connect`, `poll`, `result`, `close` | Exact agent/session/tool-call context; explicit local permissions |
| `native-device-location-v1` | Enables `location` in channel | Optional location capability, not general background access |
| `native-device-appearance-v1` | Enables `appearance` in channel | Audited plugin main only: **unreleased after v3.12.0** at audit time |

Some routes are dispatched outside `WorkspaceOperation` (files, agent templates, device tools, quiet hours). An enum-only port would miss them. The source index covers those clients too.

## 4. Exact high-use DTOs

### Cards and templates

`loopdy.card` v1 is a **static display document**: `data_sources:[]`, finite elements, no executable JS/HTML, no arbitrary actions/network fetches, no downloaded components. Preserve schema/hash/origin/ID and canonical bytes. Do not compute hashes with ordinary JS property-order stringification; prove canonical encoding against Python/Swift vectors, including Unicode, escaping, and number formatting.

Limits: 64 KiB document; 80 elements; depth 12; 20 children/container; table 8 columns/50 rows; chart 6 series/120 points each; list 50 rendered items. Catalog of components: card, vstack, hstack, grid, text, metric, badge, progress, chart, table, list, divider, spacer, image. Image names map to a **finite licensed cross-platform icon table**, not arbitrary SF Symbols or URLs.

`background` is a recognized optional card-level weather description. Unknown well-formed weather labels retain canonical hash and render a neutral fallback. This project's no-continuous-animation rule requires still weather treatment unless separately approved.

Template routes, response cap/request cap 196,608 bytes, JSON depth ≤24, ≤500 summaries:

| Route | Exact request | Result |
|---|---|---|
| `cards/templates/list` | `{agentId}` | `{agentId,templates:[summary]}` |
| `cards/templates/install` | `{agentId,template:bundle}` | `{agentId,changed,template:summary}` |
| `cards/templates/remove` | `{agentId,templateId,version,sha256}` | `{agentId,changed,templateId}` |

Bundle/summary schemas are preserved in `reference/schemas/`. Identical reinstall is unchanged; downgrade or same-version changed content conflicts. Remove compares exact version/hash. Request UUIDs do not guarantee replay safety. List after uncertainty. Templates are data, not app plugins.

`loopdy.generative_ui` v1/v2 are separate existing contracts, including summary/metrics/list/timeline/weather/sports/stock/chart/dashboard/form/checklist/selection/automation. Do not reinterpret them as `loopdy.card` or enable reserved live-data vectors. Interactive forms use **non-native** plugin routes described in section 8; request-bound forms do not grant arbitrary card actions or secret fields. Secure input has its own prompt path.

### Boards and identity

All bodies include `agentId`:

| Suffix | Additional request | Response |
|---|---|---|
| `board/list` | `kinds,limit,includeDismissed` | `items` with categories/feedback/answers as advertised |
| `board/update` | `itemId`, supported `liked,dismissed,status,rating,reason,read` | Updated `item` |
| `board/read` | `itemIds` ≤200, `read` | `updated` count |
| `board/promote` / `accept` | `itemId` | Exact resulting goal/idea `item` |
| `board/media` | `itemId,index` | `mimeType,data` base64 |
| `board/activity` / `approvals` | `limit` | History with real session titles |
| `board/identity` | None | SOUL/memory/user text ≤64 KiB each with timestamp/truncation |

Per-source client response budgets vary: list/activity/approvals/identity 2 MiB, update/promote/accept 192 KiB, read 16 KiB, media 12 MiB. All are reads of existing content except explicitly marked state changes. Nothing auto-creates a scheduled feed job.

`people/speaking`: `{agentId,sessionId:<stored ID>,personId:<lowercase UUID>,name}`. Name ≤40 visible characters; never send “You” placeholder. Wait at most 1.2 s before the ordinary send proceeds. Mac's person ID can sync via iCloud Keychain; on Windows/Linux use a new local identity unless an explicit identity-linking design is approved. **Do not claim cross-device person identity parity from equal display names.**

### Attachments and workspace files

- `attachments/resolve`: `{agentId,storedId,items:[{itemId,text}]}`; 1–50 assistant-message items, IDs 1–200 characters, `storedId` 1–180, text bounded to 100,000 in the model (additional byte checks apply). Host proves actual delivery, including compaction ancestry, and enforces Hermes delivery policy.
- `attachments/fetch`: `{agentId,attachmentId,offset}`; opaque attachment ID 16–128 characters, strict integer offset 0–25 MiB. **No caller-supplied length field.** Host chunks are at most 3 MiB minus 64 KiB; file ≤25 MiB. Host JSON budget 4 MiB; client decode allowance 4 MiB + 64 KiB. Resume by validated offset; first chunk followed by up to three parallel chunks as source does.
- `attachments/recent`: `{agentId,limit}` → `items:[{id,fileName,mimeType,byteCount,storedId,createdAt}]`.
- `attachments/board`: `{agentId,itemId,index:0..9}` → `attachment` descriptor. Include board `addedAt` in cache invalidation so replacement does not reuse old content.
- Workspace scope/list/read/recent operate on the serving profile's **confined** working folder, with `{path?:string|null}` (≤4,096 characters plus byte/path checks), not a caller-supplied agent scope. Return root/locked-root metadata and bounded entries. Request cap 8 KiB; listing 192 KiB/2,000 rows; read file ≤25 MiB with a separate base64 response budget. Recent includes at most 300, from history and shallow file discovery.
- Never treat missing workspaces, container/SSH backend folders, credential folders, unsafe symlinks, or unsupported Windows-host traversal as an empty successful list. Preserve reason codes from the [files contract](../upstream/plugin/APPS_ARTIFACTS_AND_MEDIA.md).

### Provider usage and sign-in

Usage list `{agentId,refresh:false}` → `{agentId,fetchedAt,cached,providers}`. Each provider has stable ID/name/status/message/plan/detection source/active flag, `windows` with used percent/reset, `facts`, safe manage URL, and `approximate`. Unknown/no-cost data is not zero. Cache 5 minutes, explicit refresh minimum 15 seconds, each provider bounded to 20 seconds; client total timeout 60 seconds.

Provider CLI sign-in bodies all include `agentId`: list; start with `providerId`; status/cancel with `sessionId`; submit with `sessionId,code`. Provider flow is device-code or paste; statuses starting/waiting/needsCode/finishing/signedIn/failed/expired/cancelled. Fixed provider executables/arguments stay on host, never client-supplied commands. Safe provider HTTPS link/code only; no raw terminal output or resulting credentials. At most four sign-ins, 15-minute lifetime; pasted code ≤2,048 visible single-line characters. Core Hermes OAuth providers remain on core OAuth routes.

## 5. Workflows and Dev Factory

Canonical full contract: [WORKFLOWS](../upstream/plugin/WORKFLOWS.md), [DEV_FACTORY](../upstream/plugin/DEV_FACTORY.md), and byte-for-byte workflow fixtures under `docs/reference/fixtures/workflows-v1/`.

All routes below: POST `native/workflows/<suffix>`, native context headers, generally ≤196,608 bytes. Workflow definitions ≤64 KiB. IDs are opaque; times UTC whole seconds ending `Z`. Decode unknown optional state/display fields safely, but never offer an unknown action.

| Suffix | Request | Result |
|---|---|---|
| `status` | `{}` | Coordinator state/heartbeat/epoch, used/total slots, runner/reason/mode, host name, survives-app-close |
| `list` | `{includeArchived?}` | Workflows + waiting + active summaries |
| `get` | `{workflowId,revision?:number|"draft"}` | Definition, revisions, bindings, validation |
| `draft/save` | `{workflowId?,baseDraftVersion,definition}` | Workflow ID, new draft version, validation |
| `validate` | `{workflowId}` | `{validation}` |
| `publish` | `{workflowId,draftVersion}` | Published immutable revision |
| `bind` | `{workflowId,role,agentId:null|string}` | Saved bindings |
| `archive`, `unarchive` | `{workflowId}` | Archived state |
| `pin` | `{workflowId,pinned}` | Pin state |
| `trigger/set` | `{workflowId,trigger:{kind,schedule?,inputs?}}` | Trigger incl. cron job ID where relevant |
| `runs/start` | `{workflowId,revision,inputs,clientRunToken,sample:false,projects?}` | Run summary; v3 also `group_id,runs:[{run_id,project}]` |
| `runs/list` | `{workflowId?,filter,before?,limit?}` | Runs/hasMore/cursor; 1–50 |
| `runs/get` | `{runId}` | RunDetail/stages/attempts/outputs/allowedActions/sign-off |
| `runs/events` | `{runId,after,limit?}` | Sequenced events/cursor/hasMore; 1–200 |
| `runs/control` | `{runId,action,expectedVersion}` | Authoritative new run; pause/resume/cancel/retry only |
| `runs/signoff` | `{runId,stageKey,decision,artifactSha256,notes?}` | Run; stale artifact/change hash refuses approval |
| `artifacts/read` | `{runId,sha256,offset,length}` | `{sha256,offset,total,data,done}`; length ≤98,304 |
| `templates/list` | `{includeCode?:true}` | Built-in/user summaries; code templates only when requested |
| `templates/use` | `{templateId,name?}` | New draft and validation |
| `templates/save` | `{workflowId,name,description?}` | User template ID; no role-agent assignments |
| `templates/delete` | `{templateId}` | `{deleted:true}`; user templates only |

Important differences from generic native calls:

- Workflow mutations retain **24-hour same-request-ID receipts**; reusing an ID for a different request is `request_reused`. Persist original ID/body for authorized reconciliation. This is feature-specific, not permission to retry any write under a new UUID.
- Run start additionally uses `clientRunToken`; v3 repeats return the same project runs. Preserve it across uncertainty.
- v1 linear stages; v2 graph/layout/branch/review loops; v3 code projects/workspace/command/pull-request/changes sign-off.
- Stage roles are existing host profiles. Runs pin definition revision; edits do not retarget running work.
- Host coordinator owns lifetime, concurrency (two slots; queue ≤20), timeouts, artifacts, retries, and recovery. The app never starts its own workflow agents/processes.
- Base stages: agent/check/decision/sign-off; capability extensions add parallel/delivery/outcomes. v3 uses `pull_request` on the wire, even if Swift enum spelling differs.
- Reboot/unknown completion means needs attention. No automatic client retry or inferred success from a stopped process. Unknown token counts remain null.
- File sign-off approves the exact content hash, not publication. A later explicitly configured delivery or PR stage can act only under its reviewed workflow contract.
- v3 one run per project under group ID; worktree default; local placement is shared. Command strings are parsed without a shell on the host. PR stage requires prior sign-off, host Git/gh, and verified changes hash. `.worktrees/` never enters commits.
- Workflow stage sessions use source `workflow` and stay out of ordinary chat recents. Run-level alerts/opening are distinct from stage-chat alerts.

## 6. Live voice and room activity

### Native live voice

Every voice body contains `{agentId,sessionId}` (stored session). Operations add:

- `status`: `provider:"codex_subscription"|"api_key"` → support/provider readiness.
- `offer`: unique `voiceId`, `provider:"codex_subscription"|"api_key"`, `voice` (1–32 characters), audio `sdp` (1–180,000 characters, also byte-bounded in validation) → `{voiceId,sdp}`.
- `poll`: `voiceId,after` (strict integer 0–9,007,199,254,740,991) → `{voiceId,closed,next,events:[{sequence,event}],diagnostics?}`, ≤4 events/page.
- `result`: `voiceId,delegationId` (1–180 characters), `text` (1–1,500 characters) → receipt.
- `close`: `voiceId` → media closure.

`agentId` matches `[a-z0-9][a-z0-9_-]{0,63}`; `sessionId` and `voiceId` match `[A-Za-z0-9][A-Za-z0-9._:-]{0,179}`. Display labels such as “Codex” are not wire enum values; full model definitions are indexed. Offer IDs are consumed before allocation. No replay after an unknown offer/result. Idle lease 60 seconds; event feed bounded (128 events / 512 KiB), event ≤32 KiB. Owner/context/profile/session checks span every operation.

WebRTC audio goes client ↔ provider; plugin credentials/sideband remain host-owned. Default subscription never silently falls back to separately billed API keys. Delegated work goes through ordinary chat/journal, is deduplicated and serialized, and only a verified terminal answer returns to voice. Closing media does not cancel accepted work. Live voice is not another remote job database.

### Group tool observation feed

`open {roomId}`; `poll {roomId,streamId,after,limit}`; `close {roomId,streamId}`. Feed includes runtime/stream/room identity, cursor/highWater, sourceState, reset flags and local drop counters. Limits: 16 feeds/process, 128 observations/256 KiB each, 60-second idle lease, 1–8 observations per poll.

`upstreamLoss:"unobservable"` is deliberate. A tool observed as finished has no trustworthy success result unless canonical data provides it. Reset clears transient rows and reloads group state/log; no invented replay. Never substitute this feed for `groups.log` or treat its sequence as a room-log sequence. The pinned older prose about hook installation is not a version gate; current manifest/conditional registration are the source of availability.

## 7. Device tools

Native channel `connect/poll/result/close` binds one verified agent/session plus enabled finite tools. Tool execution context comes from Hermes middleware (session/turn/tool-call IDs), never model arguments. Lease 30 seconds. App foreground/unlocked/current-chat ownership and host-scoped private-data permissions are independent of OS permission. Appearance instead has one app-wide default-on switch and no OS data permission; preserve that distinction rather than advertising a new broad data grant.

Current shared Mac permission UI exposes calendar, reminders, location, appearance; plugin also has an iPhone Health tool. Do not advertise Health support on desktop. Appearance is the only new tool in audited plugin main beyond published v3.12.0; capability is mandatory. Source app appearance-only polling is 8 seconds, while plugin prose still says 2 seconds—use lease-safe negotiated behavior rather than a hard-coded documentation assumption.

Windows/Linux calendar/reminders are **not drop-in EventKit replacements**. Define a supported local/provider-backed data source, immutable item identity, revision checks, timezone/recurrence semantics, permissions, and uncertain-write journal first. Opening an OAuth connector is not authorization to silently replace a person's Apple calendar with a different store. Location also needs a verified OS/provider route and explicit approximate/precise semantics.

The tool names remain `iphone_*` for compatibility until an upstream additive desktop contract is approved. Do not rename existing wire calls or expand permissions by aliasing a desktop “all data” tool. Appearance reads/sets only finite local mode/color; it is not a remote-code/theme-install mechanism.

## 8. Non-native plugin routes and optional cloud services

These do **not** all use the native ETag/request-ID contract. Port their own authentication, scope, hashes, and envelopes separately.

| Surface | Routes | Treatment |
|---|---|---|
| Generated forms | POST `/api/plugins/loopdy/generative-ui/v2/forms/{request_id}/submit`; GET `/status` | Stored profile/session/request binding; validate action response, expiry and one-time behavior. Status before retry after uncertain submit |
| Older attachment adapter | POST `/attachments/resolve`, GET `/attachments/{id}?profile=...` | Retained delivery-policy adapter; prefer current native path when supported, not arbitrary fallback |
| Granted Workspace Files | GET `/workspace-files/capabilities`; POST `/list`, `/read`, `/status`, `/diff` | Opaque workspace IDs/relative paths and explicit host-local grants; **different** from native absolute locked-root scope |
| Notification discovery | GET `/notifications/capabilities`, `/provider` | Host public signing identity, supported events/sealed v2 capability |
| Enrollments | POST `/notifications/enroll`; GET/DELETE `/enrollments/{grant_id}` | Independent optional delivery authority |
| Recipient/session/preferences | PUT `.../{grant_id}/recipient-key`, `/sessions`; GET/PUT `/preferences` | Recipient material goes app → host, not via notification cloud; exact subscription/preferences |
| Work/event lookup | POST `.../{grant_id}/work`; GET `.../{grant_id}/events/{event_id}` | Validate event/host binding before navigation |
| Live Activities | PUT/DELETE `.../{grant_id}/live-activities/{activity_id}` | Apple-only transport; desktop replacement is not this API |

All abbreviated non-native suffixes above share `/api/plugins/loopdy`; notification enrollment descendants keep `/notifications/enrollments/{grant_id}`. The source index retains the additional dashboard/admin/compatibility declarations; their presence does not mean a new selectable chat path.

Form submit body is `{schema:"loopdy.generative_ui.action_request",version:2,kind:"submit_form",idempotency_key,owner:{profile,session_id},submitted_at,values}`. The idempotency key is a lowercase RFC-compatible UUID (version 1–5 in this validator); `owner.profile` is 1–80 characters and `owner.session_id` 1–180. Preserve request binding and server status, not merely local form completion. The complete GET path is `/api/plugins/loopdy/generative-ui/v2/forms/{request_id}/status`.

Retained dashboard routes include provider configuration, devices/preferences, test notification, events/dismissal, approvals/respond, and `workspace-git/capabilities|status|prepare|stage|commit|push|fetch|pull`. The legacy Git adapter requires explicit workspace grants, expected status and confirmation tokens, and operation-specific idempotency keys. It is not the current stock IDE Git path and cannot become an authorization fallback when the native path refuses.

### Notification boundary

Current app: optional notification identity/service at `link.loopdy.app`, host grants, BuzzKit/APNs delivery, and host-sealed v2 alerts. This historical domain is **not Link chat**.

- Events: session/scheduled/subagent completed/failed, approval required, clarification required; workflow run mapping is documented separately.
- Host signs/seals content to recipient using P-256 agreement, HKDF-SHA256 and AES-256-GCM; pin/verify the host notification key, envelope limits, timestamps, and recipient. Sealed envelope ≤2,300 bytes. Preserve synthetic cross-language vector.
- Generic fallback on invalid/unverified payload. Cloud delivery never authenticates/retargets a Hermes session.
- `native/alerts/listen` takes `{listenerId,grants:[{grantId,recipientKeyId}],waitSeconds,knownAvatars}`; 1–8 grants, wait 0–25 seconds, up to 32 avatar hashes. Reply ≤8 alerts/1,000,000 bytes, ack window 1,000 ms.
- `alerts/ack {grants,eventIds}` accepts 1–32 event IDs; `stop {listenerId,grants}` releases listener ownership. Late ack may not stop an already sent push; dedupe by event ID.
- Quiet hours `{grantId,enabled,startMinute,endMinute,timeZone}`; minutes 0–1439, IANA zone, crossing midnight supported, equal boundaries empty. Quiet alerts are marked skipped, not sent later.
- This existing live-alert feed still needs active enrollment; ordinary dashboard auth alone is insufficient. Desktop support cannot be claimed by replacing APNs display code with an Electron Notification call.

**Desktop gap:** no verified portable fully-closed Windows/Linux delivery contract. P8 must choose explicit tray/background service behavior and verify enrollment; if a host-only desktop grant/subscription extension is needed, it is a new separately reviewed plugin contract, not an endpoint we pretend already exists. No cloud rollout or credential reuse is authorized by this plan.

## 9. Agent-facing tools and catalog boundaries

The plugin exposes render tools (summary/metrics/list/timeline/weather/sports/stock/chart/dashboard/form/card/checklist/selection/automation), form waiting, card-template search/get/render/save, `bighelp_board`, `bighelp_people`, `bighelp_react_to_message`, `bighelp_request_secure_input`, template search/get/fill/create-agent, `bighelp_workflows`, and device tools. These run on Hermes. The desktop app handles their resulting cards/requests/state; it does not execute the Python tools locally.

`bighelp_marketplace_prepare_upload` remains named in the manifest but is **not authorization to recreate a Marketplace**. Public card-template publishing and live card sources are not current production product paths. Agent template catalog and avatar catalog are different real services and must not be removed just because Marketplace is retired.

Agent-template creation remains off by default and requires `templates_allow_create_agent:true` **and** an interactive Hermes approval every time; unattended/YOLO paths must not bypass it. Template-variable filling is single-pass, bounded, literal insertion with reserved `agent_name`/`user_name`; see the copied [variable contract](../upstream/bighelp/TEMPLATE_VARIABLES.md).

## 10. Compatibility checklist

- Missing plugin must leave base native chat working.
- Missing feature hides/disables just its surface with a useful update/reason message.
- `unavailable.native-workflows-v1` preserves actionable POSIX/profile/runner/store reason codes.
- Never infer support from the plugin's version string, installed commit, mere router presence, or manifest platform list.
- New fields may be ignored where safe; unknown executable actions/components/permissions fail closed.
- Preserve every route's own request/response cap and timeout; no one-size-fits-all 1 MiB rule.
- Reconcile writes per domain. Workflow receipts do not make voice/template/file/Git writes replayable.
- Pin fixture bytes and verify source changes in both repos before upgrading the parity baseline.
