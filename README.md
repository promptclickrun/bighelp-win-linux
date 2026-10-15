# bighelp for Windows and Linux

Private planning and implementation repository for a React Native desktop companion to [Hermes](https://github.com/NousResearch/hermes-agent), targeting the functional and visual behavior of [Bighelp](https://github.com/promptclickrun/bighelp) on macOS.

**Status: planning only. No app has been scaffolded, built, or released.** Architecture choices below are proposals awaiting approval.

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

## Proposed platform approach

Share strict TypeScript domain logic, protocol validation, feature stores, and React Native UI. Use **React Native Windows** on Windows and **React Native Web inside Electron** on Linux. The latter is a packaged desktop app with web-rendered controls, not a native Linux React Native renderer. This choice, including the Linux interpretation of “React Native,” needs approval before implementation.

No Hermes runtime, model server, account system, or notification cloud will be duplicated here. Chat connects directly to the user's existing authenticated Hermes host. No production service or daily-driver app was modified during this audit.

## Contributing

Read [AGENTS.md](AGENTS.md), [CONTRIBUTING.md](CONTRIBUTING.md), and [SECURITY.md](SECURITY.md). No runtime install/build/test commands exist yet. Do not invent a successful build or test result for this planning repository.

Apache-2.0; see [LICENSE](LICENSE) and [NOTICE](NOTICE). The repository is private; that does not remove the obligations attached to borrowed material.
