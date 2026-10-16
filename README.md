# bighelp for Windows and Linux

Private planning and implementation repository for a React Native desktop companion to [Hermes](https://github.com/NousResearch/hermes-agent), targeting the functional and visual behavior of [Bighelp](https://github.com/promptclickrun/bighelp) on macOS.

**Status: connected development preview; full parity is not complete.** The Electron + React Native Web app connects to Hermes with a dashboard or provider access token, creates/resumes chats, persists encrypted drafts/send intents, streams text, and handles approval/clarification requests. Unsigned portable Windows/Linux packaging and platform CI are available. See [execution and evidence](docs/DEVELOPMENT_EXECUTION.md), [connected runtime](docs/evidence/connected-runtime.md), and the [feature matrix](docs/parity/FEATURE_MATRIX.md) for remaining work. Nothing has been signed or released.

## Start here

1. [Full implementation plan](docs/IMPLEMENTATION_PLAN.md) — architecture options, work packages, dependencies, acceptance gates, effort, and open decisions.
2. [Feature parity matrix](docs/parity/FEATURE_MATRIX.md) — what must carry over, what needs a platform replacement, and what is retired.
3. [Hermes API contract](docs/contracts/HERMES_API.md) — authentication, REST, WebSocket RPC, events, and native integrations.
4. [Bighelp plugin contract](docs/contracts/PLUGIN_API.md) — feature negotiation, routes, cards, workflows, voice, and notifications.
5. [State and security contract](docs/contracts/STATE_AND_SECURITY.md) — ownership, recovery, storage, permissions, and desktop trust boundaries.
6. [Visual conversion plan](docs/parity/VISUAL_PARITY.md) — current design tokens, desktop interactions, asset reuse, and mock approval gate.
7. [Decisions requiring approval](docs/DECISIONS.md).
8. [Source audit and provenance](docs/SOURCES.md), [API source index](docs/reference/API_INDEX.md), and [borrowed contracts](docs/upstream/README.md).

## Baseline

Audited on **2026-10-15**:

- Shipping Mac release: **2.4.0 (122)**, tag `mac-v2.4.0-122`, commit `d62a545386fb1b63f8ca33365766a46b3b1bd636`.
- Plugin source: `bb7f9e5a7be74751c9b192a8a878350f714466d6` on `main`.
- Latest published plugin: **v3.12.0**, commit `e093d4b649cc92d1ed49df6c6b969c2cc82b6e7e`. The audited plugin main includes an unreleased appearance-tool addition; do not equate its version string with installed support.

The real Mac app is **`BighelpCatalyst`**, built from `Bighelp/`. `BighelpMac/` is a fixture-only prototype, not the parity target. Older documentation sometimes describes retired behavior; the audit records those discrepancies.

## Approved platform approach

Use **React Native Web inside Electron on both Windows and Linux**, as approved on 2026-10-15. Share TypeScript domain logic and the renderer; keep networking, credentials, and OS capabilities behind finite privileged operations. Initial qualification targets are Windows 11 x64 and Ubuntu 24.04 LTS x64 (Wayland and X11).

No Hermes runtime, model server, account system, or notification cloud will be duplicated here. Chat connects directly to the user's existing authenticated Hermes host. No production service or daily-driver app was modified during this audit.

## Contributing

Read [AGENTS.md](AGENTS.md), [CONTRIBUTING.md](CONTRIBUTING.md), and [SECURITY.md](SECURITY.md).

Use Node 24.22.0 (npm 11.19.1) for the desktop toolchain. Contract tests alone still run on Node 22.23.0 or later.

```sh
npm ci                   # exact lockfile; install scripts stay off (.npmrc)
npm run electron:fetch   # reviewed step: download Electron, verified against its pinned checksums
npm run check            # contract tests, three strict type checks, guarded bundle
npm run desktop:start    # the app, no sample data
npm run desktop:preview  # synthetic sample data (development only)
npm run desktop:package  # unsigned portable package for the current target OS
npm run desktop:smoke -- --fixture-preview   # drive real Electron over DevTools and check the boundaries
```

On a Linux machine that can't run Chromium's OS sandbox, `desktop:smoke` needs `--no-os-sandbox`. Report it when you use it. See [TOOLCHAIN.md](docs/qualification/TOOLCHAIN.md).

Apache-2.0; see [LICENSE](LICENSE) and [NOTICE](NOTICE). The repository is private; that does not remove the obligations attached to borrowed material.
