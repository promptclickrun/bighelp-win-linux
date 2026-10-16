# Protected display-cache evidence

The main-only cache in `packages/platform/display-cache.ts` stores bounded, protected display projections independently of drafts, send journals and live runtime authority. Verification uses `tests/display-cache.test.mjs`.

## Contract

`createDisplayCache(repository)` requires only the existing repository's `read` and `write` methods. It provides:

- `read({hostId, principalId})`: frozen copied `{revision, data}` or `null`; invalid data throws.
- `replace(scope, expectedRevision, data)`: validates/copies input before its first await, trims disposable history, validates existing schema/identity, and performs repository CAS. Returns frozen `{revision, data}`. Conflicts are never retried.
- `displayCacheKey(scope)`: version-independent namespace with a SHA-256 hash of the exact JSON identity tuple; avoids delimiter collisions and prevents older versions hiding newer data under another key.

Data holds a host label, profiles with exact `profileId`, and sessions with exact `profileId`/`storedSessionId`, title, preview, local `historyUpdatedAt`, and safe day/message/tool transcript rows. `historyUpdatedAt` means when authoritative history was observed locally, never host execution time, runtime ownership or proof that a send completed. Transcript order is oldest to newest.

The schema strictly rejects extra fields, including runtime IDs, credentials, prompts, actions, `canSend`, pending/unknown delivery, and generation/lease state. It rejects duplicate routing pairs, duplicate rows, unlisted profiles, malformed IDs, invalid property descriptors, oversized fields, and unsupported versions. Returned nested objects/arrays are detached and frozen. No cache field grants selection, execution, prompt, send or authentication authority.

## Bounds and trimming

- At most 256 profiles and 256 sessions; catalog excess is an explicit error.
- Input: at most 8,192 rows/session and 16,384 aggregate, 60,000 display strings and 64 MiB of display text. Fields have individual UTF-8 limits; those bounds are checked before encoding.
- Stored output: at most 512 rows/session and 4,096 aggregate.
- At most 1 MiB for the *complete existing protected-repository plaintext envelope*, including its key, version, value and a reserved maximum-safe-integer revision.
- First retain each session's newest 512 rows. Then trim oldest history by local observation time, exact profile ID and exact stored-session ID, removing oldest rows first. Catalog order remains intact. Byte accounting removes each row's actual UTF-8 JSON bytes and comma overhead, with a final whole-envelope check.
- Catalog metadata is retained. If it alone cannot fit, replacement fails and leaves the previous revision intact. Trimming does not imply the removed rows ceased to exist on Hermes.
- Unsupported/corrupt existing records are never overwritten, even with a matching revision. There is deliberately no migration, deletion, or retry API in this slice.

## Verification

Synthetic fixtures only; no network/host operations.

1. `node --experimental-strip-types --test tests/display-cache.test.mjs` — 10 tests passed, 0 failed. Covers authenticated-encryption roundtrip/reopen, immutable detached data, exact host/principal isolation and delimiter collisions, exact profile/session pairs, corruption/newer-version preservation, prohibited authority fields, invalid descriptors/identity/catalog sizes, stale replacement, concurrent CAS, deterministic oldest-history trimming, UTF-8/envelope size, per-session and aggregate row caps, and catalog-only oversize preservation.
2. `npm test` — 238 passed, 0 failed, 0 skipped at verification time (shared worktree, including concurrent task changes).
3. `npm run typecheck` — exit 0, core/desktop/renderer projects.
4. `git diff --check` — exit 0 before report/commit.

## Sources and boundaries

- `AGENTS.md`; `docs/IMPLEMENTATION_PLAN.md`; `docs/SOURCES.md` pinned shipping Catalyst baseline `d62a545386fb1b63f8ca33365766a46b3b1bd636`.
- `docs/contracts/STATE_AND_SECURITY.md` sections 2, 4, 5: stable authority scope, Hermes-owned history, copied snapshots/revision checks, protected cache independent of sends/drafts.
- `packages/platform/protected-repository.ts`: existing encrypted CAS API, one-MiB plaintext envelope, JSON complexity and encryption backend checks.
- `packages/contracts/workspace.ts`: exact profile identifier validation.
- `packages/ui/view-model.ts`: inert transcript/display shapes; cache intentionally excludes delivery state.

No wire operations added. No live Hermes or shipping-app operation was required. Disposable Hermes baseline `3b2f971133e4e011022ccf33dc6dc1c9050563d8` is the enclosing recovery effort’s source constraint; this module does not speak to Hermes.

Limits: main-only placement follows the repository's existing privileged-module convention; offline publication and authenticated-principal/credential-fingerprint binding remain the controller's integration responsibility. Encryption uses the provided protected repository and its OS adapter; tests use synthetic AES-GCM and do not qualify physical Windows/Linux secret stores. Raw text may contain user prose; structured credential/runtime fields are rejected, but no classifier can reliably identify a credential pasted into ordinary prose. Cache/catalog failures are ordinary integration errors and must not become unknown-send outcomes. No physical-machine, signing, release or real-host claims.

Implementation commit: `5357fdf` (`Add bounded protected display cache`).
