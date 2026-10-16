# Task 1 — Canonical Bot Chat

Status: **DONE_WITH_CONCERNS** (implementation and synthetic/packaged checks complete; live Hermes and physical Windows/Linux parity remain unqualified).

## Owned commits and scope

- Implementation: `9ad7432` — Open each agent’s canonical Bot Chat safely.
- Exact implementation review base: `5c3671c0933b76662e913f0ec91f22136a96e485`.
- Original task baseline: `f4f8042`; intervening commits belong to the controller/cache worker.
- This report is committed separately after the implementation commit. No other worker’s files were staged.

Owned files: `packages/contracts/canonical-chat.ts`, `packages/hermes-client/canonical-chat.ts`, the finite additions in `packages/contracts/session.ts`, `packages/hermes-client/gateway.ts`, `packages/platform/transport-policy.ts`, desktop service/shared API/preload, the existing App click/cancellation hook, focused canonical/API/service/gateway/transport tests, and the smoke script’s finite API key assertion. No layout, dependencies, remote host operations, push, signing, merge, or release.

## Result

Agent-row clicks use the finite `canonicalChat(generation, profile, requestId)` action. Ordinary New chat continues to use `session.create` without canonical title/hidden/follow-profile fields. No canonical failure selects another conversation or creates an ordinary fallback.

The resolver refreshes profiles and uses `canonical_session` when supplied. Otherwise it requests the exact `Bot Chat` registry with hidden rows included, rejects duplicate/malformed results, retains the registry root, and resumes that exact root. Hermes supplies the current durable compaction successor and runtime ID; neither newest session nor a locally inferred child is substituted. Before first creation, it rechecks the registry to avoid creating an empty duplicate when another client registered one during discovery.

First canonical creation uses the source-backed title, hidden and follow-profile fields, plus `source: bighelp` and `close_on_disconnect: false`. Exact `session.title` acknowledgement and registry readback precede publication. Error 4022 uses the source’s exact registry winner, then its narrowly authorized `Bot Chat` title resume when necessary. Error 4007 settles title ownership as unavailable. Cleanup only targets this resolver’s acknowledged empty creation, never the winner; unknown cleanup is not replayed.

Encrypted state is keyed by stable host/principal/profile, excluding connection generation. Create/title dispatch barriers are saved before dispatch. Unknown create/title outcomes block those mutations on reconstruction; explicit retry performs safe discovery and can settle a subsequently visible registry. An acknowledged `created` phase can resume its exact stored identity and finish title registration without another create. Writes are serialized and check the captured owner immediately before storage mutation, so late receipts cannot replace a newer lease’s state.

A remembered root missing from discovery is not replaced unless the source-backed detail GET confirms that exact root/profile was archived or renamed. Missing, malformed, mismatched, unavailable, or unsupported detail leaves resolution failed. The GET accepts only the source’s bounded path-identifier alphabet and fixed profile query.

Navigation has request-ID ownership. Cancellation works with the initiating request ID before the renderer receives the incremented generation, cannot cancel a later request, and does not retire a settled current chat. Overlapping entry can supersede in-flight resolution; old results cannot publish, restore prompts, title a chat, or overwrite recovery state. Leaving via rail/back/host settings or unmounting cancels only pending local navigation and never stops remote execution. Runtime/open-request restoration remains on the existing validated gateway path.

## Source evidence

Pinned Apple checkout: `/workspace/scratch/bighelp-protocol-reference`, verified HEAD `d62a545386fb1b63f8ca33365766a46b3b1bd636` (shipping shared Catalyst source).

- `Bighelp/Hermes/DirectHermesSessionCatalogClient.swift:497-530`: canonical discovery, remembered-root failure, confirmed retirement.
- Same file `680-778`: first canonical creation, registry recheck, title acknowledgement, 4022/4007 collision handling and empty-creation cleanup.
- Same file `1310-1406`: profiles projection, exact-title hidden registry, root resume, compaction identity.
- Same file `2018-2027`: strict detail identity/profile confirmation.
- Same file `2113-2174`: canonical create fields and acknowledged empty-session validation.
- `Bighelp/DirectHermes/NativeWorkspaceSessionBridge+Catalog.swift:302-322`: agent-entry discovery followed by authorized first canonical creation.
- `Bighelp/DirectHermes/DirectHermesWorkspaceClient.swift:260-280,465-467,690-695,737-742`: finite RPC/GET shapes, path bounds, exact actionable error translation.

Pinned disposable Hermes checkout: `/workspace/scratch/hermes-disposable`, verified HEAD `3b2f971133e4e011022ccf33dc6dc1c9050563d8`.

- `tui_gateway/methods_profiles.py:162-197`: canonical root and real compression-tip projection.
- `tui_gateway/methods_session.py:110-124,514-538`: exact title registry, hidden roots, archival policy, compressed descendants.
- Same file `1220-1248`: title receipt (`pending`, `title`) and 4022 rejection.
- `gateway/platforms/api_server.py:2933-2944`: bounded session-detail display projection/archival flags.

## Verification

All behavior tests use deterministic synthetic adapters; no live/disposable Hermes process was started or operated.

- `node --experimental-strip-types --test tests/canonical-chat.test.mjs tests/desktop-api.test.mjs tests/desktop-service.test.mjs tests/gateway-client.test.mjs tests/session-codec.test.mjs`: 50/50 at the earlier navigation/collision checkpoint. Final full-suite run below includes subsequent retirement/concurrency cases.
- `node --experimental-strip-types --test tests/canonical-chat.test.mjs tests/transport-policy.test.mjs`: 37/37 at the retirement checkpoint.
- Final `npm test`: **260 tests passed, 0 failed/skipped/cancelled**.
- Final `npm run typecheck`: passed core, desktop and renderer projects.
- `npm run desktop:build`: passed during implementation; final `npm run desktop:package` rebuilt the current production bundle and generated the unsigned local Linux x64 development package successfully.
- Final `node scripts/desktop/smoke.mjs --headless --executable artifacts/bighelp-development-linux-x64/electron`: **20 passed, 0 failed**, Chrome `152.0.7977.149` / Electron `44.7.2`, **OS sandbox enabled**. No chmod/chown or helper permission changes.
- `git diff --check`: passed before implementation commit.

Focused cases cover root vs newest, hidden registry fallback, compaction successors, duplicate/malformed rows, unsupported lookup, failed exact resume/no fallback, registry winner appearing before create, title collision winner and exact-name fallback, confirmed retirement vs missing support, persistence failure before dispatch, uncertain create/title reconstruction, stale discovery/detail, navigation before new-generation publication, overlapping entry and delayed old cancellation, late create receipts, and different-principal state isolation.

Earlier evidence is preserved honestly: a development Electron smoke with `--no-os-sandbox` passed 20/20; an old packaged artifact initially passed 19/20 because its bridge predated the new API. Rebuilding the artifact produced the final sandbox-enabled 20/20 result above. The smoke source change only expands the exact finite key assertion.

## Limits / concerns

- No live Hermes REST/WS conformance run or authenticated provider exercise was performed in this task. Protocol behavior is source-backed and tested with synthetic responses.
- Headless Linux container smoke verifies packaging/isolation and the finite preload boundary; it does not qualify physical Windows/Linux accessibility, keyboard/IME, scaling or rendered agent-click interactions on hardware.
- If Hermes never exposes the result of an uncertain first create/title, repeated agent entry remains safely blocked. There is no automatic resend, ordinary fallback, or new recovery/retirement UI.
- Best-effort source cleanup can leave an empty losing creation if its deletion is unacknowledged. It is never repeated automatically.
- The existing legacy `sessionResume` operation remains a finite exact-identity resume. Ordinary New chat’s broader creation recovery is outside this canonical-only task.
