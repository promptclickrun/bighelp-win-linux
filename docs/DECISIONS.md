# Decisions before implementation

Status: implementation authorized on 2026-10-15. D1, the initial D2 qualification matrix, and D3 are approved below. Dependencies, product visuals, providers, packaging, and release choices remain gated.

## D1 — Shared desktop renderer (approved)

**Approved:** React Native Web inside Electron on **both Windows and Linux**. Neither platform uses React Native Windows or native Linux widgets. Share the renderer and domain layer; qualify OS integration separately.

Alternatives not selected: split native Windows/web Linux renderers, or a funded native Linux-renderer effort. The Phase 0 proof must validate text, virtualization, media, and accessibility in the shared renderer on each OS.

The original split-renderer recommendation is superseded. No React Native Windows dependency is required by this choice.

## D2 — Supported platforms (blocking for build qualification)

**Proposed first release:** Windows 11 x64; Ubuntu 24.04 LTS x64, with Wayland and X11 tested. Add one current Fedora/KDE or GNOME lane after the proof. ARM64, Windows 10, Flatpak, and additional distributions are separate qualification commitments, not automatic exclusions forever.

**Approved initial qualification:** Windows 11 x64 and Ubuntu 24.04 LTS x64, including Wayland and X11. Expand after the proof. Distribution formats remain open. A macOS development run cannot certify these targets.

## D3 — Notifications when the app is “closed” (blocking for parity claim)

The current Apple/BuzzKit/APNs setup is not a verified Windows/Linux solution. Existing native live alerts also require active enrollment/recipient keys.

**Recommend:** optional tray/background operation with explicit autostart and lock-safe behavior; keep direct Hermes chat entirely independent. If necessary, add a separately reviewed host-only desktop notification enrollment/subscription capability to the plugin. No new production service deployment without permission.

**Approved:** opt-in tray/background operation; **no alerts after fully quitting**. Closing a window is distinct from quitting. Autostart remains an explicit opt-in. Enrollment and OS delivery still require proof.

## D4 — Calendar, reminders, location, and person identity (blocking for those rows)

EventKit/iCloud identity is not portable. Choosing Microsoft Graph, CalDAV, a local store, or another provider changes both data source and consent. Do not pretend a new local reminders list is the same as the user's existing Apple reminders.

**Recommend:** implement appearance and permission/channel framework first; choose named supported calendar/reminder providers explicitly; keep local person identity separate by default. Device-local location only when the platform adapter can meet consent/accuracy requirements.

**Approval needed:** which data sources are mandatory, and which differences can be disclosed in the first parity release? No desktop HealthKit scope is proposed.

## D5 — Visual parity exceptions (before real UI)

**Recommend:** preserve current Noodle/color/spacing/component hierarchy; use Segoe UI on Windows and licensed Noto Sans on Linux, or an approved common licensed face. Map first-party glyphs to SVG; replace only remaining Apple-only icons. Use inexpensive static layered surfaces instead of trying to copy Liquid Glass's implementation.

No continuous loaders/pulse/weather effects under this workspace's motion policy. Brief event-driven transitions and still state indicators need approval as an intentional upstream visual difference.

**Approval needed:** choose among several static mock directions after isolated source screenshot capture. Publish mocks and wait before editing actual UI.

**Structural direction picked (2026-10-15):** after reviewing A/B/C, Colt chose "the pinned menu … on the bottom like in mockup B" with "the nav rail and separate chat/agent/function list of mockup C". `docs/design/p0-alternatives/d-hybrid.html` (mock D) records that combination. A global rail picks the context list (Chats / Agents / a function's own list). The open agent's Chat/Feed/Ideas/Goals/Files tabs sit below the composer and do not duplicate the rail. There is one Settings, and no Companion pet row. The rail is a deliberate navigation deviation from the shipping sidebar, and it is accepted as part of this pick.

**Still not approved:** D's rendered details (rail order, widths, spacing, bar styling, narrow behaviour), the Workflows/function page bodies, which are static placeholders, and every other parity exception above (fonts, glyphs, surfaces, motion). Full visual parity is not accepted. The mocks use synthetic content and have not been compared with screenshots of the shipping app. Real UI work still waits for refinement review of D.

## D6 — Runtime dependencies and storage (after proof)

**Proposed:** compatible pinned React/RN/RNW stack, bounded runtime validation, transactional protected repositories, native secrets, and vetted Markdown/media/list primitives. Do not choose packages based solely on iOS/Android support. Linux SQLite/key management and RNW WebRTC/editor support are proof gates.

**Approval needed:** exact dependency set and any native module ownership. Do not install toolchains/dependencies during the documentation-only pass.

## D7 — Host and cloud scope

**Assumption:** users already run Hermes; this repo builds the client only. Remote POSIX host capability is sufficient for Windows-client workflows/files/CLI sign-in. We will not make all plugin internals native-Windows-host compatible as part of the UI port.

No live host, Bighelp cloud, signed release, daily-driver data, or Apple deployment changes are authorized by this plan. Companion backend work will be proposed separately with exact blast radius.

## D8 — Upstream baseline and release naming

**Recommend:** freeze Mac 2.4.0 (122) and the recorded plugin source/release for the first plan. Update deliberately with a contract-diff review, not continuous scope expansion. Use new Windows/Linux app identifiers, data directories, and release channels, preserving only required legacy wire names.

**Approval needed:** branding/application IDs, desktop URL scheme, signing publishers, update channel/hosting, and whether to advance the parity baseline during implementation.

## Next conversation

P0 has begun with a dependency-free executable domain contract slice. See [P0 evidence](P0_EVIDENCE.md). Exact dependencies and static product mocks need approval before their implementation. This is not full P0 acceptance.
