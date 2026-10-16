# Phase 0 evidence and next gates

## Scope

Initial implementation for [issue #1](https://github.com/promptclickrun/bighelp-win-linux/issues/1), 2026-10-15. This is a dependency-free contract proof, not a desktop application or P0 completion.

Approved: React Native Web/Electron on both platforms; Windows 11 x64 and Ubuntu 24.04 LTS x64 (Wayland and X11) first; opt-in tray/background notifications and none after full quit. Other decisions remain open in [DECISIONS.md](DECISIONS.md).

## Implemented

- `packages/domain/chat-contract.ts`: immutable validated owner snapshots, stable authority versus expiring callback leases, finite send transitions, conservative recovery.
- `packages/domain/text-send.ts`: a finite text-only `prompt.submit` builder and one-use asynchronous send operation. It awaits preparation and dispatch-marker commits before transport, checks ownership after both barriers, and conservatively handles lost or mismatched receipts.
- `tests/*.test.mjs`: deterministic synthetic contract tests. No network, credentials, user content, timers, or OS storage.
- `package.json`: `npm test`, no third-party dependencies or install step.

`streaming` means accepted and nonterminal. Unknown receipt status, transport exceptions, wrong RPC IDs, and owner replacement never authorize replay. The exact runtime session ID and profile are sent; no invented idempotency field or generic RPC bridge exists. Refusal and terminal/history verification events are trusted internal facts, not implemented wire decoders. `complete` means reconciliation finished, not that host work succeeded.

### Source traceability

- [State/security §§2–4](contracts/STATE_AND_SECURITY.md): ownership, persist-before-dispatch, unknown outcomes, same-host reconnect.
- [Hermes API frame and method contracts](contracts/HERMES_API.md): JSON-RPC correlation, `prompt.submit`, `streaming`, separate stored/runtime identities.
- [Direct Hermes sessions](upstream/bighelp/DIRECT_HERMES_SESSIONS.md): exact identity and uncertain mutation semantics.
- [API inventory](reference/api-inventory.json): finite `prompt.submit` params.

The dispatch-started durable barrier is a local design derived from the uncertain-send contract. It is not presented as an upstream on-disk schema.

## Evidence classification

**Synthetic/local:** tests run with Node 22.23.0 on the macOS development host. Both suites initially failed because their modules did not exist. A malformed-Unicode regression then failed behaviorally before the validator fix. Final command: `npm test`: **30 passed, 0 failed**. Whitespace check: `git diff --check` passed. Independent Orca code review found an RPC ID byte-bound gap and text-recovery evidence loss; both were fixed with regression tests. Text recovery now retains the exact request and owner.

**Disposable real host:** not exercised. No production hosts or services touched.

**Target OS / physical machine:** not exercised. No Windows or Linux build, signing, packaging, secret-store, accessibility, IME, Wayland/X11, or notification claim.

Node strips TypeScript types to run these tests; it does **not** type-check. A pinned compiler and strict type-check gate remain required before desktop integration.

## Adapter obligations, not proven properties

- `currentOwner` must expose only verified, caught-up, exclusive-submit authority. Auth and socket generations must retire on endpoint rebinding, writer reclaim, and host return. Opaque principal keys must distinguish provider/user identities from dashboard-session authority; they are not tokens.
- `commit` must be durable, owner-namespaced and revision/CAS protected. Test fakes prove call ordering, not crash-safe disk writes, encryption, or transactional isolation.
- The one-use guard is per closure. A repository/session coordinator must prevent recreating a sender for an existing intent, cross-process races, and concurrent independent intents. Recovery must inspect; it must not call `createTextSend` again.
- Transport must validate origin, framing bounds, duplicate critical keys, capabilities and server-request handlers. This module accepts decoded data, not untrusted raw JSON text.
- Original-owner evidence can be persisted after navigation. Publication into the current UI needs a fresh lease check. Returned snapshots are not permission to mutate presentation.
- A rejected receipt is not inferred from arbitrary RPC errors. Real refusal classification and authoritative turn/history reconciliation remain unimplemented.

## Desktop shell (2026-10-16)

The approved hybrid direction runs as an Electron + RNW shell with no host connection: [desktop-shell.md](evidence/desktop-shell.md). The approved dependencies are installed and the first strict type check of all code is green: [TOOLCHAIN.md](qualification/TOOLCHAIN.md). The evidence is from a development host (ARM64, X11 virtual display, OS sandbox unavailable). It is not target-platform evidence.

## Next bounded slices

1. ~~Approve the dependency proposal; add strict compilation~~ (done; see TOOLCHAIN.md). Platform CI for Windows x64 and Ubuntu x64 is still needed.
2. Prove sandboxed Electron main/preload boundaries and fail-closed OS secret storage on both targets. No renderer token access or generic IPC.
3. Implement protected transactional journal and owner registry, then exercise crash injection and duplicate-intent exclusion.
4. Implement bounded RPC framing and socket lifecycle against an authorized disposable Hermes clone.
5. ~~Publish distinct static mocks and obtain a selection~~ (D picked and approved; the shell implements it).

The initial-bootstrap status sentence in AGENTS.md predates this implementation approval. DECISIONS.md records the current approved choices; the remaining repository safety and approval rules still apply.
