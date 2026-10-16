# Connected desktop runtime evidence

Date: 2026-10-16. Tracked by [issue #9](https://github.com/promptclickrun/bighelp-win-linux/issues/9). This is a connected development preview, not full Windows/Linux Bighelp parity.

## Implemented

The privileged service connects to a selected exact-origin Hermes host using a dashboard token or provider access token. Tokens are entered once and never returned through IPC. Electron safeStorage protects repository contents and refuses unavailable encryption or Linux plaintext fallback. Renderer operations are finite and validated again in main; only the packaged main frame may invoke them. Direct renderer networking remains blocked by CSP and session policy.

Profiles and saved sessions come from the host. Ordinary New chat uses `source: bighelp`; resume adopts the host's runtime and durable IDs. Pending supported interactive requests are restored from bounded `open_requests`. Approval choices and single/batch clarification answers are explicit, request-bound, and canceled with their lease. Other secure request types return an explicit unsupported error, never a blank successful response.

Text sending uses the existing persist-before-dispatch contract. A failed persistence barrier sends nothing. Once dispatch may have occurred, receipt/persistence loss blocks further sends pending reconciliation. No automatic resend exists. The encrypted per-profile/session journal retains each unresolved intent by ID, so delayed receipts from retired connections cannot overwrite newer sends. It is bounded to 64 unresolved entries and the repository byte limit; exhaustion refuses new sends before dispatch. A known accepted intent completes only after a live turn bookend and authoritative history. Unknown/recovered intents are never promoted just because history was read. Same-session history requests are versioned, message segments do not finish turns, and a fast turn bookend cannot leave the UI stuck running. A completed send clears only the exact durable draft revision it consumed. Host and selection generations retire stale callbacks. Monotonic snapshot revisions prevent late IPC results from replacing newer renderer state.

The approved hybrid shell now has host setup, real agent/chat catalogs, ordinary chat creation, send/stop, drafts, and interactive requests. Static fixture preview remains separate and is eliminated from production renderer bundles. Unsupported feature pages remain visibly unavailable.

The finite desktop API also exposes validated read-only Projects, usage, schedules and text-only Feed/Ideas/Goals snapshots. Plugin reads verify context identity, advertised support, no-store and exact ETag/request-ID correlation. Page bodies await the required static design pick; this is backend integration, not completed feature UI. See [workspace read evidence](workspace-client.md).

## Evidence types

**Synthetic/local:** 227 tests passed on Node 24.19.0 / Debian 13 x64; strict compilation of core, main/preload and renderer passed; boundary/lifecycle, actual temporary-file persistence, local HTTP, and real-wire WebSocket tests. Production bundling passed. `ws@8.22.0` and `@types/ws@8.18.2` were explicitly approved. Optional native ws addons are excluded. Dependency audit reported zero vulnerabilities for production dependencies.

**Disposable real host:** NousResearch/hermes-agent `3b2f971133e4e011022ccf33dc6dc1c9050563d8`, isolated checkout and homes, Python 3.14.8, `HERMES_DISABLE_LAZY_INSTALLS=1`. The committed `scripts/qualification/hermes-smoke.mjs` requires a loopback URL and verifies there are no configured model providers before submitting a synthetic prompt. It exercises dashboard auth, profiles, create, encrypted draft barriers, `streaming` admission, asynchronous provider-free error, `session.info` bookend, authoritative history, disconnect and stored-session resume. Encryption in this test is an explicitly injected synthetic adapter; it does not qualify an OS key store. Fourteen upstream server-request/approval tests also passed. No successful model execution, provider OAuth, plugin feature or real tool-approval interaction is claimed.

During initial host setup, the first environment filter missed the inherited `GH_TOKEN` variable. That process was stopped and replaced with an explicit allowlist and separate OS home. Local logs contained no outbound provider endpoint matches, but no network trace was captured, so absence of initial outbound activity could not be proven. The final smoke used the corrected environment and independently verified an empty model-provider list.

**Desktop runtime:** actual Electron 44.7.2 / Chromium 152 under headless Ozone. The final packaged Linux smoke passed 20/20 with the default OS sandbox enabled; no `--no-sandbox`, permission or ownership changes were needed. Earlier development/fixture runs explicitly disabled the OS sandbox, and are separate evidence (20 connected-shell checks and 28 fixture checks passed). Renderer isolation, denied networking/navigation, finite preload, keyboard navigation and synthetic input were checked. A successful sandboxed headless launch is not Wayland/X11, IME, screen-reader, kernel security or physical-hardware qualification. Normal application and packaging scripts do not add `--no-sandbox`.

**Packages:** unsigned Linux x64 portable archive, independently verified SHA-256 manifest and archive checksum, production bundle boundaries. CI is configured to build Windows and Ubuntu and run packaged smoke checks; execution results are recorded separately. Windows Server CI does not qualify Windows 11 hardware. See [packaging evidence](packaging.md).

## Remaining acceptance work

Full parity still requires canonical Bot Chat resolution; browser/password sign-in and refresh/proxy UX; complete replay/cache/history and richer transcript projection; attachments/cards/forms; everyday workspace writes; workflows/Kanban/IDE; host administration/connectors/vault; voice/Bot Screen; tray, notifications and device tools; accessibility/performance; and signed installation/update qualification. Calendar/reminder access is explicitly unavailable by the user's current choice.

POSIX repository metadata is directory-synced before commit success. Windows atomic replacement/file syncing is implemented but power-loss metadata durability is not qualified. Real OS key-store unlock/revocation and physical-machine tests remain required. No production host/service, release, signing identity, update channel or merge was changed.
