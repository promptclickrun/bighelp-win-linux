# Read-only function pages

Task 1 evidence recorded 2026-10-16, based on `e9e1ea2`. Implementation:
`75fab4a` (Add read-only Projects Scheduled and Usage pages). The approved
[D5](../DECISIONS.md) / [A list-and-detail](../design/function-alternatives/a-list-detail.html)
pattern now renders validated Projects, Scheduled and Usage projections inside
the existing 76 px rail / 300 px context column shell.

## Implemented behavior

The function context column contains a visible native Agent selector, actual
bounded search, explicit Refresh and selectable rows. Multiple agents require a
choice; one agent is the visible initial default. Removing that choice clears
it without selecting another agent. Each global function page owns local state;
leaving it retires its reads and selection.

Projects show supplied descriptions, archived/active state and folder paths as
selectable inert text. Scheduled shows the supplied schedule, state, enabled
flag, next run and result, with unavailable metadata labeled honestly. It does
not infer completion or offer New/Edit/Run controls. Device calendars/reminders
remain unavailable; Hermes scheduled tasks are separate host functionality.

Usage offers 7/30/90 days (30 initially), with Summary, daily and model rows.
Every metric uses the supplied value; missing values say Unavailable, actual
zero stays zero, and Estimated cost / Actual cost remain separate with no
currency assumption or inferred total. Unique model names remain selected
through refresh/reordering if present. The projection lacks model IDs and allows
repeated names, so ambiguous model selection is cleared after a new read rather
than assigned to a possibly different occurrence.

Changing profile/page/period/generation hides the old result immediately. Refresh
also replaces the result with a still loading state. No retry, polling, AI call,
write or renderer networking was added. Offline pages state unavailable and
never claim workspace copies were saved. Existing chat/agent cache banners retain
their original presentation.

## Response fencing

`useWorkspaceLoad` accepts data only from its own current
`DesktopApi.workspace(generation, profile, page, days)` promise. It checks the
returned connection generation, connected status, profile, page, and usage period.
A local invocation lease is invalidated on changed inputs, refresh and cleanup.
It deliberately ignores independent `snapshot.workspace` publications, which
have no request identifier and cannot identify same-key re-entry. Main's existing
workspace revision and host/principal/session fences remain authoritative.
No desktop API, preload or main-process changes were necessary.

Loading depends on primitive request coordinates and API identity, not snapshot
revision or parent callback identity. Passing a null page retires a shared-hook
load. The full reusable interface is in the Task 1 report.

## Navigation and accessible labels

The rail remains the only global navigation; no agent tab bar is mounted on
function pages. At wide sizes both panes appear. Narrow sizes use the existing
one-pane shell: rail entry shows the context list; choosing a row opens detail;
Back returns to the same list/selection without another read. The component
stays mounted across narrow pane changes. Switching global page remounts it.

Native select labels: `Agent` and `Usage period`. Agent's empty option says
`Choose an agent`; usage option values are `7`, `30`, `90` and visible labels are
`7 days`, `30 days`, `90 days`. Search labels are `Search projects`,
`Search scheduled`, `Search usage`. Refresh labels are `Refresh projects`,
`Refresh scheduled`, `Refresh usage`. Row buttons use their supplied title;
usage Summary's label is `Summary`. Selected row uses `aria-current="true"`.
Narrow detail uses the existing `Back` button. Refresh is disabled when offline,
without an API or without a selected profile; search and agent choice remain
reachable in the context pane.

## Deterministic verification

Tests first failed against missing implementation stubs (idle/no controls).
Subsequent failing regressions caught model index reassignment after removal and
ambiguous duplicate-name retention; both now require the appropriate selection
state. The actual App hook/reducer/callback regressions preserve protected draft
flush, canonical navigation cancellation and send behavior across all three
function-page routes. Real React server markup verifies escaping of hostile agent
names. Controller/component lifecycle tests exercise held IPC responses without
claiming browser or physical-input evidence.

Latest checks after final code change:

- `node --experimental-strip-types --test tests/ui-workspace.test.mjs tests/ui-draft-navigation.test.mjs tests/shell-navigation.test.mjs tests/ui-connected.test.mjs`: **57 passed**, zero failed (19 workspace, 18 App/draft, 15 shell, 5 real renderer markup).
- `npm test`: **339 passed**, zero failed/skipped/cancelled.
- `npm run typecheck`: all three strict configurations passed.
- `git diff --check`: passed.

Coverage includes held page/profile/period/generation changes, same-key re-entry,
refresh before a new render, cleanup, offline completion, unsupported/failed and
mismatched results, missing/zero usage, all periods, search/selection/removal,
profile removal, unrelated snapshot/callback churn, narrow Back and inert text.

No live or disposable host was contacted for this Task 1 change. No packaged
smoke, hosted CI or physical Windows/Linux keyboard/IME/screen-reader/visual
qualification is claimed here. Packaging qualification belongs to the subsequent
task; full platform acceptance remains separate. The earlier workspace-client
host evidence is recorded independently in [workspace-client.md](workspace-client.md).

## Task 2 — agent Feed, Ideas and Goals

Implemented 2026-10-16 in `e5d91b4`, based on reviewed Task 1 `06fb084`.
The open agent's Feed, Ideas and Goals now read only the matching validated
`WorkspaceBoard` projection with `DesktopApi.workspace(generation, profile, tab,
30)`. `AgentBoard` reuses the reviewed loader. The current opened agent must still
exist in the catalog; a removed profile never chooses another agent. Board
rendering applies no extra title/kind/profile identity filter to the validated
items. Only the visible board owns a reader. Leaving or changing the
agent/tab/generation retires its component and request; the hook also fences
changed input, offline transitions, refresh and same-key re-entry.

The existing global rail, 300 px agent/chat context column, agent header and
bottom tab strip stay in place. Inside the agent body, a flexible item list and
detail share the available width; no duplicate fixed context column or navigation
is added. Narrow selection opens detail; `Back to feed list` (or ideas/goals)
returns to the same local search and selection without another read. Each body
scroller is independent of the bottom tabs. Files says `Files unavailable` and
explains that its separate access contract is pending.

Search matches supplied title, body, note, category, status, dates and read text.
Refresh explicitly replaces old content with a still loading state. Selection
survives refresh only while the same item ID remains. Complete titles, bodies,
notes, category/status/date/read fields are selectable, wrapping inert text;
missing values say `Unavailable`, false read says `Unread`, true says `Read`.
Markup and URL-looking strings remain text with no links or executable elements.
Empty, no-match, unsupported, failed read and offline states use distinct honest
copy. Connected failures offer Refresh to retry; offline Refresh is disabled and
states `Connect to Hermes`. No cached board availability is claimed.

The chat composer is now always mounted at the same position in Conversation.
On every non-chat tab, its parent DOM div uses `hidden`, `inert`,
`aria-hidden="true"` and `display:none`, removing the editor and request controls
from view, focus and accessibility while retaining the editor node and native
state. Returning to Chat removes those restrictions. Tab navigation uses the
existing protected draft flush and cancels any pending canonical navigation;
board reads call no chat creation/lookup, send, mark-read or board mutation.
Draft persistence/cancelNavigation remain explicit navigation safeguards.

Accessible labels for actual renderer qualification:

- Bottom tabs retain `Chat`, `Feed`, `Ideas`, `Goals`, `Files`, in one `tablist`
  labeled with the supplied agent name; selected tab uses `aria-selected`.
- Board regions: `Feed board`, `Ideas board`, `Goals board`.
- Search: `Search feed`, `Search ideas`, `Search goals`.
- Refresh: `Refresh feed`, `Refresh ideas`, `Refresh goals`.
- Item buttons use supplied full titles and selected `aria-current="true"`.
- Narrow local Back: `Back to feed list`, `Back to ideas list`, `Back to goals list`.
- Composer remains `Message {agent name}` in the DOM under the hidden/inert
  wrapper, with its protected draft intact when returning to Chat.

Deterministic evidence: 11 initial board tests failed against a null stub because
loads, states and controls were absent; the Conversation regression failed because
the composer disappeared. A separate App regression failed because board-tab
navigation did not cancel a held canonical navigation. The implementation fixed
those failures. Additional regressions cover loaded same-key re-entry, exact
agent removal without fallback, true/false/missing read metadata, real React
hidden/inert markup, and App handoff of the actual profile/tab.

Latest covering checks:

- `node --experimental-strip-types --test tests/ui-agent-board.test.mjs tests/ui-workspace.test.mjs tests/ui-connected.test.mjs tests/ui-draft-navigation.test.mjs tests/shell-navigation.test.mjs`: **82 passed**, zero failed (13 board/Conversation, 22 shared workspace, 9 real React markup, 23 App/draft, 15 shell).
- `npm test`: **364 passed**, zero failed/skipped/cancelled.
- `npm run typecheck`: all three strict configurations passed.
- `git diff --check`: passed.

These are deterministic synthetic lifecycle/App tests and real React static
markup. Static markup proves emitted hiding attributes and tab order in the
markup; it does not prove actual Electron focus exclusion, DOM node identity,
layout, native undo/IME or screen-reader behavior. Task 3 owns those renderer
checks. No Task 2 live/disposable host, packaged smoke, hosted CI or physical
Windows/Linux qualification is claimed. No dependency or wire/API changes,
automatic AI calls, host mutations, push, merge or release were performed.
