# Planning-pass validation

Date: **2026-10-15**. Scope: this repository's documentation and pinned reference data. No desktop app was built, run, installed, signed, or released.

## Checks performed

- Parsed all **71 JSON files**, rejecting duplicate keys.
- Verified all **109 imported files** against source and destination SHA-256 values in `upstream-manifest.json`; unchanged JSON/schema/license bytes match their pinned upstream files.
- Checked **112 local Markdown file-link targets** and **607 unique pinned upstream Markdown source URLs** against the source trees. No stale upstream file paths found. External-site availability and every Markdown heading anchor were not tested.
- Checked inventory counts; all **140 central Swift dispatch excerpts** and **112 Python boundary-model excerpts** match their pinned source ranges.
- Confirmed all **36 native capability names** in the source index appear in the plugin conversion contract.
- Validated both imported schemas as JSON Schema Draft 2020-12 and resolved **99 local schema references** without fetching remote schemas.
- Checked the six `loopdy-card-v1` examples against the imported card JSON Schema: both static examples pass; the private-URL example and all three reserved live-data examples fail, as expected for the static-only schema.
- Confirmed all 16 generated-UI vectors named by their manifest exist. Their domain validators were **not** run.
- Compared 43 workflow fixtures to the app baseline: 40 match, with three additive differences documented in the [fixture README](fixtures/README.md).
- Scanned documentation/imports for common credential and deployed-resource-ID patterns; no production credentials/configuration markers found. Synthetic notification test keys remain clearly labeled. Pattern scanning is not a comprehensive security audit.
- Verified the GitHub repository is private and its `origin` is `promptclickrun/bighelp-win-linux`.
- Checked the staged diff for whitespace errors. Imported upstream prose intentionally retains its original whitespace; `.gitattributes` excludes those two reference directories from whitespace lint and keeps text/JSON checkout line endings stable across platforms.

Python's already-available `jsonschema` package was used for schema checks; no project runtime dependencies or OS toolchains were installed. Temporary source clones and one-off audit scripts are not product files and are removed after verification.

## What this does not prove

The schema checks do not run the full Python/Swift canonical hash, cross-field, byte-limit, cryptographic or runtime validators. Parsing a negative JSON fixture is not accepting its contract. Source excerpts do not prove route availability on a running host.

Still pending: architecture approval; actual RNW/Linux builds; exact Hermes host-version qualification; all authentication/reconnect/uncertainty integration tests; renderer/IME/accessibility/performance checks; visual captures and mock approval; desktop audio/device/notification parity; asset licensing; signed packaging and updates. See the [implementation gates](../IMPLEMENTATION_PLAN.md).
