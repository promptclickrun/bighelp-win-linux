# Security policy

Adapted from Bighelp's security policy at the baseline in [docs/SOURCES.md](docs/SOURCES.md).

## Report privately

Do not open a public issue for a suspected vulnerability. Use GitHub private vulnerability reporting/security advisories if available; otherwise contact the maintainer through an existing private channel and agree on a secure reporting path before sending details.

Include the affected commit/build, expected impact, a synthetic reproduction, redacted evidence, and a possible mitigation. Do not include credentials or real user content. This policy does not create a bounty or safe harbor.

## Research boundaries

Use only devices, accounts, services, and disposable Hermes hosts you own or are explicitly authorized to test. Do not target production availability, enumerate users, extract credentials, send unsolicited notifications, or test third-party infrastructure without permission.

## Port-specific requirements

- Treat Hermes responses, Markdown, cards, media, links, imported files, and IPC input as untrusted.
- Preserve exact-origin authentication, strict redirect policy, owner-scoped state, and explicit write confirmation.
- Never expose credentials, arbitrary filesystem access, arbitrary network access, or a shell to the UI renderer or generated content.
- Require an OS-backed secret store. On Linux, a missing/locked Secret Service is an actionable state, not permission to save plaintext.
- Bound decoded bytes, image dimensions, frame counts, decompression, file downloads, audio, cache growth, and pending requests.
- Unknown write outcomes require reconciliation. Do not replay sends, approvals, uploads, installs, or Git mutations blindly.
- Desktop notification, device-tool, browser-callback, update, and native-module boundaries require security review before release.

See the full [state and security contract](docs/contracts/STATE_AND_SECURITY.md).
