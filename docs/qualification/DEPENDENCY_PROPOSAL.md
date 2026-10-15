# Dependency proposal and qualification gates

Status: **approval pending; nothing installed**. Research checkpoint: 2026-10-15 UTC, for [issue #3](https://github.com/promptclickrun/bighelp-win-linux/issues/3), based on merged [PR #2](https://github.com/promptclickrun/bighelp-win-linux/pull/2).

This is a metadata-compatible candidate set, not a tested-compatible desktop stack. Exact package manifests and upstream release records were retrieved. No lockfile, dependency installation, compiler run, Electron build, vulnerability scan, target OS run, or live Hermes connection has occurred. The existing dependency-free tests and the new preflight ran locally on macOS only.

## 1. Proposed approval set

Approve the following as one **bounded clean-install/typecheck/synthetic-shell experiment**, not as production or UI approval:

- Build toolchain: Node **24.22.0** and its bundled npm **11.19.1**, in an isolated development/CI environment. Do not replace the workstation runtime. Keep existing dependency-free tests runnable at the repository's Node **22.23.0** floor.
- Renderer dependencies: `react@19.3.1`, `react-dom@19.3.1`, `react-native-web@0.21.4`.
- Development dependencies: `electron@44.7.2`, `typescript@7.0.2`, `esbuild@0.28.2`, `@types/react@19.3.0`, `@types/react-dom@19.3.0`, `@types/react-native-web@0.19.3`, `@types/node@24.19.2`, `react-native@0.88.0`.
- Tests: existing `node:test` / `node:assert`, supplied by Node. No additional test runner. esbuild transforms/bundles; a separate `tsc --noEmit` gate checks types.
- Store an exact lockfile only after approval, reviewing transitive packages, integrity, licenses, scripts and advisories. No `--force` or `--legacy-peer-deps`; do not hide declaration errors with `skipLibCheck` to manufacture a green proof.

This narrows and revises [the earlier candidate list](../P0_DEPENDENCIES.md), rather than silently amending it: propose esbuild instead of Vite plus its React plugin, and current TypeScript 7.0.2 instead of 5.9.3. Node 24 is a proposed isolated toolchain change, not an approved replacement of the existing Node 22 baseline. Parent approval must resolve these choices before changing the manifest. TS 5.9.3 remains an explicitly researched alternative (Apache-2.0, Node >=14.17, no peers), not an automatic fallback. [N5, N6, N12, D4]

Do not add Expo, Metro as a direct tool, React Native Windows, Babel plugins, UI kits, Markdown/media/list libraries, native database/keyring modules, a schema library, packaging/updater frameworks, or hosted services in this approval. Native React Native's transitive graph does contain Metro/compiler packages; see the type dependency warning below. Privileged WS transport and packaged-fuse/packaging tools from the earlier proposal are **deferred, not rejected or already covered**. Their separate exact approval is needed before their corresponding proof. A Node `WebSocket` global does not establish custom-header/frame-control compatibility with [the Hermes contract](../contracts/HERMES_API.md#3-gateway-websocket-contract).

## 2. Exact metadata ledger

`—` means the versioned manifest does not declare that field. It does not mean universal compatibility. Licenses below are the direct package's declared license, not an audit of its dependency graph or shipped binary. Source links point to the exact registry version. Optional peer status is explicit.

| Component / exact version | License | Declared peers | Declared Node engine | Security/support disposition |
|---|---|---|---|---|
| [react 19.3.1][N1] | MIT | — | `>=0.10.0` | Current stable tag observed; no version-specific security expiry established. React release policy [D5]; audit still required. |
| [react-dom 19.3.1][N2] | MIT | `react: ^19.3.1` | — | Same React policy; keep exact React/DOM pair. Includes `scheduler: ^0.28.0`. |
| [react-native-web 0.21.4][N3] | MIT | `react: ^18.0.0 \|\| ^19.0.0`; `react-dom: ^18.0.0 \|\| ^19.0.0` | — | Current tag observed; no LTS/security-backport window established from reviewed sources. |
| [react-native 0.88.0][N4], development/type source | MIT | `react: ^19.3.0`; optional `@types/react: ^19.1.1` | `^22.13.0 \|\| ^24.3.0 \|\| >= 26.0.0` | Not renderer runtime. Its complete installed development graph still needs security/license review. No security expiry asserted here. |
| [electron 44.7.2][N5] | MIT, with bundled third-party notices to review | — | `>= 22.12.0` (installer/tooling, **not embedded Node**) | Upstream supports latest three stable major lines; 44 was current stable in this lookup. Upgrade within the supported rolling window; no permanent pin or fixed EOL implied. [D1, D2] |
| [typescript 7.0.2][N6] | Apache-2.0 | — | `>=16.20.0` | Current tag observed; platform compiler packages at 7.0.2. No version-specific security maintenance guarantee established. MSRC reporting policy [D6]. |
| [esbuild 0.28.2][N7] | MIT | — | `>=18` | Current tag observed; OS-specific optional binary packages at 0.28.2. No LTS window established; dependency/binary review remains. |
| [@types/react 19.3.0][N8] | MIT | none | — | Development declarations; `csstype: ^3.2.2`. No separate security-support guarantee. |
| [@types/react-dom 19.3.0][N9] | MIT | `@types/react: ^19.3.0` | — | Development declarations; no separate security-support guarantee. |
| [@types/react-native-web 0.19.3][N10] | MIT | none | — | Community declarations for an older RNW version line, not proof of 0.21 API coverage. Declares TS 5.6 baseline. |
| [@types/node 24.19.2][N11] | MIT | none | — | Latest observed 24-line declarations; TS 5.6 baseline; `undici-types: >=7.24.0 <7.24.7`. Not an installed networking client. |
| Node 24.22.0 [R1, R2, R4] | MIT for Node-owned code, bundled third-party licenses | n/a | n/a | Krypton Active LTS at checkpoint; scheduled Maintenance 2026-10-20; EOL 2028-04-30. Schedule can change. |
| [npm 11.19.1][N13], bundled development tool | Artistic-2.0 | — | `^20.17.0 \|\| >=22.9.0` | Bundled version from official Node record; no independent support expiry asserted. Not an application dependency. |
| `node:test`, `node:assert/strict` | Included in Node distribution | n/a | Selected Node | Lifecycle/security follows selected Node, not a separate npm package. |

The registry publishes dependency ranges, not a solved lock graph. Important unpinned transitive edges include RNW's `fbjs`, `styleq`, `@babel/runtime`, `@react-native/normalize-colors`, and Electron's `@electron/get`, extraction helper and `@types/node`. Direct package pins alone do not authorize arbitrary transitive results. [N3, N5]

### Compatibility reasoning and limits

- React 19.3.1 satisfies React DOM's `^19.3.1`, RNW's React/DOM 19 ranges, and RN 0.88.0's `^19.3.0`. The React declaration pair satisfies RN's optional declaration peer and DOM declarations' peer. This is range inspection, not execution. [N1–N4, N8–N10]
- Node 24.22.0 and the present 22.23.0 both satisfy the listed direct-package engines. The selected TypeScript and esbuild packages include target x64 optional binary packages for Windows/Linux. Installation and execution on each target remain mandatory; copying macOS `node_modules` would not qualify them. [N4–N7, N13]
- Node release metadata records 24.22.0 (2026-10-14) with npm 11.19.1. Node 26 was still Current, with LTS scheduled 2026-10-28. Selecting Node 24 avoids adopting a not-yet-LTS build line. Existing Node 22 is Maintenance LTS, scheduled EOL 2027-04-30; this does not imply every older Node 22 patch remains secure. [R1, R2]
- Electron 44.7.2's release record (2026-10-13) embeds **Node 24.21.0**, **Chromium 152.0.7977.149**, V8 **15.2.124.37**, and module ABI **149**. Standalone Node 24.22.0 has ABI **137**. Never substitute the build-host Node version for Electron's embedded runtime, or copy native addons between them without the appropriate build. Official Electron assets list Windows/Linux x64; this is availability, not target acceptance. [R1, R3]
- None of the above establishes “no known vulnerabilities.” No lockfile audit, package tarball/license verification, binary signature/integrity verification or advisories-to-artifact assessment was performed. Current/latest tags and a supported major line are not security clearance. Review the resolved graph and Electron/Chromium fixes at approval and each release. Electron updates are the route for its embedded Chromium/Node fixes. [D1–D3]

### Does RN Web require React Native?

**No, not for the renderer runtime.** RNW 0.21.4 declares only React and React DOM peers and no `react-native` dependency. Its setup documentation supports resolving React Native API imports to RNW. [N3, D7]

The proposed community declaration package is different: `@types/react-native-web@0.19.3` declares ordinary dependencies on `@types/react: *` and `react-native: *`, and its declarations import React Native types. Therefore this particular typed setup brings RN into the development graph. Pin RN 0.88.0 explicitly, validate the resolved tree and reject duplicate incompatible resolutions. Development placement does not prevent npm from downloading RN's substantial native/Metro/compiler dependencies. It does not authorize native renderer tooling or runtime shipping. [N4, N10, D8]

RNW ships no `types`/`typings` entry in the measured manifest. The older community declarations are the main unresolved compatibility risk. The approved experiment must strict-check a minimal RNW import/component/style/type sample plus the real domain layer before calling the tuple compatible. Exclude the sample from product UI and obtain visual selection before UI implementation. If those declarations fail, stop and propose a bounded alternative or different compatible tuple; do not patch around it with `any`, suppress library checking, or install a mobile stack. Prefer direct `react-native-web` imports; if shared code imports `react-native`, the bundler and TS resolver must agree on exact bare-module aliasing, reject native-only/deep imports, and inspect the emitted graph for accidental RN runtime code. [D7, D8, project AGENTS.md]

## 3. Minimal toolchain proof after approval

Proposed steps, **not commands run in this lane**:

1. Use an isolated Node 24.22.0/npm 11.19.1 environment; record official checksum provenance. Install the approved exact set and create/review its lockfile on each target. Review installer scripts and platform binaries before enabling them. Record peer/engine resolution and a full license/advisory inventory.
2. Keep domain, main/utility, preload and renderer typecheck targets separate. Renderer has DOM types and no ambient Node privileges. Strict compilation checks real declarations, imports, owner types and `unknown` boundary validators. Node's type stripping runs syntax; it is not this compiler check. [D9]
3. Use esbuild only for bundling and TS/JSX transformation; explicit browser target for renderer, appropriate Electron main target, and sandbox-compatible bundled preload. Do not turn off sandboxing to load arbitrary preload dependencies. `tsc --noEmit` is a separate required step because esbuild does not check types. [D4, D10]
4. Run the existing `npm test`, preflight, strict compiler, then minimal synthetic-shell build. Record Electron's actual versions in the shell separately from the Node build report. No HMR/dev-server package is necessary for this bounded proof.
5. Later packaging approval must cover unsigned reproducible artifact tooling, packaged fuses and inspection, and platform binaries. Launching a source tree is not a packaged proof. Signing, distribution/update channels and production integration remain separately gated.

## 4. Offline preflight implemented in this lane

From the repository root:

```sh
node scripts/qualification/preflight.mjs
node scripts/qualification/preflight.mjs --require-proposed-toolchain
node scripts/qualification/preflight.mjs --help
npm test
```

The script uses only Node built-ins and does not install, fetch, open sockets, inspect packages, read user files, access credentials/keyrings, run subprocesses or write files. It measures platform, architecture, numeric OS release prefix, Node/Electron/Chromium versions when present, presence of four runtime globals, and only the categorical `XDG_SESSION_TYPE` hint on Linux. It never emits the full environment, hostname, username, home path or custom kernel suffix. Shell redirection to an approved evidence location is the caller's choice; no report artifact is silently persisted.

Exports:

- `collectRuntimeFacts()`: current public runtime facts; no network or mutation. Reading runtime version fields does not load Electron.
- `createPreflightReport(input: unknown)`: validates/copies only known fields into a deterministic schema-v1 report; rejects malformed boundary values without echoing them. It does not mutate input.

CLI: JSON by default; `--help` is informational. Exit **0** means Node meets the existing repository floor and required `AbortController`/`TextDecoder` globals are present. Exit **1** means that local check failed, or the caller requested the proposed standalone Node pin and it did not match. Exit **2** means invalid arguments or facts. `fetch`/`WebSocket` presence is informational and never passes the privileged transport gate. The numerical floor check does not evaluate Node security support or promise compatibility with future majors.

All reports keep `platformAcceptance: false`, `targetIdentity: not-verified`, and all three qualification rows `not-exercised`. A Windows kernel string cannot distinguish qualified Windows 11 editions; a Linux kernel cannot establish Ubuntu 24.04; `XDG_SESSION_TYPE` cannot prove Electron's actual Ozone backend or rule out XWayland. ARM64 and macOS remain outside this initial matrix. Test fixtures describe synthetic environments, not measurements of those targets.

Measured locally: Node **22.23.0**, macOS/darwin **arm64**, numeric OS release **27.0.0**, no Electron/Chromium runtime, four globals present. Ordinary preflight passed; the proposed Node pin did not match. The lane adds **7** focused offline tests covering deterministic/redacted reports, unknown validation, numerical version boundaries, platform non-acceptance, feature checks and CLI exits. Full `npm test`: **37 passed, 0 failed** (including **30** existing domain tests). TypeScript compilation and target execution remain unperformed.

No new streaming fixtures or network adapters were needed by this reporting lane. Existing contract tests still run and retain the real `streaming` receipt semantics: accepted, nonterminal, no automatic resend. [C2]

## 5. Secrets and durable storage: choices requiring proof

### Secrets

First experiment: Electron's built-in safeStorage in a finite privileged adapter, with no extra native keyring dependency. It protects ciphertext using OS facilities; it is not a credential database or an atomic token-rotation transaction by itself. Store wrapped material only in the app-owned, owner-bound repository. Never return tokens or decrypted key material to the renderer. [D11, C1]

- Windows: the pinned Electron docs describe DPAPI, protecting against other users, **not malicious software running as the same user**. Do not call this Credential Manager integration unless separately implemented. Test separate Windows users, profile binding, ACLs, copied ciphertext, corruption and rotation with disposable records. [D11]
- Ubuntu: require an attested approved Secret Service provider. For the synchronous path, check availability after readiness and require `gnome_libsecret`; reject `basic_text`, `unknown` and unapproved backends. `isEncryptionAvailable()` alone is insufficient. Missing/locked/unreachable service, cancelled unlock or D-Bus failure must block persistence, preserving existing ciphertext. Never enable plaintext fallback. Test provider restart, lock/unlock, suspend/resume and failed rotations. [D11, C1]
- Electron 44's pinned docs also expose async encryption, with different provider selection including Secret Service/portal/fallback and key rotation. Do **not** use the synchronous backend selector to attest the asynchronous provider. Qualify that path only with independent provider/fallback proof. Do not choose async solely because its availability boolean is true. If provider attestation or sync responsiveness fails, stop and propose a narrowly scoped adapter for approval. Flatpak/portal packaging is not in the approved initial matrix. [D11]
- Long-lived credentials, cache-wrapping keys and recipient keys remain host/principal scoped; a one-time secret stays transient and write-only. JavaScript cannot guarantee cryptographic zeroization. Explicit nonpersistent sign-in is preferable to insecure persistent fallback. [C1]

### Repository storage

Recommended first proof: a **bounded owner-scoped protected record store**, implemented with Node filesystem/crypto primitives behind finite journal operations, no new package. This is a proposal, not an implemented database. Preserve a single-writer/CAS discipline, authenticated encryption of sensitive bodies with an OS-wrapped key, revision/schema validation, and an independently tested atomic commit protocol. A renamed JSON file alone does not establish transactional durability. Cross-record transactions, many concurrent writers, or large history-query requirements may justify SQLite instead. [C1]

SQLite alternative: investigate the embedded runtime's actual `node:sqlite` API before selecting a native addon. Standalone Node's current docs do not establish Electron binary availability, stability or identical flags; SQLite alone also does not establish encrypted-at-rest storage. A native SQLite or encrypted database module would need separate exact version/license/native-ABI approval and Windows/Linux packaging ownership. No SQLite package is requested here. [D12, R1, R3]

Storage acceptance for either choice: kill during prepared/dispatched/receipt writes; failure before/after flush and replacement; disk full/read-only permissions; concurrent/stale CAS writers; corrupt/truncated ciphertext; schema migration and unsupported newer schema; key rotation interruption; symlink/reparse escape prevention; authority isolation. A failed durable barrier prevents sending. Recovery of dispatched/unknown intent inspects authoritative history and never creates a fresh dispatch permit. Test filesystem semantics and protected files on both real targets, not just memory fakes. Keep disposable caches separate from unresolved journals/drafts and exclude secrets from diagnostics. [C1, C2]

## 6. Initial target qualification matrix

All entries below are **not exercised**. Run on disposable target installations with synthetic data. Real-host tests require a separately authorized disposable Hermes clone and exact revision recording; no production access is implied.

| Gate | Windows 11 x64 | Ubuntu 24.04 x64 Wayland | Ubuntu 24.04 x64 X11 | Required evidence |
|---|---|---|---|---|
| Identity/toolchain | Record edition/build, x64, actual Node/npm | Record `/etc/os-release`, desktop, session, kernel | Same, separate X11 session | Native report plus independently verified target identity; installed lock graph and tool versions |
| Renderer/backend | Chromium/Electron versions, scale/GPU | Prove actual Wayland backend; detect accidental XWayland | Prove actual X11 backend | Packaged artifact hash, launch arguments, backend diagnostics; not environment hint alone |
| Shell/security | Main/preload isolation, fixed packaged origin | Same | Same | Sandbox/context isolation on, Node integration off, CSP/permission/navigation checks, packaged fuse inspection, hostile finite-IPC fixtures |
| Secrets/storage | DPAPI account tests; ACL/reparse/flush/crash | Secret Service fail-closed; permissions/symlink/flush/crash | Repeat separately | Encrypted records with synthetic values, provider/backend identity, fault injection and no-secret renderer/log inspection |
| Input/accessibility | Native IME, selection/undo, keyboard, screen reader | Real IME, keyboard, accessibility tooling | Repeat under X11 | Persistent composer during streaming, long selectable virtualized history, prepend anchor, scaling, focus and accessible names; UI proof after visual pick |
| Media/device | Explicit microphone grant, device switch, playback/WebRTC | PipeWire/portal behavior as applicable | Actual installed audio stack | Physical capture/playback/cancellation/lock tests, bounded temp lifetime; no automatic paid-provider fallback |
| Lifecycle | Close vs opt-in tray vs Full Quit; lock/sleep | Same, desktop tray constraints recorded | Same | Autostart off until consent; no client alerts after Full Quit; stale callbacks retired, remote work not cancelled |
| HTTP/WS/browser auth | Approved adapter, custom headers, redirects, loopback | Same | Same | Controlled endpoint failures, fresh tickets, strict frame bounds/UTF-8, cancelled/stale callback tests; then authorized real-host proof |

These gates derive from [P0](../IMPLEMENTATION_PLAN.md#8-implementation-phases-and-deliverables), [approved D1–D3](../DECISIONS.md), [state/security][C1] and [Hermes API][C2]. They are project acceptance requirements, not promises that upstream libraries implement them for this product. Failure in input, media, accessibility, credentials, journal durability or socket policy blocks claiming P0 acceptance.

Capture each gate's exact OS/desktop/session, artifact SHA-256, source commit, toolchain/runtime versions, synthetic/disposable/physical classification, steps, observed result and remaining failure. No signing/release, update hosting, new cloud service, notification enrollment, calendar provider, ARM64 support or production host qualification is implied by passing an unsigned shell experiment.

## 7. Source index

Versioned npm metadata was retrieved directly; links can be refetched without installing packages. Upstream documentation is live unless its URL pins a revision. Security-support dates are schedule observations, not immutable vendor promises. The direct SPDX labels are declarations, not legal conclusions.

[N1]: https://registry.npmjs.org/react/19.3.1
[N2]: https://registry.npmjs.org/react-dom/19.3.1
[N3]: https://registry.npmjs.org/react-native-web/0.21.4
[N4]: https://registry.npmjs.org/react-native/0.88.0
[N5]: https://registry.npmjs.org/electron/44.7.2
[N6]: https://registry.npmjs.org/typescript/7.0.2
[N7]: https://registry.npmjs.org/esbuild/0.28.2
[N8]: https://registry.npmjs.org/@types/react/19.3.0
[N9]: https://registry.npmjs.org/@types/react-dom/19.3.0
[N10]: https://registry.npmjs.org/@types/react-native-web/0.19.3
[N11]: https://registry.npmjs.org/@types/node/24.19.2
[N12]: https://registry.npmjs.org/typescript/5.9.3
[N13]: https://registry.npmjs.org/npm/11.19.1

- R1: [Node release records](https://nodejs.org/dist/index.json).
- R2: [Node release schedule](https://github.com/nodejs/Release/blob/main/schedule.json), [release lifecycle](https://nodejs.org/en/about/previous-releases).
- R3: [Electron release records](https://releases.electronjs.org/releases.json).
- R4: [Node 24.22.0 license and bundled notices](https://github.com/nodejs/node/blob/v24.22.0/LICENSE).
- D1: [Electron support policy](https://www.electronjs.org/docs/latest/tutorial/electron-versioning).
- D2: [Electron release timeline](https://www.electronjs.org/docs/latest/tutorial/electron-timelines).
- D3: [Electron security checklist](https://www.electronjs.org/docs/latest/tutorial/security).
- D4: [esbuild TypeScript transformation caveats](https://esbuild.github.io/content-types/#typescript).
- D5: [React versions/support](https://react.dev/versions).
- D6: [TypeScript security policy](https://github.com/microsoft/TypeScript/blob/main/SECURITY.md).
- D7: [RN Web setup](https://necolas.github.io/react-native-web/docs/setup/).
- D8: [Community RNW declaration source](https://github.com/DefinitelyTyped/DefinitelyTyped/blob/master/types/react-native-web/index.d.ts). Live source confirms the import pattern; the exact dependency declaration is N10.
- D9: [Node TypeScript support](https://nodejs.org/api/typescript.html#type-stripping); the existing project evidence also explicitly distinguishes type stripping from checking.
- D10: [Electron preload ESM/sandbox constraints](https://www.electronjs.org/docs/latest/tutorial/esm).
- D11: [Electron 44.7.2 safeStorage documentation](https://github.com/electron/electron/blob/v44.7.2/docs/api/safe-storage.md).
- D12: [Node SQLite API](https://nodejs.org/api/sqlite.html); inspect selected Electron runtime separately.

[C1]: ../contracts/STATE_AND_SECURITY.md
[C2]: ../contracts/HERMES_API.md
