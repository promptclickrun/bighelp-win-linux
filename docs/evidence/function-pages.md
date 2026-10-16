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
