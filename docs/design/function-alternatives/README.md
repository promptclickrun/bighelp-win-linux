# Function page alternatives

Start with [the comparison](index.html). Open the files directly in a browser; no server, scripts, packages, fonts, or network resources are required.

**Selected 2026-10-16:** Colt chose **A — List and detail**. This is the approved function-page body direction inside hybrid D; see [D5](../../DECISIONS.md#d5--visual-parity-exceptions-before-real-ui). The alternatives below remain the original review artifacts.

These static proposals keep the [approved hybrid D](../p0-alternatives/d-hybrid.html) structure: global rail → context list → selected detail, with one Settings entry per illustrated window. Noodle colors, surface tokens, rail labels, and glyph paths are reused from D. Typography uses installed system fonts. The two frames per option show the same synthetic Workflow and Scheduled content in light and dark themes.

| Option | Tradeoff | Applicable surfaces |
| --- | --- | --- |
| [A — List and detail](a-list-detail.html), recommended | Most room for selected detail; fewer fields available for comparing rows. Keeps D's 76 px rail and 300 px context area. | Projects, workflow definitions and run selection, Scheduled, Vault metadata. |
| [B — Compact cards](b-compact-cards.html) | Descriptions and labels scan well; fewer items fit at once. Uses a 360 px context area. | Projects, workflow definitions, selected Kanban task context. |
| [C — Table and inspector](c-table-inspector.html) | Comparable fields scan well across many records; the 516 px context table leaves less room for detail. | Usage records, workflow runs, Scheduled, Vault metadata. |

A is the recommended default because it carries D's list/detail proportions directly into these functions. A pick would establish a body pattern, not approve every control or each remaining feature. Kanban needs a board-specific body; Usage needs host-backed aggregates and honest empty states; Vault needs secret-safe details. Those surfaces are named as applications, not presented as completed designs. Exact rail order, spacing, narrow navigation, fonts, glyphs, and behavior remain subject to D5's outstanding review scope.

## Synthetic evidence only

- The names, recurrence values, definitions, and unknown run record are deterministic examples. The schedule examples are paused. No live host is connected.
- No run success, execution progress, timestamps, or cost amounts are invented. The selected run's outcome and output are explicitly unavailable. Planned workflow steps describe the definition, not execution progress.
- All product controls are inert text and shapes; only document links navigate. There is no JavaScript, form, remote asset, iframe, or executable product action. The CSP disallows all resources except inline CSS.
- Agent Chat/Feed/Ideas/Goals/Files tabs belong below the chat composer in D. These are function pages, so those agent tabs are not duplicated here.

## Review and publication

The `html-communication` skill was unavailable when these alternatives were prepared. **Nothing was published.** These are local review artifacts, not product implementation or parity evidence. The user subsequently selected A before function-body implementation.

Visual capture was attempted with the installed Chromium, but its organization policy blocks `file://` navigation ("This page is blocked. Your organization doesn’t allow you to view this site"). No rendered mock screenshots or browser layout verification are claimed. The block-page evidence is saved outside the repository at `<scratch>/function-mocks/chromium-file-policy.png`; it is not committed. The HTML remains the review source.

Static validation checked all four HTML documents: local links resolve, application elements are inert, scripts/forms/inputs/remote resources are absent, and each alternative contains two labeled frames with exactly one Settings entry per frame. No live-host or native-platform behavior was tested.

Reference: [D5](../../DECISIONS.md#d5--visual-parity-exceptions-before-real-ui), [workspace contract](../../../AGENTS.md), [hybrid D](../p0-alternatives/d-hybrid.html).
