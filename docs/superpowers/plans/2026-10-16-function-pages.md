# Approved Function Pages Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Make the existing read-only workspace clients usable through the approved A list/detail pages and the agent's existing Feed/Ideas/Goals tabs.

**Architecture:** Keep the privileged service and its finite `workspace(generation, profile, page, days)` operation as the only data source. Renderer state owns local selection, search and periods; matched safe snapshots supply inert details. The current hybrid D shell and its established one-pane narrow navigation remain in place.

**Tech Stack:** Existing pinned TypeScript, React, React Native Web and Electron. No dependencies.

**Spec:** `docs/DECISIONS.md` D5 (A selected 2026-10-16); `docs/design/function-alternatives/a-list-detail.html`; `docs/evidence/workspace-client.md`; `AGENTS.md`; applicable F23/F25/F26/F28 rows in `docs/parity/FEATURE_MATRIX.md`. This increment delivers the existing read surfaces; workflow/Kanban/vault clients and all workspace writes remain separate implementation requirements, not completed features.

## Global Constraints

- One navigation system and one Settings. Agent Chat/Feed/Ideas/Goals/Files tabs remain below the open agent's content/composer; function pages never duplicate them.
- Preserve the approved A structure: 76 px rail, 300 px context list, remaining width for detail. Reuse existing colors, fonts and primitives, including the existing narrow list/detail navigation.
- Every request and visible result must match the current connection generation, profile, page and usage period. Host/principal/session authority remains in main. Retired responses must not change selection or reappear after switching away and back.
- Use only the existing finite desktop API. No renderer networking, files, shell, credential reads, new dependencies, host mutations or automatic AI calls.
- Server text is inert, selectable text. Missing usage values remain unavailable, not zero; estimated and actual cost stay distinct. Scheduled states and results must reflect supplied fields only.
- No continuously repainting pulse/shimmer/spinner/blur effects. Use still status and brief event-driven transitions; respect Reduce Motion and Reduce Transparency.
- Device calendar/reminder access remains unavailable. Hermes scheduled tasks are separate host functionality, not local device calendar integration.
- Keep deterministic fixture, disposable-host, hosted CI and physical-machine evidence distinct. No merge, signing or release.

## Review Focus

- Switching profile/page/period while a read is pending must never show the old selection or result as the new request; test held responses and same-key re-entry.
- Unrelated snapshot revisions and unstable parent callback identities must not create request loops; prove one request per intentional load and explicit refresh only.
- Offline transition, empty catalogs, removed selection and failed/unsupported reads must provide honest reachable states without dead controls.
- Missing versus zero usage values, scheduled error/unknown metadata and executable-looking server text must retain their meaning and remain inert.
- Function/tab navigation must preserve existing protected draft behavior and keyboard reachability at wide/narrow sizes.

---

### Task 1: Projects, Scheduled and Usage list/detail pages

**Files:** Create focused renderer components/controller under `packages/ui/`; modify `packages/ui/App.tsx`, `packages/ui/components/ContextList.tsx` and, only as needed for existing narrow navigation, `packages/domain/shell.ts`. Tests in `tests/ui-workspace.test.mjs` and existing shell/draft regression files when integration changes require it. Evidence in `docs/evidence/function-pages.md`.

**Interfaces:** Consume `DesktopApi.workspace(generation, profile, page, days): Promise<DesktopResult>`, `DesktopSnapshot.workspace`, and `WorkspaceProjects/WorkspaceScheduled/WorkspaceUsage`. Produce `WorkspaceFunctionPage` (or a focused list/detail pair) used by App, with its own bounded local selected row, actual search, profile choice and usage period state. Keep one shared workspace-load hook/controller usable by Task 2; document its exact exported interface in the report. Existing desktop API shape may be extended narrowly only if necessary to fence same-key re-entry, with corresponding main/preload/tests; no generic escape hatch.

- [x] Write failing behavior tests for loading real snapshot projections; explicit agent selection; row search and selection; retained selection on refresh if present; cleared selection on removal; missing/zero usage data; 7/30/90 periods; unsupported/failed/offline states; escaping host text. Add held request tests for page/profile/period/generation changes and same-key re-entry; no loads on unrelated snapshot publications or callback identity changes.
- [x] Implement A for Projects and Scheduled: existing context column provides a labeled agent selector, real search, refresh and selectable rows; detail shows supplied project descriptions/folders/active/archived state, or task schedule/state/enabled/next-run/result. Paths are text only. No fake New/Edit/Run controls or invented data. Use an explicit empty/selection state when necessary. Do not choose a different agent merely because a prior profile disappears; require a valid selection. A single available agent can be the initial explicit visible default.
- [x] Implement Usage in the same list/detail pattern: visible agent and 7/30/90 period controls, summary plus daily/model detail selection, supplied metrics with distinct estimated/actual labels. No inferred totals, currency assumptions or exports. Search filters displayed rows. Choosing a period replaces old results immediately with a still loading state.
- [x] Wire App navigation without disturbing chat cancellation, send journal or acknowledged draft flush. Preserve one rail/context/detail layout, existing theme and narrow Back behavior. Leaving or superseding a load hides old content immediately; no automatic retry or periodic polling. Refresh is a read action. Offline function pages state unavailable; the chat-only cache banner must not claim saved workspace copies.
- [x] Run focused renderer/controller/shell/draft tests, `npm run typecheck`, and `git diff --check`. Commit a logical implementation and write the report with commands/counts and exact exported interfaces.

### Task 2: Agent Feed, Ideas and Goals read views

**Files:** Modify `packages/ui/components/Conversation.tsx`, Task 1 controller/component and App integration as needed; add a focused board body component and tests; append `docs/evidence/function-pages.md`.

**Interfaces:** Consume Task 1's reviewed load controller and the existing `DesktopApi.workspace` for `feed | ideas | goals`; use the opened agent's exact profile. Render `WorkspaceBoard` data only. No new wire or capability operations.

- [x] Write failing tests that selecting each existing agent tab loads exactly that profile/tab, filters no extra identity, displays empty/unsupported/offline/error states, and escapes markup/URL-looking text. Hold reads across agent/tab/generation changes and verify no stale content or request loop; tab loads must invoke neither prompt submission nor board mutation.
- [x] Replace the three tab placeholders with a readable selectable list/detail body using existing A primitives. The agent tab strip stays in its existing bottom position; no duplicate rail or Settings. Show supplied title/body/note/category/status/date/read metadata as inert text, with local search and explicit refresh. Files remains accurately unavailable pending its separate contract.
- [x] Preserve the mounted composer/draft contract when visiting non-chat tabs; no new chat creation or canonical lookup merely to read a board. Keep protected draft navigation regressions passing.
- [x] Run focused board/controller/Conversation/draft tests, `npm run typecheck` and `git diff --check`; commit and report.

### Task 3: Integrated verification and package handoff

**Files:** Extend `scripts/desktop/smoke.mjs` for new function controls; add a test-only `scripts/qualification/workspace-ui-fixture.tsx` and strict fixture compiler configuration if needed; update `.github/workflows/desktop.yml`, evidence/overview/parity references and PR #10.

**Interfaces:** Consume reviewed Tasks 1/2 in the actual packaged app. Existing synthetic data or finite test adapters may support deterministic app interaction tests, but must never enter production bundles or request real host mutations.

- [x] Run the full suite, all strict compiler projects and production package build. Verify package checksums and sandboxed packaged smoke; exercise new function navigation and honest empty/offline states with the existing no-host packaged app. Capture real app screenshots if supported; do not bypass browser policy or claim physical UI qualification.
- [x] Add an opt-in `--workspace-fixture` smoke stage that bundles a separate test-only renderer entry using the existing esbuild dependency and mounts actual App/ConnectedApp components in an isolated DOM container through the existing loopback CDP test connection. It supplies a finite synthetic DesktopApi with no IPC/network/secret/host access; original packaged-app isolation checks run separately before injection. No test hook, fixture import or new capability enters production application code or artifacts. Remove the fixture root after the stage. Label its results as synthetic Electron interaction evidence, not actual-host or production-fixture data.
- [x] The actual React/DOM stage must exercise profile selection, search, row selection, explicit refresh, 7/30/90 usage periods, held old versus new page/profile/period/generation results and same-key re-entry, full selectable narrow titles/Back, and board tab read-only behavior. Verify that the composer DOM node and draft survive visits to each board tab; hidden composer is absent from focus/accessibility while active board controls remain reachable. Assert zero fake send/new/canonical/board-mutation calls from board browsing. Use supplied adversarial text as inert text, not HTML/links. Fixtures stay under qualification, not production bundles; use no new dependency, host or key-store bypass.
- [x] Run this optional interaction stage alongside ordinary packaged smoke on both existing Windows/Ubuntu CI jobs. Reuse the current sandbox-enabled launch setup. This does not replace the prior no-host package checks or real OS protection probe. Compile the fixture strictly with DOM-only types; report failures without credentials, environment dumps or private content.
- [ ] Obtain independent whole-increment review including the base branch trust boundaries and both task reviews. Resolve actionable findings via implementer and scoped review.
- [ ] Push the existing feature branch and verify native Windows/Ubuntu CI on its final head. Update PR/evidence with exact tests and artifact links. The prior provider-free real-host tests qualify the unchanged read clients, not new physical UI behavior. Repeat disposable-host tests only if privileged client/service behavior changes.
- [ ] Record A as implemented for the read surfaces, remove stale pending-A wording from current overview, and retain all actual parity/hardware/release gaps. Commit before handoff; no merge/release.
