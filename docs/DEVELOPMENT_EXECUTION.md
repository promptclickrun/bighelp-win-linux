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
- Use the parallel-agent workflow only for independent file scopes or read-only protocol research. All integration and shared-interface changes are coordinated here.

## Interface ownership

| Work | Produces | Consumes / compatibility check |
|---|---|---|
| Protected repository | `packages/platform/protected-repository.ts`; encrypted revisioned values | Main-process service only; no renderer import |
| Protocol research | External scratch report, exact source references | Existing `rpc`, `connection`, and transport policy; no inferred endpoints |
| Desktop service | Finite shared IPC contracts and validated service | Protected repository and finite host client; no generic operation bridge |
| UI integration | Existing hybrid D components with service actions | Shared safe snapshots only; fixture data stays explicit |
| Packaging | Build/CI scripts, portable unsigned artifacts | Existing bundle boundary checks and sandbox policy |

All stages require focused behavioral tests and strict compilation. Evidence and open requirements are updated as results become available.
