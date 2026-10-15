# Portable contract fixtures

Synthetic upstream JSON, imported byte-for-byte from the pinned plugin revision. Provenance and SHA-256 are in [upstream-manifest.json](../upstream-manifest.json). These files are **data**, not executed tools, real credentials, or proof of a working desktop client.

| Bundle | Contents / intended use |
|---|---|
| `workflows-v1/` | 43 request/response/error vectors covering base, v2 graph/editing and v3 code workflows. The directory name is historical; do not assume every definition is v1 |
| `loopdy-card-v1/` | 6 static/reserved/negative card examples. `static-metrics` and `static-weather-background` are the current inert-display examples; `live-*` files do **not** authorize remote data sources |
| `generative-ui-v2/` | 16 positive/negative vectors plus their `manifest.json` expectations; generated UI is a different schema from `loopdy.card` |
| `sealed-alert-v2-vector.json` | Host-sealed notification cryptographic vector with **test-only** keys and synthetic content |
| `../schemas/` | `loopdy-card-v1.schema.json`, `loopdy-card-template-v1.schema.json`; additional cross-field/bounds/canonicalization checks still live in source validators |

No retired Link relay vectors, binaries, app data, or downloaded media are imported. URLs/symbols inside examples stay inert during tests unless a test explicitly supplies a synthetic controlled fetcher. Never use vector keys for real enrollment or notifications.

## App/plugin fixture drift

The 43 plugin workflow vectors were compared with the pinned app's `BighelpTests/Fixtures/Workflows/`. **40 match byte-for-byte**. The plugin versions imported here differ in three files:

- `list-v2.json`: adds manual `trigger` metadata to workflow summaries.
- `get-v2.json`: adds a manual trigger to the workflow definition/projection.
- `runs-get-text-runner.json`: adds stage `uses` and sign-off `decisions` metadata.

These are additive source-baseline differences, not file corruption. Keep tolerant optional-field decoding and test both legacy omissions and new metadata when implementing. Do not claim the app and plugin bundles were already identical.

## Intended validation layers

1. Planning pass: valid JSON syntax, import/source hashes, expected vector files, schema reference integrity, source links and inventory consistency.
2. Contract implementation: actual validator acceptance/rejection per manifest, strict executable fields, inherited Python constraints, safe-integer and size limits, canonical hash parity and sealed-alert cryptography.
3. Integration: real disposable host request/response behavior and both desktop-renderer lifetimes.

Only checks actually recorded in [validation notes](../VALIDATION.md) have run. No app build or runtime contract test exists yet.
