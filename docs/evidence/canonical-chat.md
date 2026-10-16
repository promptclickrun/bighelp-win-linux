# Canonical Bot Chat — source and verification

Implementation: `9ad74327895e542d0a204cd6d946ea2d54cfb1d0`. Date: 2026-10-16.

Agent-row entry resolves the host’s canonical **Bot Chat**. Ordinary **New chat** creates an ordinary session. Discovery/resume failures never select a different session or use an ordinary fallback.

The privileged resolver reads the selected profile’s `canonical_session`, or the exact `session.list {profile,title:"Bot Chat",include_hidden:true,limit:200}` registry. It resumes the registry root with `source:"bighelp"`; Hermes supplies the durable compression successor and live runtime. Duplicate results and mismatched authority fail closed. Before a first creation, a second registry lookup catches another client’s winner.

Canonical creation uses `title:"Bot Chat"`, `hidden:true`, `follow_profile_config:true`, `source:"bighelp"` and `close_on_disconnect:false`. Title acknowledgement and registry readback precede publication. Title error 4022 follows only the source’s registry-winner/exact-title-resume path; 4007 settles absent title ownership. Best-effort cleanup targets only this resolver’s acknowledged empty losing creation.

Encrypted creation state is scoped by stable host, authenticated principal and profile. Create/title barriers are saved before dispatch. Uncertain mutations are never replayed; explicit entry can rediscover a committed canonical result. Missing remembered roots require exact detail confirmation of deliberate archive/rename before replacement. Missing, mismatched, malformed or unavailable detail never authorizes creation.

The finite preload operations are `canonicalChat(generation,profile,requestId)` and `cancelNavigation(initiatingGeneration,requestId)`. Ownership checks fence host/profile/connection and local navigation generations before and after awaits. Cancellation identifies both the initiating generation and request before a new snapshot reaches the renderer. Late cancellation cannot retire a newer navigation, including reuse of an older request ID, and leaving a settled chat does not discard its runtime lease. No remote execution is stopped by navigation.

Review correction: request deduplication retains at most 4,096 IDs for only the initiating generation that can still supersede an active canonical navigation. Settlement, cancellation, connection retirement, or successful admission from another generation retires that set. Ordinary/saved-chat supersession also retires it because older initiating generations can no longer enter. Failed admission preserves the active generation's tombstones. This removes the previous lifetime limit that rejected entry 4,097 even after reconnect.

## Pinned source

Apple: [Bighelp d62a545386fb1b63f8ca33365766a46b3b1bd636](https://github.com/promptclickrun/bighelp/tree/d62a545386fb1b63f8ca33365766a46b3b1bd636), shipping shared Catalyst composition:

- `Bighelp/Hermes/DirectHermesSessionCatalogClient.swift`: `resolveCanonicalChat` and retirement at 497–530; creation/collision handling at 680–778; registry/projection/root resume at 1310–1406; exact detail at 2018–2027; canonical create fields/receipt at 2113–2174.
- `Bighelp/DirectHermes/NativeWorkspaceSessionBridge+Catalog.swift:302–322`: agent-entry resolution followed by authorized first creation.
- `Bighelp/DirectHermes/DirectHermesWorkspaceClient.swift`: finite RPC fields at 260–280; detail GET at 465–467; path bounds at 690–695; actionable title/resume errors at 737–742.

Hermes: [3b2f971133e4e011022ccf33dc6dc1c9050563d8](https://github.com/NousResearch/hermes-agent/tree/3b2f971133e4e011022ccf33dc6dc1c9050563d8):

- `tui_gateway/methods_profiles.py:162–197`: canonical root and real compression tip.
- `tui_gateway/methods_session.py:110–124,514–538`: exact-title/hidden registry and lineage projection; 1220–1248: title acknowledgement and 4022.
- `gateway/platforms/api_server.py:2933–2944`: session-detail projection and archival flags.

Local reference HEADs were verified against these exact revisions. No live Hermes process or host was operated.

## Checks

- `npm test`: **263 passed**, 0 failed/skipped/cancelled. Deterministic synthetic adapters cover discovery, hidden/compacted identity, duplicate/missing support, collision/retirement, persistence/uncertainty, stale publication/cancellation and principal isolation. Navigation regressions cover 4,100 sequential entries plus reconnect, same-ID reuse after settlement/reconnect, active duplicate and superseded-request replay, old-generation cancellation, failed newer admission, ordinary/saved-chat supersession and cancellation before snapshot publication.
- `npm run typecheck`: core, desktop and renderer passed.
- `npm run desktop:package`: current production bundle and unsigned local Linux x64 development package built successfully.
- `node scripts/desktop/smoke.mjs --headless --executable artifacts/bighelp-development-linux-x64/electron`: **20 passed, 0 failed**; Electron 44.7.2 / Chrome 152.0.7977.149, **OS sandbox enabled**. No helper permission changes.
- `git diff --check`: passed.

Earlier development smoke used `--no-os-sandbox` and passed 20/20. An old packaged artifact initially failed only its finite-bridge-key assertion; rebuilding the package produced the sandbox-enabled result above. The smoke change only updates that exact key assertion.

These checks do not establish live-host conformance, physical Windows/Linux accessibility/IME/scaling, or hardware-rendered interaction parity. Unresolvable uncertain create/title remains safely blocked; no recovery/retirement UI or automatic mutation retry was added. Unacknowledged cleanup can leave an empty losing creation and is never repeated automatically.
