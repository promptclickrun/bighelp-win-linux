# Decisions before implementation

Status: proposals, **not approved choices**. The user requested a comprehensive plan and repository setup, not an application implementation or deployment.

## D1 — What “React Native on Linux” means (blocking)

**Recommend:** native React Native Windows; React Native Web in Electron on Linux. The same RN component model/domain code is shared, but Linux controls render through the web.

Alternatives: RN Web/Electron on both (simpler consistent renderer, less native), or a funded native Linux-renderer effort (higher support risk). The Phase 0 proof must validate RNW text/virtualization/media/accessibility before committing to the split.

**Approval needed:** accept the Linux web-rendered desktop shell, or require genuinely native Linux rendering and re-estimate.

## D2 — Supported platforms (blocking for build qualification)

**Proposed first release:** Windows 11 x64; Ubuntu 24.04 LTS x64, with Wayland and X11 tested. Add one current Fedora/KDE or GNOME lane after the proof. ARM64, Windows 10, Flatpak, and additional distributions are separate qualification commitments, not automatic exclusions forever.

**Approval needed:** required OS versions/architectures/distribution formats. A Windows build needs a real Windows runner; this macOS planning session cannot certify it.

## D3 — Notifications when the app is “closed” (blocking for parity claim)

The current Apple/BuzzKit/APNs setup is not a verified Windows/Linux solution. Existing native live alerts also require active enrollment/recipient keys.

**Recommend:** optional tray/background operation with explicit autostart and lock-safe behavior; keep direct Hermes chat entirely independent. If necessary, add a separately reviewed host-only desktop notification enrollment/subscription capability to the plugin. No new production service deployment without permission.

**Approval needed:** is an explicitly enabled background process acceptable, or must alerts arrive after every process has exited? The latter needs a Windows delivery/activation design and a Linux-specific service strategy; it is not one ready-made cross-platform API.

## D4 — Calendar, reminders, location, and person identity (blocking for those rows)

EventKit/iCloud identity is not portable. Choosing Microsoft Graph, CalDAV, a local store, or another provider changes both data source and consent. Do not pretend a new local reminders list is the same as the user's existing Apple reminders.

**Recommend:** implement appearance and permission/channel framework first; choose named supported calendar/reminder providers explicitly; keep local person identity separate by default. Device-local location only when the platform adapter can meet consent/accuracy requirements.

**Approval needed:** which data sources are mandatory, and which differences can be disclosed in the first parity release? No desktop HealthKit scope is proposed.

## D5 — Visual parity exceptions (before real UI)

**Recommend:** preserve current Noodle/color/spacing/component hierarchy; use Segoe UI on Windows and licensed Noto Sans on Linux, or an approved common licensed face. Map first-party glyphs to SVG; replace only remaining Apple-only icons. Use inexpensive static layered surfaces instead of trying to copy Liquid Glass's implementation.

No continuous loaders/pulse/weather effects under this workspace's motion policy. Brief event-driven transitions and still state indicators need approval as an intentional upstream visual difference.

**Approval needed:** choose among several static mock directions after isolated source screenshot capture. Publish mocks and wait before editing actual UI. No mock/visual approval is claimed in this plan.

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

Start with **D1**. Once the platform interpretation is agreed, approve P0 and resolve its support/security/notification proofs before creating product code. The other decisions stay visible; none is silently assumed settled by a successful repository bootstrap.
