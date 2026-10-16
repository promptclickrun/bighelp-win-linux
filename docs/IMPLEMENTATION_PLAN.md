# Bighelp Windows/Linux — integration and conversion plan

**Date:** 2026-10-15

**State:** Phase 0 started; shared RN Web/Electron architecture, initial OS matrix, and opt-in background lifecycle approved. Dependencies and product design remain gated. See [P0 evidence](P0_EVIDENCE.md).

**Target:** the shipping Mac Catalyst app, Bighelp 2.4.0 (122), not the `BighelpMac` prototype

**Scope:** every current Bighelp-consumed Hermes/plugin surface, including advanced host tools and the opt-in IDE. This is not a claim to implement every API in Hermes itself.

## 1. Executive recommendation

Build a desktop **client**, not another Hermes implementation. Reuse the existing host authentication, JSON-RPC gateway, stock REST routes, Bighelp plugin, other Hermes plugins, declarative cards, catalog data, and licensed brand assets. Translate Swift behavior into a typed, renderer-independent TypeScript core; rewrite presentation and OS integration.

Approved architecture, subject to technical qualification:

- **Windows and Linux:** React Native Web in a locked-down Electron shell on both. Shared components render through React DOM; neither target uses native React Native widgets.
- **Shared:** contracts, bounded codecs, session/event state, capability gating, feature stores, inert card model, design tokens, fixtures, and most ordinary components.
- **Platform-specific:** privileged networking and secrets, native editor/timeline details, audio/WebRTC, dialogs, notifications, app lifecycle, accessibility, window chrome, and packaging.

Do not promise a shared-code percentage before proving the hard screens. Desktop input and long-chat behavior matter more than eliminating every platform-specific component.

**Remaining approval blockers:** exact dependencies/storage, calendar/reminders integration policy, packaging, and desktop font/visual exceptions. See [DECISIONS.md](DECISIONS.md).

## 2. What the audit established

| Finding | Consequence |
|---|---|
| `BighelpCatalyst` is the shipping Mac product; `BighelpMac` is fixture-only | Trace `Bighelp/` plus Mac platform branches, not the prototype shell |
| Native Hermes REST + `/api/ws` is the only production chat path | No Bighelp login, Link pairing, cloud chat queue, or fallback transport |
| The plugin mounts on the existing authenticated dashboard | Reuse `/api/plugins/loopdy/...`; do not add a new listener |
| Capabilities, not version allowlists, control support | Probe `gateway.capabilities`, feature responses, and `/native/context` |
| The latest app contains substantially more than basic chat | Plan includes groups, boards, files/media, workflows/Dev Factory, IDE/Git, connectors/vault, Bot Screen, fleet, and Nerd Mode |
| Several docs lag current source | Resolve image/PDF uploads, Git writes, voice, navigation, and notifications using source-backed notes in [SOURCES.md](SOURCES.md) |
| Plugin `main` is ahead of published v3.12.0 | Appearance tooling is an upcoming capability, not guaranteed released support |
| Some plugin functionality requires a POSIX **host** | Windows clients can use it on Linux/macOS hosts; native Windows-host support is a separate backend project |
| Apple APIs and shipping assets are not a portable SDK | Rewrite native integrations; audit font/icon/art rights before copying |
| No Windows/Linux binaries or live host were exercised | This is verified source analysis, not runtime parity evidence |

The evidence bundle includes a source-linked [API index](reference/API_INDEX.md), all workspace-operation declarations, HTTP route literals, plugin route/model references, portable card schemas, workflow vectors, generated-card vectors, and imported contracts with provenance.

## 3. Definition of parity

### Functional parity

For every applicable row in the [feature matrix](parity/FEATURE_MATRIX.md), a Windows and Linux user must be able to complete the same task against the same capable host, with the same authority, confirmations, spending disclosures, failure states, and recovery behavior.

A feature counts as supported only when its real controls work, writes are confirmed by the host, and reconnect/relaunch does not corrupt or duplicate work. A fixture, compiled screen, endpoint inventory, or hidden disabled button is not parity.

### Visual parity

Preserve Bighelp's Noodle identity, colors, hierarchy, spacing, cards, conversation layout, agent artwork, sidebar, and feature-specific desktop layouts. Adapt system chrome and keyboard labels to the OS. SF Pro/SF Symbols and Apple's Liquid Glass are not assumed redistributable or reproducible exactly.

Source tokens are the starting point, not an assertion that screenshots were measured. The visual plan requires an isolated Mac reference capture, approved static alternatives, and renderer-specific comparison. No real UI or mock was implemented in this planning pass.

### Explicit non-goals

- Porting Watch, CarPlay, Vision Pro volumes, Dynamic Island, ActivityKit, or Apple widgets.
- Reviving Link chat, the paired Direct listener, old account/passkey UI, Marketplace, old themes, or retired Wiki/Scratchpad/GitHub-reference navigation.
- Running Hermes, local models, workflow agents, or Git commands inside this desktop client. Existing host-owned operations remain remote, even if the user connects to a local host.
- Copying macOS credentials or caches from the daily-driver app automatically.
- Deploying any existing Bighelp cloud service or releasing any app during planning.

Platform replacements such as notifications and device data are **tracked gaps**, not exclusions disguised as full parity.

## 4. Architecture options

| Approach | Advantages | Costs / risks | Recommendation |
|---|---|---|---|
| RN Windows + RN Web/Electron Linux | Honors native RN on Windows; mature Linux desktop shell; shares React Native component/domain code | Two renderers; RNW media/editor modules and accessibility need proof; Electron memory/security upkeep | Not selected; superseded by shared Electron approval |
| RN Web/Electron on both | One renderer, consistent graphics/editor/WebRTC behavior, simpler test tooling | Neither OS uses native RN widgets; greater idle footprint; changes interpretation of the request | **Selected on 2026-10-15**, pending platform qualification |
| RN Windows + native/community Linux renderer | Native drawing on both; no browser shell on Linux | Linux ecosystem/support and native modules unproven; may require owning a renderer fork | Do not choose for parity delivery without a funded feasibility project |

A Tauri/WebKitGTK Linux shell is another potential shell, not a native React Native renderer. Lower bundle size is attractive, but WebRTC/audio, media codecs, WebKit versions, file handling, and desktop accessibility vary across distributions. Prefer a predictable Electron runtime for the first parity proof; revisit only with measured evidence.

The official React Native out-of-tree list includes Windows, Web, and a Skia Linux option. At audit time the listed `react-native-skia/react-native-skia` repository's last push was June 2023. That alone does not prove impossibility, but it does not establish current production support. Do not confuse that renderer with the `@shopify/react-native-skia` drawing library.

Do not pin arbitrary “latest” versions now. Phase 0 must record an exact compatible React/RN/RNW/Node/Electron/toolchain matrix, module support, licenses, and release-build results.

## 5. Proposed component boundaries

Target structure below. Created so far: `apps/desktop/` (main, preload, renderer entry), `packages/contracts/`, `packages/hermes-client/`, `packages/domain/`, `packages/platform/`, `packages/ui/`, and top-level tests:

```text
apps/desktop/               Shared Electron main/preload + RN Web renderer
                            OS-specific adapters and packaging beneath this shell
packages/contracts/         Wire schemas, finite operation definitions, fixtures
packages/hermes-client/     Authentication/session/event state and typed clients
packages/domain/            Feature stores, ownership, send journals, projections
packages/ui/                Shared RN screens/components and design tokens
packages/platform/          Typed OS/network/storage/audio interfaces
packages/test-support/      Scripted gateway/plugin doubles, synthetic datasets
tests/desktop/              Renderer and packaged-app interaction tests
```

### Layering

1. **UI:** renders safe view models and dispatches named user intents. Cannot choose arbitrary routes, inject headers, run shell commands, or read token stores.
2. **Feature stores:** own drafts, selections, pagination, stale-result checks, and finite state machines. React component lifetimes do not own durable execution.
3. **Hermes clients:** fixed operation codecs with profile/session scoping, bounds, mutation policy, readback, and domain-specific errors.
4. **Transport/platform boundary:** owns authenticated HTTP/WS, proxy credentials, OS secret store, file handles, audio devices, browser callbacks, and controlled notifications.
5. **Hermes host/plugin:** owns sessions, prompts, tool execution, approvals, schedules, workflows, repositories, and authoritative history.

On both platforms, privileged work belongs in Electron main or an isolated worker behind validated preload IPC; renderers receive opaque handles and safe results. Disable Node integration, enable context isolation/sandboxing, restrict navigation and permissions, and load only packaged UI. A compromised renderer must not gain a generic `fetch`, filesystem, or shell bridge.

On Windows, keep token handling and exact-origin HTTP/WS in the privileged Electron adapter. The JS/domain contract can be shared without moving bearer secrets into component state. API distinctions stay explicit; don't build a single permissive “call any Hermes method” component API.

### State model

Use normalized stable IDs, immutable snapshots, selectors, and explicit cancellation/lease ownership. Start with simple stores and reducers, not a second event-sourcing framework. Protocol events are ordered data; animated presentation is disposable. Keep chat scrolling and composer state independent of network state and durable cache state.

Use versioned repositories with atomic commit, stable per-host/principal namespaces, and bounded caches. Prefer a transactional SQLite adapter if it passes platform/key-protection tests; otherwise a carefully scoped atomic-file repository can satisfy the first vertical slice. The interface and durability guarantees are mandatory; the storage dependency remains a Phase 0 decision.

## 6. Core integration sequence

### Connect

1. Validate the dashboard address and user-approved private HTTP policy.
2. Discover proxy requirements and Hermes `/api/status`; enrich supported auth methods from `/api/auth/providers`.
3. Complete the exact host's dashboard-token, access-token, password/PKCE, or browser/PKCE flow. Verify the returned principal and atomically store rotated credentials.
4. Mint a **new ticket per socket** for provider-authenticated WS. Apply exact-origin proxy headers in the privileged transport.
5. Register server-request handlers, connect to `/api/ws`, complete `gateway.ready`, advertise server-request support, and discover capabilities. Repeat negotiation on reconnect.
6. Load bounded plugin context and compare its principal to the signed-in host. Discover feature-specific support independently.
7. Present the selected host's cache, then reconcile live catalogs. Optional assets, catalogs, plugin prompts, and notifications cannot block base chat.

### Send and recover

1. Resolve exact host/profile/stored-session/runtime coordinates. Resolve canonical Bot Chat only for agent-entry actions; ordinary New chat remains a new conversation.
2. Save the draft/send intent durably before uploads or submission. If persistence fails, send nothing.
3. Validate the whole attachment batch, stage in order, and retain acknowledged references. Do not replay uncertain staging.
4. Send the speaker note when supported, with a bounded wait; it is a label, never identity authorization.
5. Use `prompt.submit` when idle; route in-flight Send through explicit steer/queue/BTW/background behavior. `streaming` means accepted and still pending, not completed.
6. Reduce events only for the current generation/session; preserve sequence coverage and server requests. Reconcile authoritative saved rows at the turn boundary.
7. On interruption, retain uncertain intent. Reconnect with new ownership leases, resume exact stored identity, replay covered events, and reload authoritative history. **Never resend just because the socket closed.**

Detailed payloads and failure rules are in [HERMES_API.md](contracts/HERMES_API.md), [PLUGIN_API.md](contracts/PLUGIN_API.md), and [STATE_AND_SECURITY.md](contracts/STATE_AND_SECURITY.md).

## 7. Conversion/reuse strategy

| Existing material | Treatment |
|---|---|
| AGENTS, CONTRIBUTING, security/PR guidance | Adapt product, trust, test, review, and cleanup rules; omit Apple tooling/release requirements |
| Python plugin and Hermes server | Reuse in place on authorized hosts; propose isolated companion PRs only for verified desktop gaps |
| Swift HTTP/RPC/state code | Translate behavior into TS codecs/reducers; retain pinned source-to-test traceability |
| SwiftUI/UIKit/Catalyst views | Rewrite with RN/RNW/RN Web; preserve behaviors and desktop geometry, not framework syntax |
| Card JSON schemas and contract vectors | Reuse verbatim with provenance; supplement cross-field validators and canonical hashing |
| Workflow response fixtures | Reuse byte-for-byte as cross-language fixtures, including v2/v3 recipes and errors |
| Theme tokens, glyph source, Noodle/first-party avatar JSON | Extract after approval; validate renderer and licenses; use still art/limited transitions under this project's motion rule |
| Provider logos, Noto fonts, avatar/catalog art | Audit each license, hashes, and redistribution rights first |
| Existing Cloudflare service implementation | Study contracts; do not copy deploy secrets or create a parallel cloud backend |
| Apple cache/Keychain contents | Do not copy. New app uses new local stores and explicit host sign-in |

Maintain source pointers and fixture hashes. When upstream changes, review contract diffs deliberately; do not silently update the target baseline every time `main` moves.

## 8. Implementation phases and deliverables

Effort below is **engineer-weeks**, not calendar promises. Estimates include implementation and focused testing and exclude unapproved cloud services/native Windows-host backend work. They were made for the original split renderer and need re-baselining after the shared-shell proof.

### P0 — approval and platform proof (2–3 engineer-weeks)

**Inputs:** approve architecture options and support matrix; no production host access.

- Bootstrap only after approval; pin compatible toolchain and dependencies.
- Prove packaged RN Web/Electron builds on Windows 11 x64 and Ubuntu 24.04 LTS x64 with Wayland and X11.
- Prove exact-origin HTTP/WS with custom headers, refusal of redirects, binary frames, ticket rotation, cancellation, secure secret storage, and an external-browser loopback callback.
- Prove long virtualized chat with selectable Markdown, an IME-capable persistent composer, expanded tools, prepend anchoring, and keyboard navigation on both target operating systems.
- Prove SVG/first-party artwork, controlled audio recording/playback, WebRTC offer/answer, notifications while running, OS scaling, and accessible names/focus.
- Choose database, schema validator, Markdown parser, list strategy, audio/WebRTC module, and packaging tools from measured evidence. Desktop support must be verified on each OS, not inferred from Android/iOS support.

**Exit:** two packaged test apps with synthetic data; dependency/compatibility ledger; risk results; approved architecture validated. A failure in editor, media, accessibility, or socket policy blocks expansion, not merely a future bug ticket.

### P1 — contracts, ownership, secure persistence (3–4)

**Depends on:** P0.

- Translate finite request/response/error schemas and session/plugin coordinates.
- Implement RPC framing, request/server-request registries, cancellation, limits, event buffers, and connection ownership.
- Implement secret storage, encrypted/protected local repositories, schema migrations, atomic journal writes, redacted diagnostics, and cache limits.
- Import focused Swift/Python behavior into cross-language golden tests. Start with auth, identity mismatch, plugin context, uncertain sends, stale callbacks, and card canonicalization.
- Add CI for shared validation and both OS builds; no signing or releases from PRs.

**Exit:** deterministic boundary tests pass on both OSes; crash/restart never converts an uncertain write into a second send; no tokens in UI state, logs, or ordinary storage.

### P2 — connection and first real vertical slice (3–5)

**Depends on:** P1.

- Onboarding/consent, proxy options, all stock sign-in modes, host add/edit/remove/re-authenticate.
- Capability discovery, plugin presence/version/update presentation, basic agents/catalog/cache.
- Canonical Bot Chat, ordinary session creation/resume, exact `source: bighelp`, title/history, prompt/stream/stop, approval/clarification/secret requests.
- Disconnect, host switch, sleep/wake, refresh rotation, auth revocation, cold relaunch, and delayed callback recovery.
- Disposable real Hermes host with cloud requests blocked; record exact Hermes and plugin source SHAs.

**Exit:** sign in → send → tool approval → completed history → disconnect → reopen works without any Bighelp cloud. Fakes use real receipts, including `streaming` and busy-owner failures.

### P3 — approved visual shell and complete chat (5–8)

**Depends on:** P0/P2 and visual approval.

- First capture the isolated shipping Mac reference, then publish several static conversion mocks and wait for a pick.
- Implement theme/size tokens, custom glyph adapter, sidebar resizing/persistence, title controls, tabs/layout customization, menus, sheets, shortcuts, tooltips, and complete focus behavior.
- Full chat: Markdown/code/tables, tool/reasoning/subagent rows, drafts, mentions/slash commands, reactions/replies, session controls, steer/queue/BTW/background, compact/goal/context controls, long history.
- Files/images/PDF staging, returned attachments/media cache, copy/open/save/share, inert cards, request-bound forms/checklists/selections/automation cards.
- Retain source caps and per-feature error states. No raw attachment marker flash, reset-on-stream editor, or forced bottom scrolling.

**Exit:** source chat-contract scenarios pass in actual renderers; approved light/dark screenshots; accessible keyboard/IME usage at supported scaling; first performance baseline recorded.

### P4 — assistants, everyday workspace, groups, and fleet (4–6)

**Depends on:** P2/P3.

- Agent Studio: profile CRUD/clone, instructions/personality, model/reasoning/fast defaults, avatars, templates/variable filling, pinned/default agent.
- Feed/Ideas/Goals: Markdown, categories, feedback/read/dismiss/undo, promotion/accept, board files, empty state and blueprints.
- Projects, sessions search/archive/pin/unread/delete/import/export, schedules CRUD/run/pause/history/time zones/delivery targets/blueprints.
- Hosted groups: capabilities, state/log recovery, idempotent sends, member approval/retry/stop, separate lossy activity observations.
- All-hosts cache/read ownership, host selection/deep links, usage aggregation, provider limits/activity and PDF/PNG/HTML/CSV exports.

**Exit:** identical tasks on both OSes, no implicit AI spending, no cross-host cache/selection leakage, honest unknown/partial usage.

### P5 — workflows, Kanban, IDE, and Dev Factory (5–8)

**Depends on:** P4; workflow/host capability support.

- Kanban lanes, task/thread/detail/actions, optimistic moves with rollback, board/profile/config/run tools, attachments, event cursor/reconnect.
- Workflows home, draft/publish/bind, templates/pins/archive, responsive graph/canvas/editor, trigger schedules, event pages, output previews/sign-off, run monitor, retry/cancel.
- Parallel, delivery, outcome, and v3 code stages only behind their individual features.
- IDE launchpad, project/worktree/local/branch/model/mode chips, serial setup/back-to-back sends, Changes/Ship, pull requests/worktree management, Markdown preview/save conflict handling.
- Orchestration batches and `#` routing; Dev Factory project runs/group IDs, command/fix stages, exact change-hash sign-off, host-owned PR stage.

**Exit:** workflow v1/v2/v3 vectors and real disposable-repository flows pass; stale sign-off fails; no unintended host command/commit/push; `.worktrees/` excluded from changes/commits.

### P6 — full Nerd Mode, connectors/vault, and Bot Screen (4–7)

**Depends on:** P2/P4; can overlap P5 with separate file ownership.

- Providers/OAuth/custom endpoints/pools, model/default/auxiliary/MoA controls, local-model management on the **host**.
- Skills/toolsets, MCP discovery/install/auth/test/reload, plugins lifecycle, messaging/pairing, memory/learning/curator, webhooks, logs, system/egress, raw configuration, backups/imports/checkpoints/hooks, gateway maintenance, fleet maintenance, achievements where advertised.
- Connector catalog/accounts/connect/operation status and inline connection requests.
- Credential vault metadata, write-only secrets/import, unlock/lock and secure server requests.
- Bot Screen display status/start/observe, bounded RFB decoding/rendering, control lease acquisition/release, keyboard/pointer input, reconnect and explicit hand-back.

**Exit:** every applicable advanced surface has a parity disposition and focused tests; dangerous actions require confirmation/readback; browser/proxy secrets cannot leak into RFB or remote links.

### P7 — voice and device integration (4–7)

**Depends on:** P0 media proof, P3, P4 groups.

- Turn-based device-local recognition where supported; explicitly selected host transcription elsewhere. Do not silently substitute a cloud recognizer.
- Audio selection, bounded temporary recordings, route changes, playback/mute, streaming PCM, TTS lease warmup/fallback, provider settings and readback.
- Live voice through native plugin WebRTC, serialized ordinary Hermes work, verified final answer, no duplicate result append or paid-provider fallback.
- Team calls: member-specific voices, log-order speech, barge-in, independent room execution.
- Appearance device tool; location with opt-in/approximate policy; calendar/reminders adapters only after agreeing a supported data provider on each OS. No invented HealthKit parity.
- Native Windows modules and Linux PipeWire/PulseAudio/desktop-portal behavior must be exercised on hardware.

**Exit:** real microphone/speaker/headset conversations and cancellation pass on both platforms; consent accurately identifies where audio/data goes; unsupported device stores are not falsely advertised.

### P8 — desktop notifications and lifecycle completion (3–6)

**Depends on:** P2; architecture decision and companion plugin agreement required before writes.

- Local OS notifications while the client runs; dedupe by authoritative event identity; suppress current-chat alerts and retain approvals/questions appropriately.
- Do not assume `/native/alerts/listen` works unenrolled: it requires active notification grants and registered recipient keys.
- Prove existing enrollment can support a desktop recipient without Apple delivery. If it cannot, design/review a small versioned host-only desktop subscription capability in the **plugin repo**, with scoped grants, recipient-key binding, retention, revocation, and replay rules. Do not invent a production endpoint in this client.
- Offer explicitly enabled tray/background operation and autostart for alerts while windows are closed. Separate “close window,” “keep running,” “lock,” “sleep,” and “quit.” Device tools/microphone close on lock regardless of notification policy.
- Full Quit ends client alert delivery. No fully-exited push service or hidden background helper is in the approved scope. Retire notification callbacks before shutdown; do not cancel accepted remote Hermes work.
- Keep cloud notification keys and Apple bundle identities out of this app. No production notification-service changes without authorization.

**Exit:** agreed background definition demonstrated on each OS, including offline/lock/wake/quit, no duplicates, signed/sealed payload validation where used, quiet hours, revocation, and stale-link checks. Until then, notification parity is explicitly incomplete.

### P9 — hardening, release qualification, and distribution (4–6)

**Depends on:** all applicable features and approved exceptions.

- Complete feature-matrix evidence, accessibility, visual comparisons, performance, bounded storage, fault injection, security/dependency/license review.
- Windows signed MSIX (or approved alternative), Linux initial packages, protocol registration, uninstall/data policy, clean upgrade/rollback tests.
- Choose signed update metadata/artifacts, channels, monotonic version/rollback policy, and user-controlled update timing. Sparkle is not portable.
- Separate unsigned CI artifacts from maintainer-authorized signed release builds. Protect signing secrets and release environments.
- Ship a private beta first, with an explicit known-gap ledger and exact tested host versions/capabilities. Release only after authorization.

**Exit:** all mandatory matrix rows have real-host/OS evidence or a specifically approved exception; no known data-loss, credential-leak, silent-spending, duplicate-execution, or broken-input defect.

### Effort and sequencing

The phase estimates total **37–60 engineer-weeks**, before a substantial new cloud push service or native Linux renderer. Two experienced desktop engineers with part-time design/security/QA support could plausibly deliver over roughly **5–9 months**, depending on proof results and agreed platform gaps. This is a planning range, not a delivery commitment.

Critical path: P0 → P1 → P2 → P3 → P4 → P5/P6/P7/P8 → P9. Start notification and device-provider feasibility in P0 to avoid discovering blockers late. Do not call the P2 chat slice “full parity.”

## 9. Verification strategy

### Contract tests

- Golden request/response/event fixtures for every finite operation family, including errors and unknown additive metadata.
- Cross-language card hashes, parameter filling, workflow fixtures, and sealed-alert vectors where applicable.
- Negative tests: identity mismatch, wrong session, stale generation, oversized/invalid JSON, duplicate keys at strict boundaries, malformed URLs, missing capabilities, changed ETags, and missing response correlation.
- Distinguish generic request correlation from workflow/room-specific idempotency.

### Disposable real-host tests

Use an isolated Hermes clone/home, exact SHAs, no operator credentials, no real providers except explicitly approved test accounts, and a rejecting optional-cloud endpoint. Cover dashboard-token and provider-auth modes plus password/custom-header/Access-like proxies. Test older capability sets, latest stable, and current main as compatibility lanes—not version gates.

Exercise multi-client ownership, stream interruption, server restart, auth refresh/revocation, gaps/replays, saved-history reconciliation, unknown mutation outcomes, session compaction descendants, uploads, schedules, workflow recovery, and repository readback.

### Renderer/OS tests

Windows: packaged RN Web/Electron on Windows 11 x64 initially; Narrator/UI Automation, 100/125/150/200% scaling, high contrast, IME, mouse/keyboard, minimized/locked/wake. ARM64 is a separate signed-build/hardware gate.

Linux: Ubuntu 24.04 LTS x64 and one additional current distribution/desktop after approval; Wayland and X11; GNOME/KDE Secret Service/notification behavior; Orca/AT-SPI, fractional scaling, IME, audio devices, and restrictive portals. Flatpak adds separate portal/sandbox testing if selected.

Portable UI automation may use Playwright for the shared web renderer; it does not replace packaged-app tests, Windows UI Automation, or Linux accessibility checks.

### Performance and visual gates

Reuse the upstream synthetic short/long/expanded chat scenarios. Preserve its guardrails as comparative checks: elapsed <30 s within a 45 s observation window; max display gap <500 ms; max independent UI queue gap <250 ms; growing-answer queue p95 <50 ms with adequate samples. Define equivalent instrumentation per renderer in P0; these are regression ceilings, not a 60 FPS claim.

Also measure input latency, cold/cache-first startup, host-switch readiness, long-session memory growth, attachment caching, idle CPU/GPU, and window-resize behavior in release builds. Set hardware-specific budgets from the P0 baseline and do not relax them silently. Idle animation timers should stop; this project's motion policy overrides continuously animated upstream loaders.

Visual evidence must cover light/dark, the agreed font, scaled text/buttons, compact/wide layouts, empty/loading/error/unsupported states, expanded tools, cards, canvas, and run monitor. Manual approval is required for platform differences; screenshot similarity alone does not prove functional parity.

## 10. Release and operational boundaries

- No App Store Connect/TestFlight: this repository is Windows/Linux only.
- No changes to the macOS release channel, existing Bighelp cloud, provider accounts, or live Hermes hosts by default.
- Companion plugin changes live upstream, capability-gated, with their own review and release. Release the plugin first when a client feature depends on it; ordinary plugin updates do not require an app rebuild.
- Keep development app IDs/data paths separate from installed daily-driver copies.
- Store signed artifacts in release storage, not Git. Retain only purposeful fixtures and concise evidence manifests here.
- Report exact source/build/OS/host combinations. A successful upload or installer is not acceptance.

## 11. Approval checkpoint

The shared Electron route, background behavior, and initial OS matrix are approved in [DECISIONS.md](DECISIONS.md). P0 has started with executable domain contracts. Complete the dependency/platform proofs and approve static visual mocks before expanding into product UI. Track each slice in a focused issue/PR; see [P0 evidence](P0_EVIDENCE.md).
