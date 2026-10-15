# Visual and interaction conversion contract

**Status:** source-derived requirements, not a finished design or screenshot audit. No real UI, screenshots, or static mocks were produced in this planning pass. Current authority is the shipping Catalyst app plus [DESIGN.md](../upstream/bighelp/DESIGN.md), not the older standalone Mac prototype or a generic mobile RN layout.

## 1. Preserve the product, adapt the OS

Keep the Noodle mark/wordmark, friendly warm surfaces, semantic colors, typography hierarchy, agent identity, conversation rhythm, sidebar, feature layouts, and ordinary-vs-Nerd Mode separation. Do not turn the port into a web dashboard or a developer console.

Window controls, system menus, file dialogs, shortcut labels, focus/accessibility, notification chrome, and editor implementation may differ to behave correctly on Windows/Linux. Functional parity is more important than reproducing a Mac title-bar glyph in the wrong OS location.

**Before UI implementation:** capture a disposable reference build/session; make several distinct static alternatives; publish with the `html-communication` skill when available, report URLs, and stop for a pick. If that publishing skill is unavailable, say so and agree on the delivery method. Do not skip approval or claim a mock exists.

## 2. Source tokens (logical points, not screenshot pixels)

Sources: `Bighelp/DesignSystem/BighelpTokens.swift`, `BighelpTheme.swift`, `BighelpInterfaceSize.swift`, `BighelpBrand`, and current `DESIGN.md`. Resolve theme semantics rather than copying every raw hex into a component.

| Token | Source value / requirement |
|---|---|
| Noodle brand Ember | `#FF8A7A`; brand stroke, **not every action button** |
| Light canvas / surface / raised | `#FFF9F5` / `#FFFFFF` / `#FFFFFF` |
| Light primary / secondary / tertiary text | `#1C1A19` / `#6F6762` / `#8F8781` |
| Light border / separator | `#E9E1DB` / `#EDE6E0` |
| Base light action / foreground | `#7B52E0` / `#FFFFFF` before bubble/palette/contrast resolution |
| Dark canvas / surface / raised | `#121110` / `#1E1C1B` / `#292624` |
| Dark primary / secondary / tertiary text | `#F5F2EF` / `#A39B95` / `#857D77` |
| Dark border / separator | `#33302E` / `#292624` |
| Base dark action / foreground | `#C9B6FF` / `#1C1A19` before live resolution |
| Light semantic success / warning / danger / information | `#1E7A4E` / `#A85D00` / `#D33F42` / `#1769AA` |
| Dark semantic success / warning / danger / information | `#5BC98A` / `#F3B24F` / `#FF8A7A` / `#69B7ED` |
| Space scale | 4, 8, 12, 16, 20, 24, 32, 40, 48 |
| Radius scale | 8, 12, 16, 20, 28, pill (999) |
| Card / menu / composer / input / row radii | 20 / 28 / 28 / 16 / 12 |
| Base general hit target / control / composer / primary action | 44 / 48 / 52 / 56; **Mac toolbar buttons size themselves** |
| Hairline / shadow radius / shadow Y | 1 / 12 / 4 |
| Source press / state / transition / scene durations | 120 / 180 / 260 / 420 ms; only finite event-driven use after approval |

Appearance includes system/light/dark, 12 bubble colors plus custom color, light page Cream/Paper, dark page choices including Graphite/Black, text size, and button size. Preserve readable accent/foreground resolution and high-contrast variants. There is one visual system, not a revived downloadable theme catalog.

Source typography is system-font based: bold display and screen titles, semibold section/label, regular body/metadata. Mac standard text uses the iPhone style size ×0.94 (body roughly 16 points), with factors 0.82/0.94/1.03/1.12/1.22 across the five settings. Button scale is 1/1.15/1.3. Use these as reference relationships; map to accessible OS scaling rather than multiplying every RNW text size twice.

**Font decision:** Segoe UI on Windows plus licensed Noto Sans on Linux is proposed; a common licensed font is an alternative. Do not redistribute SF Pro or assume SF Symbols are cross-platform assets. Measure line breaks, emoji/fallback, monospace code, and selection bounds on both renderers before settling the mapping.

## 3. Desktop geometry and shell

| Component | Current source behavior | Conversion requirement |
|---|---|---|
| Sidebar | Default ~330 points at standard text; default calculation clamps 300–420 | Persistent open column beside content, not an always-modal phone drawer |
| Resizable divider | Minimum sidebar 240; maximum `min(640, windowWidth − 380)` with minimum guard; 1-point line and wider interaction area | Preserve readable content, pointer cursor, drag, double-click reset, keyboard resize alternative |
| Sidebar persistence | Mac key `bighelp.mac.sidebar-width` | Equivalent platform-local preference, not the same Apple container |
| Compact sheet | 480 × 420 preferred | Screen-clamped desktop dialog with proper focus/escape |
| Standard sheet | 680 × 740 preferred | Forms/list/editor layout, scroll content, visible actions |
| Large sheet | 920 × 780 preferred | Studio/board/preview; no tiny mobile detent on a desktop |
| Sheet clamp | Screen width −80, height −140 in source | Adapt to usable work area, taskbar/panels and scaling |
| Chat | One viewport, independent persistent composer and overlays | No nested scroll ownership or composer recycling |
| Workflow | Compact readable flow; roomy graph/canvas plus inspector | Pan/zoom and keyboard-accessible linear equivalent |
| IDE | Launchpad/chips, conversation/changes/ship, orchestration/Dev Factory panels | Exact destination/setup state remains legible at narrow widths |

Use the source layout decisions for host chooser, all-hosts list, agent context, sidebar and header. Mac menus/popovers remain anchored to their initiating controls where possible; do not convert every choice to a full-window sheet. Preserve right-click equivalents, clear focus restoration, tooltip delays, menu dismissal, and disabled reasons.

## 4. Chat visual contract

The [accepted chat interaction contract](../upstream/bighelp/CHAT_INTERACTION_CONTRACT.md) is mandatory except its documented retired navigation and Apple-specific implementation details.

- Stable user/assistant separation, role labels, timestamps/status hierarchy, replies, attachments, cards, and tools. Never use animation to invent work.
- Markdown, code blocks, tables and long words render/select/copy correctly; no remote HTML execution. Keep full source text even where inline preview is bounded.
- Tool trails expand into individually virtualized rows; large full-content readers are separate. Expanding a row must not jump to bottom or lose scroll anchor.
- Live answer grows without replacing the editor or completed message views. Copy/selection/IME remain intact while another chat streams.
- Attachment rail shows source labels/progress/errors without raw attachment-marker text flashing in the bubble.
- Approval/clarification/forms are real request-bound controls with visible expiry/cancellation/refusal, not screenshots of controls.
- User controls automatic following. Prepend/reconnect/history reconciliation preserve the visible message, draft, disclosures and selection.

## 5. Reusable assets and rights

| Material | Plan |
|---|---|
| Noodle/wordmark, first-party custom glyph SVGs | Reuse after license/provenance review; preserve stroke geometry and aspect ratio |
| First-party avatar/creator/Bits packs | Port data/drawing with still fallback; verify content license and deterministic frame/pose |
| SF Symbols used in remaining components/cards | Finite vetted semantic replacement table; unknown symbol gets a neutral safe fallback |
| Apple system fonts/materials | Do not copy; use licensed fonts and approved static layered surfaces |
| Petdex/provider logos/remote artwork | Per-asset origin/license/hash audit; repository Apache license is not blanket permission |
| Charts/workflow edges/Bot Screen canvas | Renderer-specific adapters permitted; same labels, meaning, hit testing and accessibility |
| Screenshots/test media | Synthetic isolated data only; keep large evidence outside Git with a small evidence manifest |

No binary artwork/font/video was imported in this planning pass. Card fixtures may mention image symbols/URLs as **inert test data**, not a redistribution or network-fetch grant.

## 6. Motion, idle cost, accessibility

This workspace prohibits continuously repainting pulse/shimmer/spinner/blur effects. The Mac design contains some animated artwork/status/weather treatments; replace them with readable still states and brief event-driven transitions, and record this as an intentional approved difference. No hidden high-refresh timer should repaint an idle window. Respect Reduce Motion, Reduce Transparency, high contrast, and battery-saving states.

Keyboard-only use must reach every task; no essential hover-only or drag-only action. Focus order follows reading/task order, dialogs trap and restore focus, streaming announcements are throttled rather than per-token, and icon-only controls have names. Use Windows UI Automation/Narrator and Linux AT-SPI/Orca, not DOM accessibility alone as evidence. Test IME, non-Latin text, RTL content, emoji, and selection with scaled text.

## 7. Reference capture and approval checklist

Capture an **isolated** Mac app build/profile using deterministic synthetic data at the pinned SHA. Never launch against daily-driver data or a live host without permission. Record window/content dimensions, display scaling, text/button settings, appearance, source SHA, scenario/fixture, and rendering environment. Source values are not substitute pixel measurements.

Minimum comparison sets:

1. Onboarding/host sign-in, error/unsupported, picker and proxy controls.
2. Sidebar/all-hosts/agent navigation; narrow/wide; Settings/appearance/Nerd Mode.
3. Short and long chat, expanded tools, streaming, code/table/Unicode, replies/attachments/cards, approvals/clarifications, empty/offline/error.
4. Agent Studio/avatar, Feed/Ideas/Goals, projects/files/media, schedules, groups, usage/export.
5. Kanban drag/menu task actions, workflow canvas/inspector/run monitor/sign-off, IDE Changes/Ship and Dev Factory.
6. Connectors/vault secure prompts, provider/host administration, Bot Screen, voice/device permissions, notification navigation.

Produce several **distinct static directions**, for example source-faithful warm shell versus more OS-native chrome versus restrained cross-platform chrome, while keeping the same feature hierarchy. This is a future comparison brief, not an approved redesign.

After a pick, maintain a small discrepancy ledger: source screenshot, target screenshot, reason, owner approval, and whether the difference is visual-only or affects a task. At release, every feature-matrix row needs both-renderer evidence or an explicit exception. Pixel similarity cannot excuse missing behavior, unsafe controls, or unusable keyboard input.
