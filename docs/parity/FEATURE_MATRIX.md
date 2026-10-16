# Functional parity matrix

Baseline: [Bighelp Mac Catalyst 2.4.0 (122)](../SOURCES.md). **No complete target feature is qualified or shipped.** The [connected development preview](../evidence/connected-runtime.md) implements parts of F01/F06/F11/F12/F13/F14 with protected persistence, real Hermes transport and text chat. [Canonical Bot Chat](../evidence/canonical-chat.md), [offline display recovery](../evidence/chat-recovery.md) and [navigation draft preservation](../evidence/draft-navigation.md) extend F07/F06/F12. [Read-only workspace clients](../evidence/workspace-client.md) and their [approved A list/detail pages and agent boards](../evidence/function-pages.md) support parts of F23/F25/F26/F28; writes, richer data and complete platform acceptance remain unfinished. [Portable development packaging](../evidence/packaging.md) starts F57. [Integrated qualification](../evidence/development-build-qualification.md) separates synthetic, disposable-host, hosted OS and package evidence. These increments do not close the complete rows. Windows and Linux share the requirement unless a platform replacement/gap is called out.

Disposition: **Port** = same task/contract; **Adapt** = OS-specific equivalent needed; **Gate** = feature/host-dependent; **Retain only** = compatibility contract, no new visible product; **Exclude** = not applicable to shipping Mac parity. Phases refer to the [plan](../IMPLEMENTATION_PLAN.md).

## Everyday product and desktop shell

| ID | Surface / current behavior | Disposition / target | Phase | Acceptance evidence required |
|---|---|---|---|---|
| F01 | First-run consent, add host, discovery, proxy options, all host sign-in modes | Port + OS browser/secret adapter | P2 | Real disposable auth matrix; cloud blocked; cancellation/revocation |
| F02 | One Settings/Nerd Mode, configurable places/tabs, Chat vs IDE home | Port desktop shell | P3 | Same features reachable; no duplicate settings/menu; keyboard-only |
| F03 | Persistent resizable sidebar, title controls, menus, sheets/popovers | Adapt native chrome; preserve structure | P3 | Resize/clamp/persistence; Esc/Return/focus; compact/wide screenshots |
| F04 | Appearance: light/dark/system, bubble/custom color, page colors, text/button sizes | Port current theme resolver; no old themes | P3 | Light/dark/high contrast and scaling; contrast; approved font |
| F05 | Keyboard/mouse/IME, right-click, tooltips, selection/copy/undo | Adapt Ctrl-based shortcuts and native editor | P0/P3 | Actual Windows/Linux IME/caret/focus and screen-reader tests |
| F06 | Cache-first sessions, reconnect, sleep/wake, auth renewal | Port ownership/recovery, adapt lifecycle | P1/P2 | Cold relaunch, token rotation, offline, late callbacks, no duplicate work |
| F07 | Canonical agent Bot Chat vs ordinary New chat/saved chat | Port resolver exactly | P2 | Hidden canonical root/compaction successor; failed resolution retries, no unrelated fallback |
| F08 | Fleet/all-hosts agents/chats/tasks; selected-host switching | Port one connection/store per host | P4 | Isolated per-host cache, slow/offline host; selection not changed by refresh |
| F09 | Deep links/notification navigation; queued startup routing | Adapt desktop protocol/single-instance handling | P2/P8 | Exact saved target, stale/unknown link rejected; no credentials in URL |
| F10 | Help/about/version/plugin-update guidance | Port plain wording and truthful state | P2/P9 | Version/build source, docs links, optional plugin failures do not block chat |

## Chat, profiles, and personal workspace

| ID | Surface / current behavior | Disposition / target | Phase | Acceptance evidence required |
|---|---|---|---|---|
| F11 | Streaming text/Markdown/code/tables, stable history and reader-controlled scrolling | Port behavior; rewrite renderer | P0/P3 | Accepted chat scenarios, exact Unicode/selection, expanded long history |
| F12 | Drafts, reply quotes, attachments rail, composer focus/undo | Port durable intent and independent editor | P3 | Host switch/relaunch/streaming while typing; caption/source bytes retained |
| F13 | Steer default, queue/stop, BTW/background, slash commands | Port finite paths | P2/P3 | `streaming` receipt; busy/refusal/unknown; slash command before session |
| F14 | Approval/clarification, secure secret/sudo/MCP/vault prompts | Port secure request lifecycle | P2/P6 | Real server requests/cancel/expiry, exactly one response, no secret storage |
| F15 | Reasoning/tools/risks/todos/subagents and goal/compaction/context controls | Port truthful projection; Nerd Mode detail | P3 | Unknown outcome neutral, replay/no fake progress, full reader, stale control rejected |
| F16 | Model/reasoning/fast mode and agent runtime defaults | Port scope and readback | P3/P4 | Session vs global, unsupported/inherited, costly confirmation, idle lock |
| F17 | File/image/PDF upload, returned files/generated media | Port current staging and download contract | P3 | Full-batch validation, page bounds, interleaving, uncertainty, cache/resume |
| F18 | Static cards and generated UI/forms/checklists/selections/automation | Port finite schema/components, OS icon mapping | P3 | Positive/negative vectors, canonical hash, safe form idempotency, no JS/network |
| F19 | Reactions and silence rules | Port Hermes message reaction/history semantics | P3 | Saved reaction/agent setting; no synthetic turn or silence-marker bubble |
| F20 | Chat search/list/title/pin/archive/unread/delete/import/export/prune | Port finite catalog and maintenance paths | P4 | New/legacy envelopes, profile filter, reviewed deletion, corrupt imports |
| F21 | Agents create/edit/clone/delete, SOUL/personality/defaults/templates | Port + local artwork controls | P4 | Typed profile lifecycle, group-delete conflict, templates approval and variables |
| F22 | Avatar catalog/creator/petdex/fallback and true live status | Adapt native drawing/licensed assets | P3/P4 | Immutable selected pack survives expiry; no unlicensed art; still reduced-motion state |
| F23 | Feed/Ideas/Goals, read/rate/dismiss/undo, categories/files/blueprints | Port native board features | P4 | Empty by default, no AI calls until Send, exact idea identity, restored dismissal |
| F24 | Artifacts/Media and native file browsing/open/save/upload/mkdir/delete | Port + OS file/preview adapters | P3/P4/P6 | Bounded shallow browse, root/host constraints, safe filenames, explicit writes |
| F25 | Projects cards/folders/new chat, non-repository context | Port project semantics | P4 | Exact folder, typed not-a-repo vs real failure; no cwd fallback |
| F26 | Scheduled tasks, histories, blueprints, time zones/delivery | Port native cron | P4 | Edit/pause/resume/run/delete/duplicate, timezone/DST, spending/recipient confirmation |
| F27 | Group chats / Bot Mode and lossy tool observations | Port hosted groups; never local orchestration replacement | P4 | Event receipts/log order/relaunch, member approvals, explicit Stop, dropped feed reset |
| F28 | Usage charts/limits/model/agent/host breakdown and PDF/PNG/HTML/CSV export | Port + export adapters | P4 | Unknown/null/approximate data, safe self-contained export, full precision |
| F29 | Personal name and speaker note | Port label; adapt local person ID | P4 | No identity claim from display name; no “You” sent; 1.2 s cap; cross-Apple sync not assumed |

## Work management and IDE

| ID | Surface / current behavior | Disposition / target | Phase | Acceptance evidence required |
|---|---|---|---|---|
| F30 | Kanban Later/Ready/Working/Needs you/Done, drag/menu moves and task actions | Gate separate Kanban plugin; port | P5 | No drop into Working; optimistic rollback; approvals/thread/reassign/attachments |
| F31 | Kanban advanced boards/profiles/config/orchestration/runs/diagnostics | Gate; Nerd Mode port | P5/P6 | Full typed API surface and WS cursor, finite dangerous transitions |
| F32 | Workflows home/templates/setup/draft/publish/pin/archive | Gate base/edit features; port | P5 | Old-plugin read-only/unavailable reasons, version conflict/readback |
| F33 | Workflow graph/inspector, compact flow, regular canvas, run monitor | Port desktop layout and keyboard alternative | P5 | Pan/zoom/reorder/rewire, validation, focus and screen reader without dragging |
| F34 | Workflow runs/events/output/sign-off/retry/cancel/triggers | Gate independent features; port | P5 | Hash-bound approval, unknown attempts, durable host execution after client exit |
| F35 | Parallel/delivery/decision-outcome workflow extensions | Gate each advertised capability | P5 | Vector + host execution, no hidden recipient/spending changes |
| F36 | Bighelp IDE launchpad, model/mode/project/worktree/branch chips | Port opt-in home | P5 | Serial setup, back-to-back sends, exact cwd/model, Plan/YOLO refusal safe |
| F37 | Changes/Ship, branches/PRs/worktrees, Markdown read/edit | Port stock Git + OS preview | P5 | Prepare/confirm/readback, no `.worktrees/` commits, changed-file conflict |
| F38 | Orchestration stage/send-all/batch chat and `#` routing | Port | P5 | Per-target routing, preserved chips, no duplicate/misaddressed sends |
| F39 | Dev Factory multi-project v3 runs/command/fix/changes approval/PR | Gate code capability; port | P5 | One run/project/group token, exact changes hash, host Git/gh errors, explicit retry |

## Integrations, voice, and host administration

| ID | Surface / current behavior | Disposition / target | Phase | Acceptance evidence required |
|---|---|---|---|---|
| F40 | Apps/connectors catalog/account connection and inline requests | Port core connector RPC | P6 | Operation ID/lifetime, safe provider URL, confirmed connection |
| F41 | Credential vault/list/sources/import/write/unlock/lock | Port secure metadata UI | P6 | Values never returned/cached; CSV memory cleanup; secure prompt lifetime |
| F42 | Bot Screen remote agent Linux desktop + take control/hand back | Gate display API; adapt bounded RFB renderer/input | P0/P6 | Observe vs control lease, frame bounds, stale viewer/reconnect, exact keyboard mapping |
| F43 | Read aloud and turn-based voice | Adapt OS capture/recognition/playback | P7 | Explicit local/host STT mode, actual mic/headset, temporary file cleanup |
| F44 | Native plugin live voice/WebRTC | Gate; major RNW native integration proof | P0/P7 | Subscription/API-key separation, no double prompt/result, close ≠ cancel work |
| F45 | Group Team Call | Port room/TTS pipeline + OS audio | P7 | Log-order/member voice/barge-in, one in-flight send; hang up keeps room running |
| F46 | Provider keys/OAuth/CLI sign-in/pools/custom endpoints; models/auxiliary/MoA | Port finite host clients | P6 | No direct credential reading, correct profile/scope, status/readback |
| F47 | Local-model catalog/hardware/download/server on host | Port, no bundled inference runtime | P6 | Jobs/progress reflect host, explicit disk/network/cost side effects |
| F48 | Skills/toolsets/MCP/plugins and setup/reload | Port Nerd Mode | P6 | Finite install/test/auth paths, permissions/confirmation, no arbitrary local execution |
| F49 | Messaging, channel pairing, webhooks | Port host management | P6 | Recipient/auth boundaries, onboarding/cancel, no Link pairing resurrection |
| F50 | Memory/learning/curator/logs/system/egress/raw YAML | Port with serving-profile proof | P6 | Redaction, process-profile refusal, partial/unsupported data and reviewed writes |
| F51 | Host update/restart/drain/migrate/backup/import/hooks/checkpoints; fleet maintenance | Port finite reviewed actions | P6 | Installed vs loaded version, per-host result/receipt, no test restart of shared gateways |
| F52 | Optional Hermes achievements | Gate separate plugin | P6 | Catalog/badges, unavailable state, reviewed reset/rescan |
| F53 | Local notifications while running; dedupe/quiet hours/deep links | Adapt + validate enrollment | P8 | OS actual delivery, current-chat suppression, grant/key/replay checks |
| F54 | Notifications/credential renewal while windows closed or process exited | **Open platform/backend gap** | P0/P8 | Approved tray/helper/OS-push model; no false fully-quit delivery claim |
| F55 | Calendar/reminders agent tools | **Preview exception approved 2026-10-16:** unavailable for now; do not advertise | P0/P7 | Future support requires named stores, permissions, revision/uncertain-write behavior; see D4 |
| F56 | Location and agent appearance tools | Adapt; gate feature; appearance unreleased plugin main | P7 | Current-chat/lock scope, approximate choice, literal mode/color and immediate revoke |
| F57 | Desktop installers/updates/uninstall/data policy | Adapt (Sparkle/DMG not portable) | P9 | Signed publisher/update test, clean upgrades/rollback, isolated dev data |

## Retained or non-applicable surfaces

| ID | Surface | Disposition | Reason |
|---|---|---|---|
| X01 | `BighelpMac` standalone prototype | Exclude as target | Fixture tracer, not shipped Mac product |
| X02 | Link cloud chat, paired Direct listener, Bighelp account/passkey/catalog UI | Retain only where wire/migration evidence is relevant | Production native chat replaced them; no app account required |
| X03 | Marketplace, public card-template publishing, live card network data, old theme importer | Exclude visible behavior | Retired/reserved; do not reactivate because code/files/tool names remain |
| X04 | Wiki/Scratchpad/GitHub-reference navigation | Retain API contracts only | Retired navigation, separate native services still exist |
| X05 | Plugin read-only Project Git | Retain optional adapter | Not a replacement for current stock editable Git/IDE |
| X06 | iPhone HealthKit, Watch, CarPlay, widgets, Live Activities, Dynamic Island, Vision Pro room/volume | Exclude from **Mac** parity | Apple-only or not shipping on Mac; desktop equivalents require separate scope |
| X07 | Automatic migration of Apple Keychain/iCloud person identity/cache | Exclude by default | Different OS identity/data authority; explicit migration project required |
| X08 | Native Windows **Hermes host** POSIX-only plugin parity | Separate backend scope | Not required to make a Windows client work with a capable remote Linux/macOS host |

## How to close this matrix

For each F-row, create an implementation issue with exact source owner(s), contract fixtures, both-renderer acceptance steps, and capability/error cases. Keep those issue links in the row when created. Do not create a hundred speculative tickets before the architecture proof.

At release qualification, add Windows/Linux evidence links and the tested host/plugin SHAs. Any incomplete row must be fixed or receive an explicit approved exception. A smaller preview may ship with disclosed gaps, but **must not be described as full Bighelp parity**.
