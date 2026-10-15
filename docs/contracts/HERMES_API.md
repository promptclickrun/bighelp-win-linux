# Hermes API and integration contract

Scope: the API consumed by the shipping Bighelp Mac Catalyst app at the pinned [baseline](../SOURCES.md). This is not the complete Hermes server API or a live-server conformance certification. The [API index](../reference/API_INDEX.md) and `api-inventory.json` preserve declarations, route/model source links, and request-mapping excerpts so the tables below do not hide secondary operations.

`app:` paths refer to `promptclickrun/bighelp` at the pinned SHA. Fields shown are wire names, not suggested TypeScript names. All HTTP is relative to the selected dashboard base, with host-owned authentication. See [plugin routes](PLUGIN_API.md) for `/api/plugins/loopdy`.

## 1. Authority and connection identity

Keep these separate:

| Coordinate | Meaning |
|---|---|
| Host ID + canonical endpoint | Local selection and exact credential destination |
| Authenticated provider + user ID, or dashboard-session authority | The verified sign-in; a display name is not identity |
| Authentication generation | Retires old credentials and callbacks |
| Connection generation | Retires socket/request leases, not the host's stable cache |
| Profile ID | Hermes agent; exact canonical value, never an inferred `default` |
| Stored session ID | Durable history/catalog coordinate |
| Runtime session ID | Live gateway coordinate; can change on resume/reclaim |
| Session epoch/sequence/turn | Replay and current-turn ownership; not a UI row index |
| Plugin runtime/context ETag | Plugin module lifetime/preconditions, not credentials or installed-source proof |

Never route a request by a user-visible conversation UUID alone. Cache scope survives same-authority reconnect; a different host/principal retires old consumers synchronously. Profile-specific and process-wide operations are distinct: `servingProfileId` evidence is required for process-scoped memory/logs/webhooks.

## 2. Discovery and authentication

Sources: `app:Bighelp/DirectHermes/DirectHermesAuthentication.swift`, `DirectHermesBrowserAuthentication.swift`, `DirectHermesAccessCredentials.swift`, `DirectHermesInterfaces.swift`; [host access contract](../upstream/bighelp/HOST_ACCESS.md).

| HTTP | Input / output | Rules |
|---|---|---|
| `GET /api/status` | Requires boolean `auth_required`; optional `auth_flows` and host metadata | Initial mode discovery. Versions do not allow/deny connection |
| `GET /api/auth/providers` | `{providers:[{name,display_name?,supports_password}]}` | Optional metadata; failure cannot disable advertised native PKCE |
| `GET /` | Inert dashboard HTML/session token | Only ungated dashboard bootstrap; never execute HTML or harvest browser cookies |
| `GET /auth/native/authorize` | PKCE challenge, state, redirect URI, optional provider | External browser or bounded native-password bootstrap; exact callback/state validation |
| `POST /auth/password-login` | Provider/username/password and flow-specific state/cookie handling | Password not persisted; retain only narrowly scoped one-time flow material |
| `POST /auth/native/token` | `{code,code_verifier}` → credentials | One-use exchange; uncertain response cannot be retried blindly |
| `GET /api/auth/me` | Bearer → `provider`, `user_id`, optional expiry | Must match expected principal on restore/refresh |
| `POST /auth/native/refresh` | Refresh token → rotated credentials | Single flight, atomic persistence before use; preserve owner identity |
| `POST /api/auth/ws-ticket` | Authenticated `{}` → `{ticket,ttl_seconds}` | Single use; fresh for every socket/reconnect; bounded URL-safe token and TTL ≤300 s |
| `GET /api/health` | `{ok:true,auth_required:bool,...}` | Liveness only, not feature or write authority |

Native password sign-in is not proxy HTTP Basic. Support manual dashboard session token, provider access token, provider password flow, and external-browser sign-in according to discovery. Never silently switch between host-wide dashboard identity and provider identity.

Browser callback: loopback only, random path/state, bounded one-shot listener, validated origin/redirect, short lifetime, cancellation and late callback rejection. Windows/Linux scheme activation and browser launch must not expose callback credentials in logs.

Refresh nuance: the current authenticator allows a tightly bounded retry of an unanswered renewal within **25 seconds**, matching the host's documented 30-second single-flight window. Outside it, do not replay a rotating token. This exception is not a generic HTTP retry policy.

### Proxy and URL policy

- HTTPS normally; explicit HTTP allowance only for verified private-network/loopback destinations. Never public plaintext credentials or disabled TLS checks.
- Scope Cloudflare service-token headers, proxy Basic credentials, and custom headers to the exact host endpoint on HTTP **and WS**.
- Refuse automatic redirects on authenticated host requests. Auth bootstrap has its own explicitly validated redirect handling; it is not permission for a general redirect-following client.
- Up to 16 custom headers; token-safe names, no newlines; disallow `Authorization`, `Cookie`, `Host`, standard transport/content headers, `Sec-*`, `X-Hermes-*`, `X-Loopdy-*`, and `CF-Access-*` overrides.
- Dedicated cookie-free credential-free public-asset/provider sessions; never share the host cookie jar or headers.
- Host paths are remote strings. A Linux host's `/home/...` must not be normalized using Windows local-path rules.

## 3. Gateway WebSocket contract

`/api/ws` uses `wss` for HTTPS and `ws` for approved private HTTP.

- Provider-authenticated connection: `Sec-WebSocket-Protocol: hermes-gateway-v1, hermes-gateway-ticket.<fresh-ticket>`.
- Dashboard-session connection: `?token=<dashboard-token>` and `X-Hermes-Session-Token` as the source implements. This sensitive URL must be redacted everywhere.
- Register event and **server request** handlers before advertising `client.capabilities {server_requests:true}`. Re-advertise after each reconnect. Otherwise Hermes can auto-answer interactive prompts with blank answers.
- Wait for readiness, probe `gateway.capabilities`, and bind all requests to the exact connection lease. `gateway.ping` verifies liveness.
- `per_session_exclusive_submit` must be supported for the source client's submit/queue/slash capability. Other reads/controls do not automatically disappear with it.

### Frame shapes

```json
{"jsonrpc":"2.0","id":"client-request-id","method":"prompt.submit","params":{"session_id":"runtime-id","text":"Hello"}}
{"jsonrpc":"2.0","id":"client-request-id","result":{"status":"streaming"}}
{"jsonrpc":"2.0","method":"event","params":{"type":"message.delta","session_id":"runtime-id","seq":12,"payload":{}}}
{"jsonrpc":"2.0","id":"server-request-id","method":"clarify","params":{}}
{"jsonrpc":"2.0","id":"server-request-id","result":{}}
```

The last two are shape illustrations, **not complete clarification payload fixtures**. Method-specific request/response validators come from the prompt store and tests. Echo the original string server-request ID exactly; never regenerate it.

The Swift decoder accepts newline-delimited JSON objects inside a text frame, not a JSON-RPC array batch. It distinguishes events, server requests, results, and errors. Errors retain integer `code`, bounded safe message, and where relevant `error.data.reason`.

General wire limits: 4 MiB inbound frame, at most 4,096 line objects, method ≤256 UTF-8 bytes, ID ≤1,024 bytes, nesting ≤64, server response ≤2 MiB. General outbound requests are smaller; only validated attachment/profile-asset methods get their specific larger budgets. Enforce before and during allocation, not only after `JSON.parse`.

### Inbound server requests

| Method | Behavior |
|---|---|
| `approval` | Show action/provenance/consequence and exact choices; no automatic approval |
| `clarify` | Preserve request/session-scoped typed answer and choices across recycled rows |
| `secret`, `sudo` | Secure write-only prompt; no history/log/cache of entered values |
| `mcp.setup` | Finite setup/authorization UI, validated browser URLs, operation ownership |
| `vault.code` | One-time code, transient only |
| `vault.save_login` | Origin-bound login; answer format includes `{identifier,password}` |
| `vault.unlock_prompt` | Transient password-manager unlock value |

`request.cancel` carries exact `{id,method,reason}`; matching both ID and method retires only that request. Host switch, logout, timeout, and connection replacement retire prompts and stale submissions. Older event-based prompts (`approval.request`, `clarify.request`, `secret.request`, `sudo.request`, `mcp.setup.request` and expiries) have explicit compatibility handlers—not a second simultaneously active response path. `approval.received` acknowledges prompt receipt where used; it is not a decision.

## 4. Core RPC families

Sources: `DirectHermesWorkspaceClient.swift`, `DirectHermesSessionActions.swift`, `DirectHermesSessionControlClient.swift`, `DirectHermesGoalControl.swift`, `DirectHermesWorkspaceStore.swift`. The inventory includes full central mapping excerpts, including allowed/required fields; do not pass unlisted fields just because the server might accept them.

| Family / methods | Key request fields | Response / behavioral contract |
|---|---|---|
| `profiles.list`, `profiles.describe` | `include_sessions?`; `name` | Enumerate profile metadata; normal refresh omits session scans |
| `profiles.create` (also clone) | `name`, `clone_from?`, `clone_all?`, `no_alias?`, `mirror_credentials?`, `description?`, `no_skills?` | Explicit creation/clone; credential mirroring is consequential and separately confirmed |
| `profiles.configure` | `name`, description/SOUL/model/provider, expensive-model confirmation, `ui_meta`, expected revisions | Confirm saved profile; preserve unknown optional metadata |
| `profiles.get_asset`, `profiles.set_asset` | `name`, `asset:"avatar"`, `data` or `clear:true` | Validated image; no arbitrary profile file read/write |
| `pet.gallery`, `pet.thumb` | `localOnly?`; `slug`, `url?` | Avatar fallback and rights check; do not treat external pets as first-party art |
| `session.list`, `session.active_list` | `profile`, limits/offset/title/hidden; current runtime where supported | Native discovery separate from REST durable catalog |
| `session.create` | `profile`, `source:"bighelp"`, `close_on_disconnect:false`; folder/title/hidden/follow-profile/model/provider/reasoning/fast fields as needed | Returns runtime and durable identity; IDE must not silently fall back to another folder/model |
| `session.resume` | `profile`, stored `session_id`, `source:"bighelp"`, `close_on_disconnect:false`, `defer_history:true`, `omit_messages:true` | Runtime `session_id`; consistent durable aliases `session_key`/`stored_session_id`/`resumed`. A compaction successor can replace requested stored ID |
| `session.activate`, `session.title` | Runtime, profile/omit-messages; runtime/title | Reuse exact saved chat; handle missing/duplicate Bot Chat title without arbitrary fallback |
| `prompt.submit` | Runtime `session_id`, `text`, optional profile/queued/images per source path | `streaming` is accepted, nonterminal. Busy/rejected/unknown admission are different states |
| `session.steer`, `session.queue`, `session.interrupt` | Runtime/profile, text where needed | Default mid-turn Send steers. Stop is explicit; view unmount is not Stop |
| `prompt.background`, `prompt.btw` | Owner-bound runtime/profile/text | Side-task receipts/results have distinct lifecycle; do not return them as main voice final |
| `slash.exec`, `commands.catalog` | Runtime/profile/command; optional profile/cwd before a session exists | Slash command execution is not literal `prompt.submit` text; `/plan` uses this path |
| `model.options`, `config.get`, `config.set` | Profile/runtime; finite config key/value/scope, expensive-model confirmation | Separate session settings and agent defaults; supported reasoning/fast values from host; readback before success |
| `session.status`, `session.usage`, `session.context_breakdown` | Scoped runtime/profile | Live state, usage, breakdown; not permission to mutate |
| `session.compress`, `session.undo`, `session.save`, `session.cwd.set` | Runtime plus operation-specific bounds | Idle checks/review for relevant controls; authoritative result, not optimistic success |
| `session.control.read`, `session.control`, `session.redirect` and `goal.pause/resume/clear/unwait` action values | Exact revision/control target and action per source | Preserve goal/continuation state and conflict handling; action labels are not all top-level RPCs |
| `session.history`, `session.events.since` | Runtime, `last_seen` for events | REST is durable-history authority in workspace composition; RPC events support covered catch-up |
| `session.branch` | Runtime, optional count/name | Declared native operation; does **not** establish selected-visible-checkpoint/CAS branching support |
| `rollback.list`, `rollback.diff`, `rollback.restore` | Runtime/profile; checkpoint hash and confirmed restore fields | Separate repository/checkpoint rollback, not an invented message-fork contract |
| `message.react` | Exact message/row/session identity, reaction fields | Saved by Hermes; agent-visible reaction setting changes host config, not a synthetic chat turn |
| `subagent.list/tail/interrupt/steer` | Parent runtime, `subagent_id`, text where needed | Child status/controls; historical unknown tool outcome is neutral, not success |
| `delegation.status/pause`, `spawn_tree.list/load/save` | Fixed source-specific scope/fields | Advanced control; do not guess runtime/profile parameters for scope-less methods |
| `skills.reload`, `toolsets.list`, `tools.configure`, `reload.mcp` | Exact fixed shapes | `skills.reload` is scope-less in the source; tools configuration derives profile from runtime |
| `projects.list/get/for_cwd/create/update/archive/set_active` | Profile, project ID; folders/name/description/icon/color/board linkage as allowed | Project identity and folder are authoritative; non-repo folder remains valid chat context |
| `session.workspace.move` | `session_key`, `cwd`, profile | Durable-session workspace move, not local file move |
| `groups.capabilities/list/create/state/send/rename/log/disband/stop/retry/approve` | See groups section | Hosted execution/log owns group truth |
| `plugins.manage`, `mcp.servers.list` | Profile, finite action/config | Host plugin/MCP lifecycle; executable host changes need review |
| `project.facts`, `verification.status` | Project cwd/profile/runtime as source requires | Optional IDE/repository facts; missing data is not success |

### Session config distinctions

`config.set` is not an arbitrary admin editor. Central mapping explicitly permits model/reasoning, session/global fast mode, session-only `yolo`, `display.message_reactions`, and validated agent `terminal.cwd` cases. Raw host configuration has its own reviewed REST client.

Agent defaults also use `GET/PUT /api/config`, projecting `agent`, `delegation`, and `cron` fields. Do not serialize the entire provider credential/config object to the UI. A blank replacement secret preserves the existing key; no-op saves are disabled.

### Hosted groups

- Create `{room_id,name,members}`; send `{room_id,event_id,payload}`; rename includes stable `event_id`.
- Read log `{room_id,since_seq,limit?,include_disbanded?}` and state separately. A snapshot/receipt cannot advance past unreplayed log entries.
- Stop/disband use `cancel_id` where applicable; retry identifies `task_id`.
- Approval includes `{room_id,member_id,task_id,execution_generation,request_id,choice}`.
- Persist the pending-send identity; follow the group's specific idempotency contract, not generic RPC replay.
- Closing a view, stopping voice, or reconnecting does not stop a room. Group tool observations are separate lossy plugin feeds.

## 5. Streaming events and reconciliation

| Event group | Required handling |
|---|---|
| `gateway.ready`, request cancellations | Fence old transport first; renegotiate handlers and catch up before new admission |
| `message.start/delta/interim/complete` | Exact text, stable turn identity, pending lifecycle, final receipt/history reconciliation |
| `reasoning.delta/available`, `thinking.delta`, `status.update` | Bounded disclosure and status; never fabricate canonical assistant text |
| `tool.generating/start/progress/complete`, `tool.output_risk` | Exact tool identity and truthful outcome; preserve full content behind bounded previews |
| `session.info/title/usage/control.update/reclaimed` | Model/reasoning/fast/title/stored-ID/control updates; reclaim revokes writer before presentation |
| `background.complete`, `btw.complete`, `review.summary`, `notice` | Distinct auxiliary result/notice projection |
| `todo.updated`, `subagent.*` | Task snapshots, roster changes, exact child ownership |
| `message.reaction`, `reaction` | Durable tapback vs transient affection effect; no replayed animation storm |
| `connection.request/update` | Current connector operation/card only |
| `display.status/lease` | Screen state and take-control ownership |
| Legacy interactive request/expiry events | Negotiated compatibility path; no double replies with server requests |

Ignore unknown additive display events safely, but do not silently skip a required authority/replay transition. Replay uses native epoch/sequence coverage. The source caps held events at 16,384; overflow or gaps require authoritative reconciliation, not fabricated missing work. Event cursors, group-log cursors, plugin observation cursors, and UI row IDs are different types.

Source history is the truth after a turn. `persisted_turn.user_row_id` and `final_assistant_row_id` bind optimistic rows to saved rows without duplication. Preserve drafts, disclosures, selection, and reading anchors through that replacement.

## 6. Durable REST and advanced administration

This table groups the full source route inventory. `{...}` denotes validated path parameters; the machine index retains the Swift interpolation and exact source location. Methods on dynamic routes must come from the source's finite enum, never a UI-provided suffix.

| Surface | Stock routes and verbs | Contract / source owner |
|---|---|---|
| Sessions | GET `/api/sessions`, `/search`, `/{id}`, `/{id}/messages`, `/stats`, `/empty/count`, `/{id}/latest-descendant`; PATCH/DELETE `/{id}`; import/export/bulk-delete/prune/owner-backfill/empty actions | `DirectHermesWorkspaceClient`, `DirectHermesSessionMaintenanceClient`; profile scope and reviewed destructive actions |
| Catalog envelopes | New `{object:"list",data,has_more,limit,offset,total?}` or legacy `{sessions,total,limit,offset}`; detail `{object:"hermes.session",session}` or legacy object | Normalize at boundary, verify row IDs/profile; do not mix partially matching shapes |
| Profiles | GET `/api/profiles`, active/project-tree/session-PR catalogs; GET/PUT `/{profile}/soul`; export/import/delete/describe-auto/setup-command | `DirectHermesProfileLifecycleClient`; explicit import/clone and readback |
| Scheduling | GET/POST `/api/cron/jobs`; PUT/DELETE `/{id}`; POST `/{id}/pause`, `/resume`, `/trigger`; GET runs/delivery-targets/blueprints; POST blueprint instantiate | Canonical schedule, host time zone, profile, prompt/name/model/provider/skills/workdir/delivery; distinguish run now from save |
| Model/providers | `/api/model/options`, `/info`, `/set`, `/auxiliary`, `/moa`, `/recommended-default`; `/api/providers/validate`, OAuth start/poll/submit/cancel; custom endpoints; `/api/credentials/pool`; `/api/portal` | `DirectHermesProviderClient`, `ModelAdministrationClient`; separate account OAuth, host auth, and plugin CLI sign-in |
| Config/keys | GET/PUT `/api/config`, `/api/config/raw`, `/api/env` | Scoped config and reviewed raw YAML; secret values write-only in UI, key-presence projections only |
| Local models | `/api/local-models/status`, hardware/catalog/search/files/jobs/server/quickstart; download/download-browsed/activate/eject/sideload/runtime-install/model removal | `DirectHermesLocalModelsClient`; these operate on host hardware, not client hardware |
| Skills | GET/POST `/api/skills`, GET/PUT `/content`, PUT `/toggle`; `/hub/search`, official/preview/sources/scan/install/update/uninstall | `DirectHermesSkillsHubClient`; installation is executable host content, not app extensions |
| Toolsets/backends | `/api/tools/toolsets`, `/{name}` and config/env/model/models/provider/post-setup; terminal backend(s); computer-use status/permission grant | `DirectHermesToolsetClient`, `HostToolBackendsClient`; explicit permission/grant and action-status readback |
| MCP | `/api/mcp/servers`, `/{name}`, `/enabled`, `/test`, `/auth`; catalog/install; OAuth flows | `DirectHermesMCPClient`; host-owned process/OAuth, no local MCP server in client by default |
| Plugins | `/api/dashboard/plugins/catalog`, hub/rescan; `/api/dashboard/agent-plugins/install`, `/{name}`/enable/disable/update plus `plugins.manage` | `DirectHermesPluginLifecycleClient`; install exact resolved release commit, don't downgrade |
| Messaging/pairing | `/api/messaging/platforms` and per-platform setup/test; Telegram/WhatsApp onboarding start/status/apply; `/api/pairing`, approve/revoke/clear-pending | Hermes messaging-channel pairing, **not retired Bighelp Link pairing** |
| Memory/learning | `/api/memory`, provider/config/setup/OAuth/reset; `/api/learning/graph`, `/node`; `/api/curator`, `/paused`, `/run` | `DirectHermesMemoryClient`; process-profile evidence and destructive reset confirmation |
| Webhooks | `/api/webhooks`, `/enable`, `/{name}`, `/{name}/enabled` | `DirectHermesWebhooksClient`; finite create/edit/delete/toggle, secret masking |
| Usage | GET `/api/analytics/usage`, `/api/analytics/models` with profile/days | Aggregates, null/unknown cost, cache rates; plugin limits/activity are independent |
| Logs/status | GET `/api/logs`, `/api/system/stats`, `/api/egress/status`, `/api/status` | Serving-profile and bounded log reads; no sensitive diagnostics spill |
| Host maintenance | Hermes update check/receipt/update; gateway start/stop/restart/drain/migrate/plan; `/api/actions/{action}/status`; `/api/ops/...` diagnostics/checkpoints/backup/download/import/upload/hooks | `DirectHermesHostOperationsClient+*`; finite actions, reviewed scope, receipts and readback. Never test gateway restart against shared processes |
| Achievements plugin | `/api/plugins/hermes-achievements/achievements`, recent-unlocks, rescan, reset-state, scan-status, sessions/{id}/badges | Separate optional plugin, not a Bighelp native feature flag |

Do not treat a source route string as evidence of reachability on every host. Retained helpers, deprecated surfaces, and richer Nerd Mode operations coexist. The feature matrix determines product scope; per-feature capability and response checks determine runtime availability.

## 7. Files, images, PDFs, and media

### Composer upload

Current **source** supports all three routes below, despite older architecture prose saying image uploads were disabled:

| RPC | Payload / receipt |
|---|---|
| `file.attach` | `{session_id,name,data_url}` → validated `ref_text` and file receipt; append only acknowledged reference to prompt |
| `image.attach_bytes` | `{session_id,filename,content_base64}` → validated staged-image receipt; session queue, no file reference text |
| `pdf.attach` | After `file.attach`, `{session_id,profile,path,first_page,last_page}` using **only** that authenticated staging receipt's path → bounded selected-page receipt |

Whole draft: ≤10 unique attachments, ≤8 MiB per ordinary attachment, ≤24 MiB total, message ≤1 MiB. Large attachment frame allowance is ≤12 MiB and only for validated base64 shapes. PDF: the stock protocol allows 50 MiB, but this app's upload path retains the **8 MiB** attachment cap; select at most **25 consecutive pages** per request from a document of at most **100,000 pages**. Reject encrypted/password-protected PDFs. Preserve both app and host limits rather than widening the upload simply because the host can accept more.

Persist intent before the first upload. Stage serially in insertion order; keep caption and selection. Any uncertain stage stops automatic progress/retry. Because image/PDF staging is session-global on the current source path, the port must test interleaving with another client and **must not claim stronger message binding than Hermes provides**. If it cannot be used safely, expose the gap and obtain a contract change instead of quietly broadening it.

### Host files and returned media

- Agent deliveries use plugin native `attachments/resolve`, `/fetch`, `/recent`, `/board` with stored-session/profile provenance; do not turn a `MEDIA:` string into an arbitrary URL or host file read.
- Stock media/file reads: `/api/media`, `/api/files/read`, `/download`, `/stream`; bounded binary/range clients and exact-origin headers. Returned public HTTPS images use a separate credential-free public-host policy.
- Managed host files: `/api/files`, `/mkdir`, `/upload`, `/upload-stream`, delete, fixed `locked_root`/scope checks; native plugin scope/list/read/recent are a separate adapter.
- Folder browse: `GET /api/fs/list`. Markdown preview: `GET /api/fs/read-text?path&profile`; save: `POST /api/fs/write-text?profile` with `{path,content}`. Re-read before save and ask on conflict; this is not atomic server CAS unless the host adds it.
- Follow source download integrity/size checks, bounded parallel chunks, cache eviction, cancellation, and safe local filenames. Attachment cache target is 512 MiB, least-recently-used; do not evict unsent draft data as if it were disposable.

## 8. Git and IDE

`DirectHermesStockGitClient.swift` is the current editable route; the plugin's `native-project-git-read-v1` remains a separate read-only adapter.

| Method | Routes / fields |
|---|---|
| GET | `/api/git/status`, branches/base-branches/worktrees, `/gh-auth`; `/review/list?scope`, `/review/diff?file&scope&staged`, `/file-diff?file`, `/review/commit-context`, `/review/rev-parse?ref`, `/review/ship-info` |
| POST | `/api/git/review/pr-list` with `path,branches,numbers` (read query despite POST) |
| POST | `/review/stage`, `/unstage`, `/revert` with `path,file`; `/commit` with `path,message,push:false`; `/push`, `/create-pr` with path |
| POST | `/api/git/branch/switch` with path/branch; `/worktree/add` with name/branch/base or `existingBranch`; `/worktree/remove` with `worktreePath,force` |

Target must be the current registered project's primary folder or a linked worktree in its latest verified snapshot. No arbitrary cwd. Prepare finite action locally with review/confirmation/status token, consume it once, perform the fixed route, and read back status/review/worktrees. These tokens are not a server repository lock; do not claim atomic CAS or exactly-once Git execution. Reconcile uncertain writes without blind replay.

IDE sets model/provider/reasoning/fast in `session.create` before the first turn, serializes setup across sends, and uses exact worktree/local folder. Plan uses slash-command semantics; YOLO is session-only and a refused setting sends nothing. Ship is not an arbitrary shell. Stock create-PR has no client title/body fields. Worktree cleanup is an explicit user action, not session completion. Exclude `.worktrees/` from change/commit projections.

## 9. Connectors, vault, Kanban, and Bot Screen

### Connectors and vault

Connectors: `connectors.list`, `catalog`, `accounts`, `accounts.rename/remove`, `connectors.connect`, `operation.wake/status`, and `connection.respond`. Distinguish account-owned from profile-owned entries, safe provider browser links, and current `op_id`. Inline connection cards follow `connection.request/update`; no transcript scraping or invented connection success.

Vault: `vault.list`, `sources`, `add`, `remove`, `source.set`, `unlock`, `lock`. Lists show labels, not secrets. CSV imports are bounded, read transiently, and preview only safe metadata. Entered/imported secret is sent once, not persisted locally. Hosts returning `-32601` get a clear unsupported/update state.

### Kanban (a separate Hermes plugin)

`/api/plugins/kanban`: boards/board/switch/import/export, tasks and detail/update/delete, comments/logs, transitions/reassign/reclaim, bulk, estimate/dispatch, attachments, assignees/projects/profiles, model-options/home-channels/config/orchestration, runs/inspect/terminate, stats/diagnostics/workers.

Exact route variants and action suffixes are indexed from `Bighelp/HermesPlugins/Kanban/`, `Bighelp/DirectHermes/DirectHermesKanbanTransport.swift`, and the service/UI in `Bighelp/Kanban/`. Do not replace its finite transition client with generic HTTP writes. “Working” is host-started; New defaults to Later; Auto plan/Start now disclose AI spending. Moves can be optimistic visually but must revert on refusal.

`/api/plugins/kanban/events` is a separate authenticated WebSocket with board/since cursor and a fresh bearer ticket (or dashboard token). Its cursor is not the chat event cursor. Validate attachment provenance, bounded upload/download, and task/run revision before decisions.

### Bot Screen

RPC `display.status/start/stop/thumbnail/observe/lease.acquire/lease.release` is profile scoped. `observe` issues an observation ticket/viewer identity; connect only through the bounded authenticated `/api/display/ws` stream. Implement the source RFB handshake/encodings and framebuffer bounds; do not expose arbitrary VNC/network addresses.

Viewing is not control. Send input only while the exact current viewer owns the control lease. Handle `display.status/lease`, lost focus, disconnect, takeover, and explicit hand-back. Releasing a viewer/closing the window is not permission to stop the host's desktop. This shows the **agent's host screen**, not screen capture of the user's Windows/Linux computer.

## 10. Voice, external catalogs, and errors

Voice has several distinct contracts:

1. Device recognition (platform adapter) or **explicitly chosen** host STT `POST /api/audio/transcribe?profile` with bounded audio data URL/mime type (25 MiB host recording limit).
2. Host TTS `POST /api/audio/speak?profile`, warm lease `/api/audio/tts-lease`, and separate `/api/audio/speak-stream` WebSocket. Fresh ticket; JSON start/fallback/end plus bounded Int16 PCM; no silent duplicate playback after partial success.
3. Native plugin live voice (`native-voice-v1`): WebRTC media + bounded control feed; ordinary chat owns execution.
4. Advanced stock voice configuration/client-direct provider helpers: `/api/audio/voice-config`, `/elevenlabs/voices`, `/voice-live/status`, `/voice-live/session`. Retained reachable management/test tooling must not silently replace the normal live-voice path. Client-direct config can include a transient provider credential; hold it only in privileged memory, bind it to owner/lifetime/HTTPS endpoint, and never log/persist it. This is an explicit exception to the usual host-keeps-provider-keys path.
5. Group Team Call uses room sends/logs and per-agent TTS, not a realtime group model. Hanging up does not call `groups.stop`.

External integrations: avatar catalog `avatars.bighelp.app`, template catalog `catalog.bighelp.app`, provider-logo catalog, petdex assets, and GitHub plugin releases. Load with dedicated safe public clients, bounds/integrity checks, cache/fallback, and no selected-agent/provider telemetry. Catalog text is data, not instructions granting privileges. Specific URLs/manifests and template-variable rules are pinned in [SOURCES.md](../SOURCES.md).

### Error taxonomy

Expose typed outcomes: cancelled-before-dispatch, auth required, owner changed, unsupported/missing plugin, conflict, capacity exceeded, definite refusal, transport unavailable for reads, and **outcome unknown** for potentially delivered writes. Preserve safe actionable host messages; never render arbitrary HTML errors.

Recognize source compatibility codes such as JSON-RPC `-32601` unsupported, `4000` invalid parameters, `4007` missing session, `4022` title conflict, and busy-owner reasons such as `4090` where applicable. Retry only known safe reads or a domain-specific reconciled operation. Capability/version advice must not hide permission, identity, malformed-response, or genuinely failed-host errors.
