# Development build qualification — 2026-10-16

These are unsigned Windows/Linux development builds. They do not complete the [57-row parity scope](../parity/FEATURE_MATRIX.md) or qualify a release. The approved device calendar/reminder exception remains unavailable and is not advertised as a capability.

## Integrated implementation and review

The connected preview now includes [canonical Bot Chat](canonical-chat.md), [bounded protected display caching](display-cache.md), [offline recovery](chat-recovery.md), [draft preservation during intentional navigation](draft-navigation.md), and [connection retirement at the request-ID budget](gateway-lifetime.md). Main-process authority, durable send barriers and unknown-outcome rules continue to apply. Cached content never restores send or mutation authority.

The whole-branch review found three P2 defects: unbounded queued/in-memory cache projections, unsaved debounce text lost during navigation, and missing complete bundled dependency licenses. Commits `0c3b210`, `d0b2305` and `c877ee2` resolve them. Independent scoped re-review approved all three with **88 focused tests passing** and no further actionable findings. The rebuilt package contains complete notices and provenance for all 15 bundled npm package instances, including the explicitly documented normalize-colors license reconstruction in [packaging evidence](packaging.md).

## Local verification at c877ee2

- `npm test`: **314 passed**, zero failed or skipped.
- `npm run typecheck`: all three strict TypeScript projects passed.
- `npm run desktop:package`: production Linux x64 package built with Electron 44.7.2 / Chromium 152.0.7977.149; fixtures excluded.
- Independent SHA256 verification: **82 package files** and the archive passed. Local archive SHA256: `bfd0e075c59c9ee20e4fa200fb5e8d3bdf8cda96ace8d4e0d3ae824a99df2fad`. This identifies the local archive, not a byte-identical CI archive.
- `node scripts/desktop/smoke.mjs --headless --executable artifacts/bighelp-development-linux-x64/electron`: **20 passed**, zero failed, **OS sandbox enabled**. No sandbox permission or ownership changes were made for this local run.

## Disposable real Hermes

The integrated qualification script passed again at `c877ee2` against disposable Hermes `3b2f971133e4e011022ccf33dc6dc1c9050563d8`. It observed one profile and 41 updates, read Projects/usage/scheduled catalogs, resolved canonical Bot Chat twice to the same saved identity, and created a distinct ordinary chat. Protected draft/send barriers, the expected provider-free error and authoritative history reconciliation passed.

After service and repository shutdown/reconstruction, a rejected transport restored exact saved history read-only. Offline sends and canonical lookup were refused. A second reconstruction after explicit disconnect made **zero automatic connection attempts**. This uses a synthetic AES-GCM adapter and service/repository reconstruction, not an actual Electron app process restart or successful AI turn. The separately tested OS-process restart probe is described below.

The host ran only on loopback in an isolated checkout and home with `HERMES_DISABLE_LAZY_INSTALLS=1`. An explicit child-environment allowlist was used. The script independently checked that no model provider was configured before connection and immediately before submission. The host process was stopped after the test. No production host or gateway restart was used.

During the initial disposable-host setup, the earlier environment filter missed inherited `GH_TOKEN`. That process was stopped and replaced with the allowlist and isolated OS home. Local logs had no outbound provider endpoint matches, but no network trace was captured. This limitation remains recorded in [connected runtime evidence](connected-runtime.md); later provider-free checks do not erase the initial uncertainty.

## Hosted OS evidence and limits

The [protected-storage restart probe](protected-storage-restart.md) passed on Windows Server 2022 using actual Electron safeStorage / Windows DPAPI: separate-process encrypted write/read, plaintext exclusion, unchanged ciphertext after read, and temporary-data cleanup. Ubuntu reached actual safeStorage with the sandbox enabled but reported `unavailable` / `basic_text`; the application correctly refuses unprotected persistence. This is not successful Linux Secret Service qualification.

[Native CI run 38869708817](https://github.com/promptclickrun/bighelp-win-linux/actions/runs/38869708817) at `7f1b322352df3b945e59baa814ab60c3f90fec1f` passed both jobs; the [pull-request run](https://github.com/promptclickrun/bighelp-win-linux/actions/runs/38869716200) also passed. Both jobs passed all strict compiler projects, production bundling, native portable packaging, the ten protection-harness tests and **20 sandbox-enabled packaged smoke checks**.

| Hosted runner | Application tests | Actual OS protection | Download |
|---|---|---|---|
| Ubuntu 24.04 x64 | 315 passed, zero failed/skipped | Unavailable / basic_text, cleanup removed | [Linux development artifact](https://github.com/promptclickrun/bighelp-win-linux/actions/runs/38869708817/artifacts/12032229802) |
| Windows Server 2022 x64 | 309 passed, zero failed; six POSIX/symlink-specific skips | DPAPI write/restart/read passed; all three checks true; cleanup removed | [Windows development artifact](https://github.com/promptclickrun/bighelp-win-linux/actions/runs/38869708817/artifacts/12032294858) |

Downloads require repository access and expire after 14 days. Each contains an unsigned portable archive and SHA256 file. The executable is still named `electron` or `electron.exe`; these are not signed installers.

The preceding `c877ee2` CI run failed only the 14 Windows draft-navigation harness tests: POSIX-only path matching left actual child components in the synthetic hook harness. Test-only fix `7f1b322` handles both separators and adds a direct esbuild Windows-path regression. All 14 behavior tests remain active on both OSes. Independent scoped re-review passed 15 tests and reported no findings. The successful runs above include that correction. This document is recorded in a later documentation-only commit; earlier historical evidence remains labeled by its tested commit.

## Work still required

Function-page implementation awaits a pick among the [static alternatives](../design/function-alternatives/index.html): A list/detail (recommended), B compact cards, or C table/inspector. [AGENTS.md](../../AGENTS.md) explicitly requires a pick before non-trivial visual/layout/copy work. The html-communication publishing skill was unavailable, and organization browser policy blocked local-HTML screenshots; only local HTML artifacts are provided.

The feature matrix still has incomplete requirements, including richer chat/media/cards, workspace writes, workflows/Kanban/IDE, host administration, voice and notifications. Windows 11 hardware, Linux Wayland/X11 sessions and an available Secret Service, keyboard/IME/accessibility/performance, successful AI/tool execution and a live capable plugin host remain unqualified. Signing, installer/update delivery and release require their own inputs and authorization. None of these are implied by passing synthetic tests, hosted CI or portable package assembly.
