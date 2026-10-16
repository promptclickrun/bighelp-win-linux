# Canonical chats and protected relaunch recovery

Continuation of `docs/DEVELOPMENT_EXECUTION.md`, starting at `930b1d0`. The complete feature matrix remains the product objective. This increment closes concrete gaps in F06/F07 without inventing approval for new function-page layouts.

## Global constraints

- Hermes owns history and execution. Persist a send intent before dispatch. Lost acknowledgements mean **unknown**, not safe to resend.
- Scope state and every callback to host, authenticated principal, profile, stored session, live runtime, and the relevant connection generation. Same-host reconnect is not a host switch.
- Stored credentials belong in the OS secret store, never preferences, browser storage, fixtures, or logs; never return them to a renderer over IPC.
- Use the shipping Catalyst source at `d62a545386fb1b63f8ca33365766a46b3b1bd636` and the disposable Hermes source at `3b2f971133e4e011022ccf33dc6dc1c9050563d8`. No invented wire operations or unrelated session fallback.
- No new dependencies, production hosts, signing, release, or merge. Calendar/reminders remain unavailable. Preserve the approved hybrid navigation; new function bodies still await the existing static pick.

## Task 1: Canonical Bot Chat

Implement a source-backed canonical chat resolver in finite privileged client/contracts modules. Agent-entry actions resolve the canonical Bot Chat, including hidden roots and compaction successors. Ordinary New chat remains a new conversation. Failed or stale resolution must never pick another chat or create an ordinary fallback. Resume/create/title operations must use exact source-backed shapes and `source: bighelp` where applicable. Integrate one finite main/preload action and the existing agent-row click behavior without changing layout. Preserve generation, current profile, navigation, and request cancellation ownership; explicit retry may repeat safe discovery but must not duplicate an uncertain mutation.

Own canonical client/contracts files, finite session codecs if needed, shared desktop API/preload, desktop service integration and tests, and the small App behavior hook. Coordinate with Task 2, which owns only its new cache modules. Add source references and focused behavioral tests for canonical identity, hidden/compacted selection, duplicates/missing support, failure/no fallback, stale completion, and ordinary New chat isolation. Commit only owned files.

## Task 2: Protected display-cache contract

Implement a bounded, versioned, main-only display-cache module using the existing protected repository interface. It stores safe host/profile/session catalog and transcript projections, never credentials or runtime leases, prompts, action authority, or pending send state. Cache keys include the exact host and authenticated principal; profile/session records retain exact routing identities. Bound aggregate bytes and collections to fit the existing repository, explicitly and deterministically trim oldest display history if necessary, and refuse ambiguous or corrupted identity. Reads of newer versions must fail safely without overwriting them. Return copied/immutable validated data. No network, UI, service, API or dependency edits in this task.

Propose a small interface before implementation, then add meaningful tests for roundtrip, principal isolation, corruption/newer versions, deterministic size limits, invalid runtime/credential fields, and stale cache replacement. Coordinate the public API with the controller. Commit owned modules, tests, and evidence.

## Task 3: Cache lifecycle integration

After Tasks 1/2 are reviewed, integrate the display cache into main. Show cached catalogs/history as offline/read-only during cold start and network loss. Never restore `canSend`, running state, live runtime, or open prompts from cache; sending still requires live identity, session ownership and authoritative history. Only publish cached data matching the exact saved host and principal; switching hosts or principals retires it. Persist completed catalog/history projections without turning a cache failure into an unknown send outcome. Preserve drafts/send journals independently. Explicit disconnect must remain disconnected after restart. Use existing shell displays and avoid a new layout.

Test cold relaunch, disconnected startup, delayed old cache reads/writes, principal changes, selection changes, missing/corrupt cache, and no automatic sends. Source/compile/test evidence must distinguish synthetic adapters, disposable host, CI builds and physical-machine qualification.

## Task 4: Review, integration and builds

Review each task for spec compliance and code quality using an exact diff file; review the integrated change for lifecycle and trust-boundary regressions. Run focused tests after fixes, then the complete suite and strict compilation. Rebuild portable packages, run packaged smoke, update PR #10 and verify Windows/Ubuntu CI. Keep exact remaining acceptance gaps and required external inputs visible; do not label the application ready based on this increment alone.

## Task 5: Real OS protection restart probe

Add a disposable qualification script that runs the installed Electron runtime with a fresh user-data directory and the existing protected repository adapter. Persist a deterministic synthetic value using actual `safeStorage`, exit, relaunch with the same isolated directory, read the value, and verify ciphertext does not contain plaintext. Clean up only the generated probe directory. Never load a saved host or user credentials. Do not pass `--no-sandbox` implicitly or add dependencies. Require real OS encryption on Windows CI; report unavailable Linux Secret Service distinctly rather than fabricating qualification. Add the probe to the existing Windows build job, with structured nonsecret output and bounded process deadlines. Keep all probe work in new qualification scripts plus the CI workflow and its evidence; no app/API/service/cache edits. This test qualifies the hosted runner's protection restart behavior, not Windows 11 hardware, user lock/revocation, or power-loss persistence.
