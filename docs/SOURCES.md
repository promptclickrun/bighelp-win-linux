# Source audit and provenance

Audited **2026-10-15**. This is a static source audit for an implementation plan, **not** a live Hermes compatibility certification or a visual screenshot measurement.

## 1. Frozen baseline

| Source | Revision / release | Role |
|---|---|---|
| [Bighelp app](https://github.com/promptclickrun/bighelp) | [`d62a545386fb1b63f8ca33365766a46b3b1bd636`](https://github.com/promptclickrun/bighelp/commit/d62a545386fb1b63f8ca33365766a46b3b1bd636), [Mac 2.4.0 (122)](https://github.com/promptclickrun/bighelp/releases/tag/mac-v2.4.0-122) | Current shipping Mac parity target |
| [Bighelp plugin main](https://github.com/promptclickrun/bighelp-plugin) | [`bb7f9e5a7be74751c9b192a8a878350f714466d6`](https://github.com/promptclickrun/bighelp-plugin/commit/bb7f9e5a7be74751c9b192a8a878350f714466d6) | Detailed host contract, including unreleased appearance tools |
| Latest published plugin | [v3.12.0](https://github.com/promptclickrun/bighelp-plugin/releases/tag/v3.12.0), [`e093d4b649cc92d1ed49df6c6b969c2cc82b6e7e`](https://github.com/promptclickrun/bighelp-plugin/commit/e093d4b649cc92d1ed49df6c6b969c2cc82b6e7e) | Released-support baseline; not equal to audited main despite the manifest still saying 3.12.0 |
| Hermes | Client-consumed contract only; no independent server SHA qualified | P2 must record and exercise exact disposable-host revisions |

The shipping product is **`BighelpCatalyst`**, compiling the shared `Bighelp/` code with Mac branches. `BighelpMac/` is a standalone fixture prototype. This distinction follows the app README/project configuration, not a guess from directory names.

This new repository is independent, not a fork with inherited upstream history. No parent-repository changes were adopted.

## 2. Authority and inspection scope

Read source and validators first when prose disagrees. Order of evidence:

1. Shipping composition and actual feature clients/route switches at the pinned app revision.
2. Host plugin mounted routers, finite models/validators, capability registration and focused tests at the pinned plugin revision.
3. Accepted product/interaction contracts, fixture vectors and current design system.
4. Older architecture/security/readme prose, retained only with the corrections below.

Inspected the app's agent/contributor/design/transport/chat contracts, `Bighelp/DirectHermes/`, workspace operations, chat/voice/device integrations, workflows, IDE/Git, Kanban, connectors/vault, Bot Screen, notifications, catalogs, platform branches and tests. The plugin audit included mounted native/dashboard routers, context/features, tools/manifest, docs and fixture contracts. Cloud services were read for boundaries, **not deployed**.

The [machine inventory](reference/api-inventory.json) and [human index](reference/API_INDEX.md) record:

- **189** application operation declarations and **140** central mapping blocks.
- **280** HTTP literal expressions and **276** dotted protocol-name literals, with source locations.
- **116** plugin route declarations (dynamic finite dispatch placeholders remain explicit), **112** Python boundary-model declarations, **36** native feature names and **34** manifest tools.
- Source type pointers, exact central Swift/Python model excerpts and scanned-file hashes.

These are lexical/source declaration counts, **not counts of unique reachable endpoints**. Some literals are prefixes, interpolated paths, events, config labels, compatibility code or fixture-only branches. The feature matrix plus actual capability checks determines which become product behavior. There is no claimed complete upstream OpenAPI or generated TypeScript SDK.

## 3. Primary source map

Paths below are under the pinned [app source tree](https://github.com/promptclickrun/bighelp/tree/d62a545386fb1b63f8ca33365766a46b3b1bd636) or [plugin source tree](https://github.com/promptclickrun/bighelp-plugin/tree/bb7f9e5a7be74751c9b192a8a878350f714466d6). Per-file/line links are in the API index.

| Contract | Source owners |
|---|---|
| Product / contributors | App `AGENTS.md`, `CONTRIBUTING.md`, `SECURITY.md`, `.github/pull_request_template.md`, `DESIGN.md`, `project.yml` |
| Authentication / gateway | `Bighelp/DirectHermes/DirectHermesAuthentication.swift`, `DirectHermesBrowserAuthentication.swift`, `DirectHermesInterfaces.swift`, `DirectHermesAccessCredentials.swift`, wire/socket clients |
| Finite API dispatch | `Bighelp/Workspace/WorkspaceOperation.swift`, `Bighelp/DirectHermes/DirectHermesWorkspaceClient.swift`, `DirectHermesNativeContext.swift`, feature-specific clients |
| Session identity and streaming | `DirectHermesSessionActions.swift`, `DirectHermesConversationClient*`, `DirectHermesWorkspaceStore*`, capability/release/session-control models, chat prompt store |
| Private state / UI ownership | `docs/CHAT_INTERACTION_CONTRACT.md`, cache/startup/continuity/performance docs, prepared chat models, durable journal/cache and test scenarios |
| Attachments/PDF/audio | `DirectHermesAttachmentClient.swift`, `DirectHermesPDFAttachments.swift`, `DirectHermesVoiceClients.swift`, `DirectHermesVoiceConfigurationClient.swift`, `Bighelp/Voice/` |
| Files and Git | `DirectHermesStockGitClient.swift`, managed/native file clients, `Bighelp/Code/`; plugin `native_project_git.py`, workspace-file/git models and validators |
| Kanban / Bot Screen | `Bighelp/HermesPlugins/Kanban/`, `Bighelp/Kanban/`, `DirectHermesKanbanTransport.swift`, `Bighelp/BotScreen/` |
| Workflows | `Bighelp/Workflows/`, `BighelpTests/Fixtures/Workflows/`; plugin `workflow_api.py`, models/store/coordinator and `fixtures/contracts/workflows-v1/` |
| Plugin feature/DTO authority | `loopdy_plugin/native_context.py`, `native_api.py`, native voice/device/files/attachments modules, `dashboard/plugin_api.py`, mounted routers |
| Cards / forms / templates | Plugin `spec/`, `docs/CARDS.md`, card/template/generative-UI validators; app card models; `services/catalog/docs/TEMPLATE_VARIABLES.md` |
| Optional notifications | App native enrollment/live-alert/sealed-alert clients; plugin `managed_notifications_api.py`, `managed_notifications.py`, `live_alerts.py`, `sealed_alerts.py`, `quiet_hours.py` |
| Device tools | App device permission/channel/mutation-journal source; plugin `native_device_tools.py`, `device_tools.py`, `docs/IPHONE_DEVICE_TOOLS.md` |
| Visual system | `Bighelp/DesignSystem/BighelpTheme.swift`, `BighelpTokens.swift`, `BighelpInterfaceSize.swift`, `BighelpSheetSize.swift`, `Bighelp/App/BighelpSideMenu.swift`, brand/glyph/avatar source |

## 4. Known conflicts and corrections

| Older/ambiguous evidence | Current source-backed interpretation |
|---|---|
| `BighelpMac` sounds like the app to port | It is not shipping Mac; use shared Catalyst code and its Mac branches |
| Architecture says image upload is disabled | Current clients implement `file.attach`, `image.attach_bytes`, `pdf.attach`; enforce their real limits/uncertainty |
| Workspace/Project Git prose says read-only | Plugin native Project Git stays read-only, but current stock Git/IDE includes stage/unstage/revert/commit/push/PR/branch/worktree actions |
| Voice prose says all recognition is on-device and audio never touches disk | Explicit host STT mode uploads bounded audio and uses temporary capture; live voice/provider transport has a different privacy contract |
| Link, pairing, account catalog and old cloud details coexist in source | Production chat is native Hermes; optional notification identity is not permission to restore Link chat/accounts |
| Security/device docs still describe directed Link transport | Current device tools use the authenticated native plugin channel; do not port obsolete routing |
| Context conflict means refresh and retry | Refresh discovery, but do not blanket-retry mutations; workflow/room/form idempotency is operation-specific |
| Plugin version string means all features exist | Main has unreleased `iphone_appearance`/`native-device-appearance-v1` beyond published v3.12.0; check advertised capabilities |
| Device tool polling described as uniformly two seconds | App has slower appearance-only polling (8 s); lifetime/foreground/channel ownership still apply |
| All device grants are private-data host permissions | Appearance has one app-wide default-on switch, no OS data permission, and foreground/current-chat limits; calendar/reminders/location have independent sensitive-data policy |
| Chat contract describes Home/Scratchpad/Wiki/GitHub reference navigation | Keep its chat/ownership/performance guarantees, not retired navigation. Current root/design source owns reachable places |
| Manifest lists Windows as a plugin platform | Some host helpers require POSIX. Windows client parity can use a Linux/macOS host; Windows-host parity is separate |
| Native live alerts are enough for desktop push | They require active grants/recipient keys; fully-exited Windows/Linux delivery is unqualified and needs an explicit design |
| Apache-2.0 applies automatically to all icons/fonts/art | Apple and third-party assets require individual rights review; no such binaries were imported |
| App/plugin workflow fixtures must already be identical | 40 of 43 match byte-for-byte; three plugin fixtures add `trigger`, stage `uses`, and `decisions`. Keep additive tolerance; see fixture README |

Imported historical docs have a provenance banner and remain unchanged in substance. This table and the current conversion contracts take precedence over their stale guidance.

## 5. External service contracts (read-only source findings)

| Source URL | Purpose / boundary |
|---|---|
| `https://avatars.bighelp.app/v1/avatars.json` and `/v1/avatar-kit.json` | Public avatar discovery/creator kit; bounded cache, hash/license checks, bundled fallback |
| `https://catalog.bighelp.app/v1/catalog.json` | Public agent templates; inert content/variables, explicit apply/create flow |
| `https://logos.loopdy.app/provider-logos/v1/manifest.json` and `/images/` | Public versioned provider logos; retain origin/path/hash policy, never host credentials |
| `https://petdex.dev/api/manifest`, `https://assets.petdex.dev/pets/{slug}/preview.webp` | Third-party pets; safe slug/cache and per-asset rights |
| `https://raw.githubusercontent.com/promptclickrun/bighelp-plugin/main/model-names.json` | Runtime friendly model labels, not a model capability allowlist; source snapshot tied to plugin SHA for audit |
| GitHub `promptclickrun/bighelp-plugin` releases/tags/commits | Exact approved plugin update resolution; not permission to install latest main automatically |
| `https://link.loopdy.app` | Optional notification identity/service in current app; **not the native chat transport** |
| Selected provider HTTPS/WebRTC endpoints | Explicitly chosen provider/account and privacy/billing boundary; never auto-fallback from subscription to paid API key |

These URLs were traced from source; no production delivery, write, account creation, enrollment, or deployment was exercised. Public catalog outages must not block core chat.

## 6. Platform research

Read during this audit:

- [React Native out-of-tree platforms](https://reactnative.dev/docs/out-of-tree-platforms).
- [React Native Windows](https://github.com/microsoft/react-native-windows) and its supported architecture/toolchain guidance.
- [React Native Web](https://github.com/necolas/react-native-web).
- [Listed React Native Skia Linux renderer](https://github.com/react-native-skia/react-native-skia): repository metadata showed last push in June 2023 at audit time. This is not Shopify's drawing library.

These ecosystem pages are live, not an approved dependency lock. RNW plus RN Web/Electron is a recommendation requiring proof and user approval. No packages/toolchains were installed and no platform compatibility was inferred from iOS/Android support alone.

## 7. Imported material and licensing

[upstream-manifest.json](reference/upstream-manifest.json) records **109 imported files**: 39 Markdown contracts, 2 JSON schemas, 67 JSON fixture/manifest files, and the Apache license. Every entry records repository, exact revision/path/URL, original and imported SHA-256, bytes, and transformations.

- Schemas/JSON vectors/license are byte-for-byte imports.
- Imported Markdown has only a reference/provenance banner and pinned Markdown links added; bare code paths/examples still describe upstream.
- Root `AGENTS.md`, `CONTRIBUTING.md`, `SECURITY.md` and PR guidance are **adaptations**, not copies. Apple tooling/release steps were intentionally removed; current native-transport/trust/test/review guidance was retained.
- [NOTICE](../NOTICE) and [LICENSE](../LICENSE) cover attribution. Both upstream license files were compared and match.
- No font/art/video/app binaries, host credentials, deployed service configuration or Cloudflare resource identifiers are intentionally imported. The sealed-alert fixture has explicitly synthetic test keys; do not use them outside tests.
- The disposable reference checkouts/generation scripts are not part of this repository and are removed after verification. No full app/plugin source mirror or submodule is required.

## 8. Evidence still required

This pass does **not** prove: exact Hermes server compatibility; authentic Windows/Linux secret storage/WebRTC/background delivery; released appearance-tool support; native calendar/reminder providers; visual screenshot parity; performance/accessibility on hardware; signed packaging/updates; or every asset's redistribution license.

Those are explicit P0–P9 gates, not hidden follow-up work. See [DECISIONS.md](DECISIONS.md), [implementation plan](IMPLEMENTATION_PLAN.md), and [feature matrix](parity/FEATURE_MATRIX.md). Repository setup and source-contract mapping are complete independently of those future product approvals.
