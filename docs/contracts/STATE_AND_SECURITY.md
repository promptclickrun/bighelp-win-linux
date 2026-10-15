# State, ownership, security, and desktop platform contract

This combines the current Bighelp behavior with proposed Windows/Linux platform replacements. **Existing guarantees** must survive the port. **Proposed** mechanisms require the platform proof and review; none is claimed implemented.

## 1. Trust boundaries

| Boundary | Owns | Must not gain |
|---|---|---|
| UI renderer | Presentation, transient input, named user intents | Arbitrary network routes, credentials, filesystem, shell, or native-module authority |
| Privileged desktop adapter | Host HTTP/WS, OS secrets, file handles, browser callback, audio devices, OS notifications | An independent agent runtime or permission to trust remote markup |
| Domain/state layer | Owner-bound feature models, journals, reconciliation, cache metadata | Server authority, fake success, inferred grants |
| Hermes host | Login, profiles, sessions, execution, tools, schedules, Git, remote files | Client device access without an explicit capability and permission |
| Bighelp/other host plugins | Advertised finite feature extensions | A second chat transport, default AI spending, permission escalation |
| Optional catalog/notification services | Public assets or separately authorized delivery | Native host credentials, automatic host selection, chat availability gate |
| AI/media providers | Only what the chosen host/provider route explicitly needs | Arbitrary local secrets or an unannounced billing fallback |

Windows native modules and Linux Electron IPC must expose **finite operations**, with validated input/output and owner leases. A bridge such as `request(url,headers,body)` or `run(command)` is not acceptable to UI components. Treat generated content as hostile data even inside a trusted app renderer.

Electron proposal: packaged local UI, context isolation and sandbox enabled, Node integration off, restrictive CSP, no remote navigation or downloaded code, explicit external-URL allowlists and permission handlers. Validate sender/frame identity and every IPC payload. Do not disable web security to make host APIs work: privileged HTTP/WS is the solution to custom headers/CORS.

## 2. Identity and lifetime rules

Stable cache key: host ID + authenticated authority (provider/user or verified dashboard scope) + profile + durable object ID. Runtime lease additionally includes authentication and connection generation. A display name, URL alone, row index, or previous pairing ID is never authority.

- Same-authority reconnect retains cached pages, drafts, prepared chat models, disclosure choices, and current route. Replace transport leases and refresh history.
- Host/principal replacement retires composers, pending requests, polls, media, and file grants **before** asynchronously connecting elsewhere.
- A temporarily nil connection owner is not automatically another host. Preserve visible cache but disable writes until authority is current.
- Every asynchronous result checks the captured owner after completion. Cancellation is expected, not a visible error by default.
- Multiple windows share a single per-host connection manager and owner-bound stores, not parallel sockets with duplicated event consumers.
- Fleet mode may keep one connection per host while enabled/running. Its background reader stops when a host becomes selected; it never changes selected authority merely to refresh a list.
- Per-host/profile UI preferences are separate from immutable protocol identity. Person names/IDs used by `people/speaking` are labels, not authentication.

## 3. Submission state machine

```text
editing → durably prepared → staging (if any) → dispatched
  ├─ definite refusal → retained unsent/rejected intent
  ├─ accepted/streaming → live turn → verified terminal → history reconciliation
  └─ lost/ambiguous receipt → outcome unknown → authoritative inspection
```

- The durable journal is written before the first upload/mutation. Failure to persist blocks sending.
- Do not persist raw vault/sudo/provider secrets as part of a chat submission.
- `streaming` means accepted and running, not ready for another idle submit.
- Preserve local caption, attachment selection, reply quote and unsent text separately from the wire text with attachment references.
- Lost acknowledgement does not mean not delivered. No reconnect/offline queue silently replays prompts, uploads, approvals, Git writes, browser code exchange, or voice result appends.
- Definite rejection preserves retryable edits; explicit Retry creates a reviewed action, not a hidden background replay.
- Domain-specific idempotency is narrow: group event IDs, workflow request receipts and run tokens, form idempotency keys. Keep each original request identity/body when reconciling. A new UUID is not a dedupe strategy.
- Stop/interrupt is a user action. Navigating away, closing a card, muting audio, or stopping a viewer must not cancel accepted host work.

## 4. History, event replay, and presentation

Hermes saved history is canonical. A live overlay may show streaming text before persistence, then bind/merge exact saved row IDs without duplicate messages. Runtime and stored session IDs must remain distinct, including compaction successors and reclaimed runtimes.

Maintain sequence coverage; do not advance cursors over a gap or silently drop a required lifecycle event. Bounded overflow triggers resynchronization. Group-log sequences and lossy plugin observation sequences are separate. Replaying historical events does not replay sounds, progress animations, alerts, or AI calls.

Timeline rules inherited from the accepted chat contract:

- One scroll owner; virtualize rows, not content. Full history and tool output remain available.
- Stable semantic row IDs, including individual expanded tool rows; not indices, text hashes that change every token, or fresh random IDs.
- Reading/dragging/disclosure immediately stops automatic following. Reaching bottom, Return to Latest, or Send resumes it.
- Prepending history preserves the same visible semantic anchor and offset.
- Composer/editor lives outside list recycling. Streaming does not reset focus, IME composition, caret, selection, undo, draft, or dismissed keyboard state.
- Tool/disclosure/clarification state belongs to the prepared model/request, not disposable cell instances.
- Full Markdown/Unicode/source bytes and copy values survive bounded inline previews. Source guard: tool preview ≤2,048 scalars/16 explicit lines, full reader chunks ≤4,096 scalars; do not parse large JSON synchronously in each render.
- Coalesce draft/tool/cache writes. Final turn, navigation, lifecycle and explicit stop flush dirty intent; a completed tool does not rewrite the entire history.
- Encoding/persistence use immutable snapshots off the UI thread; re-check owner/revision before adoption. Older writes must not overwrite newer drafts.

## 5. Storage and secrets

Proposed desktop storage policy (not an existing Swift file-format promise):

| Data | Destination | Retention / rules |
|---|---|---|
| Host auth/proxy tokens, refresh tokens, recipient private keys | Windows DPAPI/Credential Manager-backed adapter; Linux Secret Service-backed adapter | Exact host/principal namespace; atomically rotate; never renderer-readable |
| User-entered one-time secrets/passwords | Transient secure editor → finite privileged write operation | Do not log/cache; erase on completion/cancel/owner change. JS cannot promise cryptographic zeroization |
| Journals/drafts/history | Versioned per-authority protected repository | Crash-safe commit, sequential migration, preserve unsupported newer schema; protect at rest with an OS-wrapped key where selected |
| Small nonsecret appearance/layout preferences | App-specific settings | Local only; validated schema, separate per-host IDs where applicable |
| Completed attachment cache | App cache directory, initially 512 MiB LRU | Integrity checked; evict disposable data only, never unresolved draft sources |
| Avatar/catalog assets | Content-addressed bounded cache + bundled fallback | Immutable selected avatar pack retained after catalog expiry; no chosen-provider tracking |
| Temporary audio/import/export | Private app-owned temp area/handle | Bounded, explicit lifecycle cleanup and crash cleanup; never repository directory |
| Diagnostics | Opt-in bounded rotating local logs | IDs/URLs redacted; no user text, bodies, tokens, SDP, provider credentials or file content |

Linux fail-closed requirement: if Secret Service is missing/locked or a storage library offers insecure fallback (for example a basic-text backend), do not silently persist credentials. Offer unlock/setup or explicitly nonpersistent sign-in. Do not use `.env`, localStorage, IndexedDB, ordinary JSON, or a hardcoded encryption key as substitutes.

Do not claim Apple-style sandbox/file protection exists on an unpackaged desktop app. Validate app directory ACLs, symlink/reparse-point handling, backup/exclusion behavior, encryption-key lifetime, and import path limits. Prefer new OS-specific app data locations; do not adopt the Mac app's container by matching a hostname.

Removal scopes:

- Remove host: retire its live work consumers, remove that host's credentials/cache/preference identifiers, handle optional grant revocation explicitly. Do not delete unrelated local app preferences or remote Hermes data.
- Disable notifications: retire/revoke only delivery state, not chat credentials/history.
- Clear cache: preserve unresolved send journal and unsent drafts unless the user explicitly approves deletion.
- Uninstall: documented choice of local-data retention/removal; never erase host data.
- Backup/export: explicit user action, clear sensitive-content warning, no implicit cloud sync.

## 6. Network and content safety

- Exact-origin authorization and redirect refusal; private HTTP only by validated opt-in. Do not disable certificate verification.
- Different HTTP sessions for authenticated host, public catalogs/media, and explicit client-direct voice provider routes. No shared cookies/credentials.
- Bounded streaming reads, JSON depth/size/number checks, canonical hashes, decompression/image pixel/frame budgets, URL/protocol allowlists, and safe filenames.
- Public remote-media fetches cannot reach loopback/private/link-local/metadata services, follow unsafe redirects, or carry host headers. Re-check resolved destinations; a hostname string alone is insufficient.
- Rich cards never execute HTML/JS/CSS or fetch live data. Markdown links/images and exported HTML must not become app-shell code. Escape data and restrict URL schemes.
- File dialogs grant selected handles, not arbitrary directory access. Keep local Windows paths separate from remote POSIX paths. Treat zip/tar imports, symlinks, reparse points, traversal, oversized files, and CSV formulas as hostile.
- Exported CSV neutralizes formula execution in string cells while retaining full numeric precision; self-contained usage HTML includes no remote executable resources.
- Host management operates through finite reviewed APIs. No generic terminal installed in the app as a shortcut to missing API support.

## 7. Audio and device permissions

Ask for sensitive access at use time, not startup. A microphone/speech/calendar/location OS grant is necessary but not sufficient for agent access. Keep the source's per-host/per-capability consent for private device data, current-chat ownership, explicit indicators, and a clear revoke path. Appearance is different: upstream uses one app-wide, default-on switch, requires no OS data permission, and can only change finite local visual settings while that chat is open in the foreground.

Device-local recognition must really be local; a platform service with online processing must be labeled accordingly. Explicit Hermes transcription sends audio to the host/configured provider and may use a private temporary recording; older docs saying audio never leaves/stays on disk are not accurate for that mode. No automatic fallback changes privacy or billing.

Live voice credentials normally stay on the plugin host; advanced stock client-direct voice routes can issue short-lived provider material. Keep that in privileged memory with fixed validated endpoints and owner lifetime; never ordinary persistent storage or observable UI values.

Revoke capture/channel access on lock, background/device-tool retirement, host change, or permission change. Playback completion is identity-checked. Barge-in stops audio, not host execution. Never mark local calendar/reminder writes retryable merely because their result could not reach Hermes; maintain a bounded non-content dedupe/outcome journal.

No default desktop Health data bridge, calendar provider, geolocation vendor, or identity synchronization is assumed by this plan.

## 8. Notifications, links, and updates

- Optional notification enrollment is separate authority. Verify host signing key/recipient/grant/event and re-check host state before navigating or approving.
- Respect quiet hours, group by agent, dedupe by event identity, suppress the chat on screen, preserve unresolved questions/approvals, and keep subagent results passive where the OS supports it.
- Desktop popup delivery while running is not proof of push while fully exited. Tray/autostart/background helper requires explicit user choice and an agreed support model.
- Custom links open only known validated Bighelp destinations, resolve exact saved host/session, queue until ready, and never import arbitrary credentials, files, or command arguments.
- Existing `loopdy://` compatibility may collide with another installed app; select and register a new desktop scheme or explicit legacy alias only after approval. Browser PKCE loopback callbacks are not app deep links.
- Updates require signed artifacts/metadata, HTTPS, publisher verification, bounded downloads, no downgrade by default, and recoverable install. Do not enable unsigned auto-updates or ship signing keys to the app/repo.
- A desktop app update cannot silently install/enable/update a Hermes plugin, restart a host, or change a user's model/billing settings.

## 9. Security acceptance cases

Each is a focused test/inspection target, not a claim already passed:

1. HTTP/WS redirect attempts cannot leak host/custom headers; private-host policy cannot be bypassed by DNS or URL parsing.
2. Forged principal/context/echo or stale generation cannot publish data or complete a write.
3. Renderer IPC cannot reach arbitrary filesystem, host route, local network, or shell.
4. Lost send/upload/approval/workflow/Git receipts follow their exact uncertainty/idempotency rules after a crash.
5. Card/Markdown/media/import payloads cannot execute script, escape roots, or exceed bounded resources.
6. Credential refresh is single-flight and durably stored; missing/locked Linux keyring fails safely.
7. Device permission revocation/lock/host switch stops access; uncertain writes never duplicate calendar events/reminders.
8. Notification replay, stale links, invalid signatures, wrong recipients, and revoked grants fail closed.
9. Malicious update metadata, wrong publisher, altered asset hashes, and rollback attempts are rejected.
10. Real-host and real-OS evidence is labeled separately from scripted fixtures; no production test access is implied.
