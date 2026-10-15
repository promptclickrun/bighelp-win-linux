# Desktop UX acceptance gates

Static mocks are proposals, not evidence of native behavior. This checklist incorporates the independent Opus 5.5 UX review and parent review of the three mock sheets.

## Required behavior

- Current-navigation corrections override the retired root list in `CHAT_INTERACTION_CONTRACT.md`. Use shipping Catalyst, not BighelpMac. Exact Mac order still needs isolated reference capture. Sources: `docs/SOURCES.md`, `docs/parity/VISUAL_PARITY.md`.
- Preserve one navigation and one Settings. Everyday controls remain outside Nerd Mode. Preserve per-agent Chat, Feed, Ideas, Goals and Files. Sources: `docs/upstream/bighelp/DESIGN.md:58-69,268-291,392-396`.
- Keep the composer outside a recycled list. Drafts stay editable during connection recovery. Preserve IME composition, caret, selection and undo. Sources: `docs/upstream/bighelp/CHAT_INTERACTION_CONTRACT.md:26`, `docs/upstream/bighelp/CACHE_FIRST_SESSIONS.md:11`.
- An unacknowledged send is unknown, not failed. Reconcile first; never automatically resend. Explicit duplicate-risk confirmation is required before a new attempt. Sources: `packages/domain/chat-contract.ts`, `docs/upstream/bighelp/CACHE_FIRST_SESSIONS.md:42`.
- Window close, navigation and tray mode do not stop execution. Only explicit Stop does. Sources: `docs/DECISIONS.md`, `docs/contracts/HERMES_API.md:113`.
- Retire stale approvals and secret prompts on ownership changes. Do not duplicate decisions across windows or default-focus Approve. Source: `docs/contracts/HERMES_API.md:89-95`.
- Recent catalog activity and replayed events are not proof that an agent is running. Never invent progress or successful tool outcomes. Source: `docs/upstream/bighelp/DIRECT_HERMES_SESSIONS.md:56-57,72-74`.
- Replace continuous upstream loading animations with still status. Real screen-reader acceptance needs Narrator/UIA and Orca/AT-SPI; HTML semantics alone do not prove it. Source: `docs/parity/VISUAL_PARITY.md:88-90`.

## Mock review findings

A is the recommended starting arrangement, closest to the documented persistent desktop sidebar. Its exact navigation order and shipping visual parity are unverified. B uses an iPad-style overlay menu instead of the required desktop sidebar; choosing it requires an explicit exception. C introduces a distinct navigation rail and has unresolved narrow-window chat switching. Do not treat either as already compliant.

The companion-pet Settings row is unresolved Apple-only scope, not an approved desktop feature. Key mappings are proposals. Sidebar resize bounds already have upstream guidance; they are not unspecified. Static mock controls do not establish any implemented interaction.

Parent image inspection found no obvious clipping in the supplied fixed-size sheets. This does not establish behavior at arbitrary sizes, high contrast, display scaling, RTL, keyboard navigation or screen-reader use. No shipping-app screenshot comparison or real Windows/Linux run has occurred.

## Decisions still required

- Visual direction and any explicit parity exceptions.
- Exact dependency approval and native platform qualification.
- Shortcut/send-key mappings, still-state replacements, and desktop link scheme compatibility.

Do not install dependencies or implement product visuals merely because these source proposals merge.
