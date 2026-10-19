# Contributing

Start with [AGENTS.md](AGENTS.md) and the [implementation plan](docs/IMPLEMENTATION_PLAN.md). This repository contains the bighelp desktop app for Windows and Linux (Electron and React Native Web), its protocol contracts and synthetic fixtures, and the planning documents.

## Contracts

- Native Hermes is the only chat path. Optional notifications cannot gate sign-in, host selection, chat, or recovery.
- Preserve the [Hermes API](docs/contracts/HERMES_API.md), [plugin API](docs/contracts/PLUGIN_API.md), and [state/security](docs/contracts/STATE_AND_SECURITY.md) boundaries.
- Chat, composer, cards, appearance, or persistence changes inherit the [accepted chat behavior](docs/upstream/bighelp/CHAT_INTERACTION_CONTRACT.md). Port its behavior, not UIKit itself or its obsolete navigation section.
- No third-party dependencies, production access, backend deployments, or public releases without prior discussion.

## Workflow

1. Agree on the change and its acceptance criteria. Approve architecture and visual mocks before implementation.
2. Use a focused branch and issue after the initial repository bootstrap.
3. Add a failing focused test for a defect or a protocol vector for a new boundary. Use synthetic data.
4. Validate shared contracts and the affected renderer on actual supported OS versions. A shared-renderer test on one OS does not prove the other OS integration.
5. Update documentation and the parity matrix when behavior or support changes.
6. Remove temporary outputs, commit, rebase onto current `main`, and open a non-draft PR.

Contract test commands are in README.md. Desktop build tooling and CI await the dependency/platform proof. Do not copy Apple's `xcodebuild`, XcodeGen, signing, or TestFlight workflow into this project.

## Pull request expectations

Explain what changes for a person using the app, how it was fixed/built, and any effect on credentials, host authority, spending, permissions, storage, or uncertain writes. List the exact checks that ran and remaining gaps. Include the model/harness attribution. The maintainer merges unless otherwise authorized.

For chat changes, cover reading position, tail following, expanded tools, exact Unicode/Markdown, selection, typing/IME/undo, draft retention, stale callbacks, reconnect, and bounded writes. Performance work requires comparable release-mode measurements, not a screenshot or a generic green build. Never weaken limits or drop content to pass.

For UI changes, link approved mocks and light/dark screenshots, record keyboard/screen-reader/scaling coverage, and distinguish fixture data from a disposable real host and physical-machine evidence.

## Sensitive information

Follow [SECURITY.md](SECURITY.md). Never commit tokens, cookies, keys, cloud resource identifiers, real user data, production logs, pairing material, or private administrative endpoints. Use invented examples and `.example` files. Build caches, installers, archives, and recordings are not source.

## Reuse and licensing

Borrowed material is tracked in [docs/SOURCES.md](docs/SOURCES.md) and `docs/reference/upstream-manifest.json`. Preserve Apache-2.0 notices and each asset's own license. Contributions use Apache-2.0. Do not assume SF Pro, SF Symbols, pet art, provider logos, or every remote catalog entry can be redistributed on Windows/Linux.
