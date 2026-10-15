# Borrowed upstream contracts

These are **pinned reference documents**, not local build, deployment, or agent instructions. Read [source corrections](../SOURCES.md) before applying them. Source authority is Mac Catalyst 2.4.0 (122) and the recorded plugin revision; older Apple/Link/navigation prose is not a requirement to recreate retired features.

Each file carries its exact upstream link. [The manifest](../reference/upstream-manifest.json) records original/imported hashes and the only transformations: a provenance banner and Markdown links pinned to the audited revisions. No substantive contract text was silently rewritten.

## App behavior and design

| Contract | Why retained |
|---|---|
| [DESIGN](bighelp/DESIGN.md) | Current product layout/identity and Mac interactions |
| [CHAT_INTERACTION_CONTRACT](bighelp/CHAT_INTERACTION_CONTRACT.md) | Accepted chat/composer/scroll/performance guarantees; ignore retired navigation |
| [NATIVE_TRANSPORT](bighelp/NATIVE_TRANSPORT.md) | Native-only production chat and optional-notification boundary |
| [HOST_ACCESS](bighelp/HOST_ACCESS.md) | Authentication, proxy and exact-origin policy |
| [DIRECT_HERMES_SESSIONS](bighelp/DIRECT_HERMES_SESSIONS.md) | Durable/live session distinction and continuation |
| [CACHE_FIRST_SESSIONS](bighelp/CACHE_FIRST_SESSIONS.md) | Owner-scoped cached navigation |
| [BACKGROUND_CHAT_CONTINUITY](bighelp/BACKGROUND_CHAT_CONTINUITY.md) | Execution continues independently of visible views |
| [IDLE_STARTUP_RELIABILITY](bighelp/IDLE_STARTUP_RELIABILITY.md) | Bounded startup/history catch-up |
| [LONG_SESSION_PERFORMANCE](bighelp/LONG_SESSION_PERFORMANCE.md) | Long-history workload and structural rendering requirements |
| [CHAT_PERFORMANCE_VALIDATION](bighelp/CHAT_PERFORMANCE_VALIDATION.md) | Measurable source scenarios; Apple commands are reference only |
| [HERMES_BOT_MODE](bighelp/HERMES_BOT_MODE.md) | Hosted group/log/ownership behavior |
| [BIGHELP_CARDS](bighelp/BIGHELP_CARDS.md) | Declarative card presentation and trust boundary |
| [WORKSPACE_MANAGEMENT](bighelp/WORKSPACE_MANAGEMENT.md) | Typed host feature boundaries; see current Git corrections |
| [DIRECT_STREAMING_AND_LIVE_VOICE](bighelp/DIRECT_STREAMING_AND_LIVE_VOICE.md) | Direct execution vs voice/media ownership; see current host-STT corrections |
| [IPHONE_DEVICE_TOOLS](bighelp/IPHONE_DEVICE_TOOLS.md) | Device permissions/mutation recovery; not a desktop OS implementation |
| [TEMPLATE_VARIABLES](bighelp/TEMPLATE_VARIABLES.md) | Literal bounded template filling |
| [ARCHITECTURE](bighelp/ARCHITECTURE.md) | Historical broader architecture; source findings override stale statements |
| [Wiki v1](bighelp/wiki-v1.md) | Retained service schema; no restoration of retired Wiki navigation |

## Host plugin contracts

- [Native context/workspace](plugin/NATIVE_WORKSPACE_API.md), [Project Git](plugin/NATIVE_PROJECT_GIT.md), [Workspace Files](plugin/WORKSPACE_FILES.md), [Apps/Artifacts/Media](plugin/APPS_ARTIFACTS_AND_MEDIA.md).
- [Cards](plugin/CARDS.md), [Agent attachments](plugin/AGENT_ATTACHMENTS.md), [Feed/Ideas/Goals](plugin/AGENT_BOARD.md), [Template tools](plugin/TEMPLATE_TOOLS.md), [People](plugin/PEOPLE.md).
- [Workflows](plugin/WORKFLOWS.md), [Dev Factory](plugin/DEV_FACTORY.md), [Room activity](plugin/NATIVE_ROOM_ACTIVITY.md).
- [Voice](plugin/LIVE_VOICE.md), [Device tools](plugin/IPHONE_DEVICE_TOOLS.md), [Notifications](plugin/NOTIFICATIONS.md).
- [Provider usage](plugin/PROVIDER_USAGE.md), [Usage activity](plugin/USAGE_ACTIVITY.md), [Provider sign-in](plugin/PROVIDER_SIGN_IN.md), [Context usage](plugin/CONTEXT_USAGE.md).
- [Native Wiki](plugin/NATIVE_WIKI.md) (compatibility only), [Security/privacy](plugin/SECURITY_AND_PRIVACY.md).

## Portable schemas and vectors

See [reference fixtures](../reference/fixtures/README.md) and the [API index](../reference/API_INDEX.md). These are source contracts for future tests, not evidence that a desktop app has passed them. Byte preservation is especially important for canonical hashes and cryptographic vectors.

Original agent/contributor policies were studied and **adapted into the repository root** rather than copied as nested `AGENTS.md` instructions. Local project policy always controls production access, approvals, cleanup, and releases.
