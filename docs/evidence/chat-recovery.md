# Protected offline chat recovery

Task 3 of `docs/plans/2026-10-16-chat-recovery.md` integrates the protected display cache into the existing desktop chat shell. This evidence records synthetic adapters and source verification. Disposable-host qualification, packaged builds, CI and physical-machine checks are separate evidence.

## Behavior and ownership

Only verified live identity can establish a cache-owner pointer. The pointer lives in the encrypted protected repository, is versioned and strictly validated, and binds the exact canonical endpoint, authentication kind and credential fingerprint to the exact host/principal scope. Offline startup checks that binding against the saved protected configuration; it never discovers or infers a new provider identity. No pointer, credential, fingerprint, endpoint or raw authenticated identity is added to renderer snapshots. Unsupported or corrupt pointer versions are preserved.

Startup can show matching cached agent/session catalogs and saved history with the existing offline host state and notice. The existing finite `openChat` action permits exact validated saved-chat selection while disconnected. It does not resolve canonical chats from cached titles. Send, Stop, new chat, canonical lookup, prompt answers, draft edits and live workspace reads still require current live authority. Offline saved drafts are read separately with selection and authority fences, and remain read-only. The existing composer receives an explicit editable flag; App suppresses draft persistence while offline or without the selected live chat.

Catalog refresh and verified session history are the only cache update sources. A separate authoritative projection excludes optimistic pending/unknown bubbles, live segments, runtime IDs, execution state, prompts, actions and send authority. Network loss publishes that projection, never the current live overlay. Exact host/principal replacement retires the old display. Old connection, selection, cache-load and history completions cannot replace newer live state; an older disk cache also cannot replace newer authoritative history already held in memory after a failed reconnect.

Cache work uses immutable bounded projections, a single serial coalescing worker and the cache's CAS revision. Owner updates are serialized and fenced, preventing delayed older updates from rebinding a later saved configuration. Cache-local validation, bounds, revision-conflict and adapter rejection errors are caught without themselves changing send outcomes. A failed scoped writer stops rather than retrying stale data or overwriting unsupported records. Cache work has its own queue, independently of draft/canonical/send persistence barriers. The shared protected repository still serializes its admitted filesystem operations: an actual durability or protection failure can disable protected writes and correctly block later send-journal barriers and sending. For example, a directory-sync failure marks repository durability uncertain; cache error handling does not bypass that fail-closed state. This change does not claim separate physical storage channels.

Explicit disconnect persists `desktop:autoConnect = false`, may clear the immediate display, and permits matching read-only cache recovery on restart with **zero** connection attempts. No cached content, unresolved journal or draft triggers an automatic send.

The main process now awaits `service.shutdown()` before repository closure. Shutdown immediately retires live action/event/prompt/selection authority and closes transport, then gives already captured cache/owner tasks a **two-second cache drain**. This is not a hard total application-exit deadline: repository close separately awaits admitted storage operations. Cache errors, timeout, abrupt disposal, crash or power loss can retain an older cache. The cache is disposable display data; send journals retain their own barriers and uncertainty rules. No cache durability/power-loss guarantee is claimed.

## Checks

Initial implementation verification on 2026-10-16 (before the resource-bounds follow-up below):

- `node --experimental-strip-types --test tests/chat-recovery.test.mjs tests/display-cache.test.mjs tests/desktop-service.test.mjs tests/desktop-api.test.mjs tests/ui-connected.test.mjs` — **61 passed**, none failed/skipped/cancelled. Includes 18 integration regressions for rejected-transport cold relaunch; disconnected startup; credential/endpoint/auth-kind mismatch; principal replacement; missing/corrupt/newer cache and owner records; delayed reads, same-scope writes and owner updates; cache failures and a held writer independent of send barriers; stale history; unknown journal/draft preservation; clean shutdown, cache deadline and late shutdown callbacks; newer in-memory history versus older disk cache. Renderer server rendering verifies the saved draft remains visible in a read-only textarea with disabled Send.
- `npm test` — **286 passed**, none failed/skipped/cancelled. Includes concurrent branch work already committed by other tasks.
- `npm run typecheck` — exit 0 for core, main/preload/shared and renderer strict projects.
- `node scripts/desktop/build.mjs` — development bundle built successfully; ignored build output only. This is not a packaged-application or physical-machine test.
- `node --check scripts/qualification/hermes-smoke.mjs` and `git diff --check` — exit 0.

The first recovery regressions ran before implementation: four failed because cache persistence/recovery did not exist; the preexisting journal-failure invariant passed. The new renderer test initially exposed a test expectation for lowercase `readonly`; RN Web's server rendering emits `readOnly`. The assertion now checks the actual rendered attribute. A later self-review added the regression preventing an older disk cache from replacing newer in-memory authoritative history after reconnect failure.

## Resource-bounds review fix

The whole-branch review reproduced unbounded memory retention before the protected cache applied its stored-record bounds. A held writer retained a full projection for every update; a separate histories map kept removed sessions indefinitely. Both were implementation defects, addressed in this follow-up.

`normalizeDisplayCache(scope, data)` is now a shared pure admission boundary using the existing strict validation, deterministic oldest-history trimming and complete one-MiB repository-envelope budget. Recovery applies it synchronously before retaining any input. The active projection has at most 256 profiles/sessions, 512 rows per session and 4,096 aggregate rows. Invalid inputs are not retained and do not throw into live consumers. Removed catalog sessions have no hidden history map from which to reappear; successful writes adopt the normalized saved projection when no newer update has replaced it.

One worker serializes the current single-host service's cache work across scopes, preserving CAS without retries. During a held write, updates replace the sole latest bounded projection and dirty marker. There is at most one admitted write projection and one latest active projection, plus an optional bounded cache seed before the first live catalog. Each logical projection obeys the one-MiB envelope limit. Normalization and repository codecs can allocate temporary working copies; this is not a claim about an exact total JavaScript heap ceiling. There is no per-update promise/snapshot backlog or per-retired-scope queue. Activation immediately clears the previous context's retained projection and seed. Retired handles cannot add histories, and pending owner updates are coalesced to the current scope. A previously admitted old-scope write may finish; the worker checks current ownership before adoption and loads the current scope's own revision afterward.

Deterministic regressions first failed against the reviewed implementation: 100 updates behind a held writer produced 101 writes instead of two; the exposed active projection exceeded its byte budget; removed histories reappeared; and retired handles retained their projections. After the fix, those 100 updates produce exactly the admitted write plus one latest write. Additional cases cover bounded pre-storage projection bytes/rows, 100 rotating catalogs, 100 superseded scopes while a write is held, late cache reads, external CAS winners without retries, invalid authority-bearing history, and pure normalization's detached immutable result. Assertions use write counts, exact state and resurrection checks rather than unstable process-heap thresholds.

Follow-up verification on 2026-10-16:

- `node --experimental-strip-types --test tests/chat-display-recovery-resources.test.mjs tests/chat-recovery.test.mjs tests/display-cache.test.mjs` — **36 passed**, none failed/skipped/cancelled (seven resource regressions, 18 existing lifecycle regressions, 11 cache contract tests). Local log: `/tmp/bighelp-task-3-resource-fix.log`.
- `node node_modules/typescript/bin/tsc -p config/tsconfig.core.json` and `node node_modules/typescript/bin/tsc -p config/tsconfig.desktop.json` — exit 0.
- `git diff --check` on owned files — exit 0. No full suite or desktop build during concurrent review fixes; the controller owns subsequent integrated verification. No host operations were performed by this fix agent.

## Disposable-host qualification script

`scripts/qualification/hermes-smoke.mjs` remains restricted to loopback and independently checks zero configured providers before any prompt, including a fresh check immediately before submission. It now resolves canonical Bot Chat twice to the same actual saved identity, verifies ordinary New chat is distinct, waits for authoritative provider-free saved history to reach the protected display cache, and reconstructs service **and repository** with the same synthetic encryption adapter. A rejected transport restores exact saved history read-only. A second reconstruction after explicit disconnect makes zero connection attempts and still permits cached selection. Every reconstruction awaits `shutdown()` before `repository.close()`.

The implementation agent did not start any host or execute the live script. The controller runs the authorized disposable Hermes after implementation review. The synthetic AES-GCM adapter demonstrates repository reconstruction only; it does not qualify Electron safeStorage, OS key protection, user lock/revocation, hardware, or power-loss persistence. Test logs are local temporary files, not committed user/host content.

## Sources and limits

- `AGENTS.md`, `docs/IMPLEMENTATION_PLAN.md`, `docs/plans/2026-10-16-chat-recovery.md` and `docs/contracts/STATE_AND_SECURITY.md` sections 2, 4 and 5: exact authority scopes, Hermes-owned history, immutable projections, independent protected cache/journals/drafts, stale callbacks and no automatic resubmission.
- Shipping Catalyst baseline `d62a545386fb1b63f8ca33365766a46b3b1bd636`, mapped by `docs/SOURCES.md`: `Bighelp/DirectHermes/DirectHermesSessionActions.swift`, conversation/store clients, and `docs/CHAT_INTERACTION_CONTRACT.md`. This slice follows the converted contract and adds no wire operation.
- Disposable Hermes source baseline `3b2f971133e4e011022ccf33dc6dc1c9050563d8`; canonical wire source evidence is separately recorded in `docs/evidence/canonical-chat.md`.
- Existing `packages/platform/protected-repository.ts` and `packages/platform/display-cache.ts`; bounded display schema and immutable/CAS guarantees in `docs/evidence/display-cache.md`.

No new dependencies, transport hosts, function-page layouts, calendar/reminders, production changes, signing, release, merge or push. Windows/Ubuntu CI and physical Windows 11/Linux UI, OS storage and accessibility qualification remain separate; this increment does not establish full product parity.
