# Installed toolchain and the first desktop shell

Status: **approved set installed; one approved package dropped after it failed strict checking.** Approval: Colt, 2026-10-15, chose the [PR 4 dependency proposal](DEPENDENCY_PROPOSAL.md) set and an exact lockfile. This records what was installed, what was rejected and why, and what ran. It is development-host evidence, not Windows/Linux target qualification.

## Installed

| Package | Version | Role |
|---|---|---|
| react / react-dom | 19.3.1 | Renderer |
| react-native-web | 0.21.4 | Shared renderer primitives |
| electron | 44.7.2 | Desktop shell (development dependency; embeds Chromium 152.0.7977.149) |
| typescript | 7.0.2 | `tsc --noEmit` strict gate only |
| esbuild | 0.28.2 | Bundling and TS/JSX transform, no type checking |
| @types/react, @types/react-dom | 19.3.0 | Declarations |
| @types/node | 24.19.2 | Declarations for main/preload and the existing core |

Toolchain: Node **24.22.0** with npm **11.19.1**, kept in an isolated directory outside the repository and the workstation PATH. The tarball's SHA-256 matched the official `SHASUMS256.txt`, and `gpgv` verified that file's signature against the Node release keyring (signer: Richard Lau, key `C82FA3AE1CBEDC6BE46B9360C43CEC45C17AB93C`).

`package-lock.json` is committed: lockfile v3, 91 entries, every one with an `integrity` hash. 47 of those are optional per-platform binaries for esbuild and TypeScript, so this host has 47 packages installed. Declared licenses: MIT 64, Apache-2.0 22, BSD-2-Clause 2, ISC 2, BSD-3-Clause 1. These are package declarations, not a legal review of shipped binaries. `.npmrc` sets `save-exact` and `ignore-scripts`. `npm audit` reports **0 vulnerabilities** for this graph.

### Install scripts

With `ignore-scripts=true`, nothing ran at install time. Two packages need a post-install step, reviewed and run explicitly:

- `electron/install.js` downloads the platform Electron binary through `@electron/get` and verifies it against the `checksums.json` file shipped inside the pinned npm package. Run with `npm run electron:fetch`.
- `esbuild/install.js` checks the platform binary package (`@esbuild/<platform>`) that npm already installed from the lockfile. Run with `npm run esbuild:verify`.

No other package in the graph declares an install script (`npm query` over `install`/`preinstall`/`postinstall`).

## Dropped: `@types/react-native-web@0.19.3` and `react-native@0.88.0`

The proposal said: if the community declarations fail a strict check against RNW 0.21, stop instead of patching around them. They failed.

A strict sample (`View`, `Text`, `TextInput`, `Pressable`, `ScrollView`, `StyleSheet`) produced:

- Wrong component types: `role` was rejected on `View` and `Pressable`, `Pressable` style callbacks lacked `hovered`/`focused`, and `StyleSheet.create` did not exist.
- Errors inside the declaration file itself: `VirtualizedListProps` arity and `ViewStyle`/`TextStyle`/`ImageStyle` incompatibilities.
- Dozens of global conflicts, because React Native's declarations redeclare DOM globals (`FormData`, `Blob`, `AbortSignal`, `URL` members) that the renderer must use from the DOM library.

Those declarations were the only reason `react-native@0.88.0` was in the graph. With it, npm audited **251 packages and reported 9 high-severity advisories** (all in RN's Metro/CLI tooling: `braces`, `micromatch`, `metro`, `metro-config`, `metro-file-map`, `metro-transform-worker`, `@react-native/community-cli-plugin`, `@react-native/virtualized-lists`, `react-native`). npm's only offered fix was a downgrade to RN 0.72. Removing both packages uninstalled **203 packages** and left **0 advisories**. Nothing in the renderer needs RN.

Replacement: `packages/ui/react-native-web.d.ts`, a small hand-maintained declaration of the RNW 0.21.4 API this app uses. Each prop was checked against the RNW source in `node_modules/react-native-web/dist` (`forwardedProps`, `Pressable`, `TextInput`, `ScrollView`, `useColorScheme`, `useWindowDimensions`). It has no `any` and no index signature. Widen it only with a source read or a test. This is a deviation from the approved set; it removes packages and adds none.

## Strict type checking

`npm run typecheck` runs three `tsc --noEmit` projects off `config/tsconfig.base.json`. The base config uses `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`, `erasableSyntaxOnly`, and **`skipLibCheck: false`**.

| Project | Covers | Libraries |
|---|---|---|
| `tsconfig.core.json` | Contracts, domain, Hermes client, platform policy, UI data | ES2024 and Node types, no DOM |
| `tsconfig.desktop.json` | Electron main, preload, shared shell info | ES2024, DOM and Node types (Electron's own declarations reference DOM types) |
| `tsconfig.renderer.json` | UI components, renderer entry | ES2024 and DOM, **no Node types**, so renderer code cannot name `fs`, `process` or `child_process` |

This was the first compile of the PR 2/PR 4 code. It found four places the compiler could not prove safe. All were already guarded at runtime, and the fixes do not change behavior (the existing 89 tests still pass):

- `contracts/rpc.ts`: a scanner read `text[cursor]` without a bound proof; `result` could be `undefined` after `has()`; `encodeServerReply` indexed `[0]` without a check.
- `platform/transport-policy.ts`: destructured IPv4 octets without defaults.

## Build and boundaries

`npm run desktop:build` type-checks, then `scripts/desktop/build.mjs` bundles three outputs with esbuild and **fails the build** if:

- the renderer bundle includes `react-native`, any `node:` module, or anything from `apps/desktop/src/main` or `src/preload`;
- the sandboxed preload requires anything except `electron`;
- the main bundle has an unexpected external.

Renderer bundle (development mode): about 1.6 MB, from React, React DOM, RNW and RNW's own small dependencies.

## What ran (development host)

**Host:** Ubuntu 24.04.4 LTS on **ARM64**, X11 virtual display (Xvnc), Node 24.22.0. Both the architecture and the display stack are off the qualification matrix (Windows 11 x64, Ubuntu 24.04 x64 under Wayland and X11). Nothing below qualifies a target.

- `npm test`: 119 passed, 0 failed (89 existing and 30 new). The same suite also passes on Node 26.7.0. Node 22.23.0 was not available on this host to recheck the floor.
- `npm run typecheck`: all three projects pass with zero errors.
- `npm run desktop:smoke -- --no-os-sandbox --fixture-preview`: real Electron 44.7.2 / Chromium 152.0.7977.149, **27/27 checks passed**. Without sample data, **18/18 passed**. See below for the `--no-os-sandbox` caveat.
- Screenshots (wide light/dark, Settings with Nerd Mode, narrow list and chat) were reviewed. Review found and fixed: a context column collapsed to zero width (`flex: 0` is `flex-basis: 0%` in CSS), an overlapping sample-data badge, and a loader that the app's own deny-all request filter blocked.

### OS sandbox caveat

Chromium's Linux OS sandbox needs either unprivileged user namespaces or a root-owned setuid `chrome-sandbox` helper. This host has neither: AppArmor restricts unprivileged user namespaces and there is no root access. So the live runs used Chromium's `--no-sandbox`, which turns off the **OS-level** process sandbox. The app's own settings still applied: renderer `sandbox: true`, `contextIsolation`, no Node integration, and `app.enableSandbox()`. Chromium refuses to start without `--no-sandbox` here, which is the correct fail-closed behavior.

The Ubuntu 24.04 target has the same AppArmor restriction by default. Packaging must ship either an AppArmor profile for the app or a setuid helper. That is a qualification item for the packaging slice. Do not ship `--no-sandbox`.

## Not done

Packaging and fuses, signing, Windows, x64, Wayland, IME with a real input method, screen readers, secret storage, any host connection, and performance measurement.
