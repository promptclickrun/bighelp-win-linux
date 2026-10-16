# Windows and Linux development execution

Date: 2026-10-16. Baseline: `f0f9929`. User objective: complete the Windows and Linux app implementation, testing, and builds. Real-host testing is authorized against a disposable local Hermes checkout only.

## Design and constraints

Continue the approved shared Electron / React Native Web architecture and hybrid D navigation. Hermes remains the execution and history authority. Implement finite, validated desktop operations in the main process; never expose host credentials, arbitrary URLs, RPC methods, files, or shell access to the renderer. Durable send intent precedes dispatch; uncertain outcomes never trigger automatic replay. Use existing pinned dependencies and Node/Electron platform APIs where possible.

The current shell is not a completed application. The 57-row feature matrix remains the acceptance scope. Each increment must record actual evidence; synthetic tests, disposable-host tests, packaged builds, and physical-machine tests are distinct. Unsigned development packaging does not authorize signing, publishing, merging, or production changes.

## Execution order

1. Establish the existing test and strict compilation baseline. Verify source-backed protocol shapes against the pinned shipping app and an isolated Hermes checkout.
2. Protected persistence: encrypted atomic repositories, revision conflict detection, bounded data, fail-closed Linux key-store policy, and crash/reopen tests. Main-process only.
3. Privileged host transport and desktop service: finite IPC, validated sender, exact-origin HTTP/WebSocket, host identity, agent/session catalog, session creation/resume, prompt handlers, durable text send, streamed/history reconciliation, disconnect and stale callback fencing.
4. Wire those operations into the approved shell: host setup, truthful connection state, real catalogs, chat send/stop and prompt decisions, protected drafts/settings. Keep fixture preview explicit.
5. Windows/Linux build automation: reproducible production bundles, unsigned packaged development artifacts, checksum manifests, platform CI, packaged smoke checks. No additional dependency or distribution-format commitment is required to create portable development builds.
6. Expand the remaining feature families using source-backed finite clients and capability gates; retain row-level acceptance evidence. Device providers, signing identity, update hosting, hardware qualification, and backend capability gaps need concrete external inputs and cannot be invented.
7. Review trust boundaries, run all available tests/builds and disposable-host checks, commit logical changes, and open a reviewable PR. Record any unmet acceptance requirement explicitly.

## Progress and decisions

- Initial checkout has a locked shell and pure protocol/send contracts, no connected service, storage adapter, platform CI, or packages.
- Development worktree: `/workspace/bighelp-development`, branch `feat/desktop-implementation`.
- Existing D1/D2/D3/D5/D6 decisions govern architecture, platform scope, background behavior, visual direction, and dependency versions. The user's implementation instruction authorizes development within those decisions.
- Use Electron `safeStorage` as the existing platform facility for encrypted persistence; reject unavailable protection and Linux `basic_text`. This adds no dependency. Actual OS key-store qualification remains separate from injected-adapter tests.
- Use sequential implementation tasks and independent scoped reviews for shared UI and interface changes; coordinate integration and final qualification here.
- User approved `ws@8.22.0` and `@types/ws@8.18.2` on 2026-10-16. The transport uses bounded `ws` framing; no custom WebSocket parser is shipped.
- User chose to leave device calendar/reminder access unavailable for now. F55 is an explicit preview scope exception, not a simulated replacement for existing data stores.

## Current evidence

- The approved A read pages at `007f5e5` passed 364 application tests, all three strict compiler projects, production Linux packaging, 82 package-file checksums plus the archive checksum, and 20 sandbox-enabled packaged smoke checks. New renderer interaction and native CI results are recorded separately in [function-page evidence](evidence/function-pages.md).

- Protected encrypted repositories, finite session/interactive prompt codecs, HTTP/WS gateway adapters, finite IPC, connected host/chat UI, and unsigned portable packaging are implemented.
- At `c877ee2`, 314 synthetic/local tests, all three strict TypeScript projects and production packaging passed. Production bundles exclude fixture data and renderer imports of privileged modules. [Integrated qualification](evidence/development-build-qualification.md) records exact commits, subsequent CI results and limits.
- Disposable real Hermes `3b2f971133e4e011022ccf33dc6dc1c9050563d8`: dashboard auth, profile discovery, canonical Bot Chat identity, distinct ordinary chat, draft/send barriers, expected provider-free error, authoritative history, saved-session resume and offline repository reconstruction passed. Explicit disconnect made zero automatic connection attempts after reconstruction. No successful model turn or actual Electron app restart is claimed by this synthetic-encryption test.
- Linux x64 unsigned portable archive produced; all 82 package-file checksums and the archive checksum verified. Packaged headless Electron smoke passed 20/20 with the OS sandbox enabled. Windows CI separately passed actual safeStorage/DPAPI encrypted write and read across two processes. Linux protection remained unavailable/basic_text and fails closed. Target Windows 11/Ubuntu Wayland/X11, available Linux Secret Service and lock/revocation behavior remain qualification requirements.
- Source and security review found and fixed parent-directory durability, post-dispatch persistence failure, stale history overwrite, fast terminal/receipt ordering, stale startup, and newer-draft preservation issues. Pending prompts restored from validated `open_requests` after resume.
- The user selected A list/detail on 2026-10-16. [Read-only function pages](evidence/function-pages.md) now expose Projects, Scheduled and Usage with explicit profile/search/refresh controls and the existing agent Feed/Ideas/Goals tabs with inert selectable details. Reads remain scoped to the exact generation/profile/page/period; drafts survive board navigation. Files, workspace writes and the other feature families remain separate requirements. The static alternatives remain historical local design artifacts.
- Canonical resolution and protected offline display recovery are implemented. Final whole-branch review also fixed cache memory retention, intentional-navigation draft loss and incomplete dependency notices; independent re-review approved the fixes with 88 focused tests passing. Windows CI exposed a test-only path-separator issue, corrected without skipping the 14 draft behavior tests.
- [PR #10](https://github.com/promptclickrun/bighelp-win-linux/pull/10) is open. Native CI at `7f1b322` passed: Ubuntu 315 tests, Windows 309 tests with six POSIX/symlink skips, all strict compiler projects, native packaging and 20 sandboxed package checks per OS. [Integrated qualification](evidence/development-build-qualification.md) links CI and artifacts. The disposable Hermes process was stopped after verification. Product parity and physical-machine qualification remain unfinished.

## Interface ownership

| Work | Produces | Consumes / compatibility check |
|---|---|---|
| Protected repository | `packages/platform/protected-repository.ts`; encrypted revisioned values | Main-process service only; no renderer import |
| Protocol research | External scratch report, exact source references | Existing `rpc`, `connection`, and transport policy; no inferred endpoints |
| Desktop service | Finite shared IPC contracts and validated service | Protected repository and finite host client; no generic operation bridge |
| UI integration | Existing hybrid D components with service actions | Shared safe snapshots only; fixture data stays explicit |
| Packaging | Build/CI scripts, portable unsigned artifacts | Existing bundle boundary checks and sandbox policy |

All stages require focused behavioral tests and strict compilation. Evidence and open requirements are updated as results become available.
