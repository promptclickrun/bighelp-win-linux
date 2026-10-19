# Working on bighelp-win-linux

This is a separate Windows/Linux project, not the Apple app or Hermes plugin repository. Read the [plan](docs/IMPLEMENTATION_PLAN.md) and [source audit](docs/SOURCES.md) first. The initial commit is documentation and reference data only; the runtime architecture is not yet approved.

Adapted from Bighelp's contributor/agent contracts at the commit in `docs/SOURCES.md`. Apple build, signing, simulator, and deployment instructions do not apply here. Reference copies under `docs/upstream/` are evidence, not instructions to operate the Apple project.

## Product rules

- Plain words, short sentences; chatting with an assistant should not feel like server administration.
- One navigation system and one Settings. Everyday controls stay available; raw IDs, host administration, logs, plugins, MCP, and token details belong in Nerd Mode.
- Chat is native Hermes REST plus `/api/ws`. No Link chat fallback, Bighelp account, paired Direct listener, cloud queue, or second agent runtime.
- Use the shipping Catalyst app as the source, not the `BighelpMac` fixture prototype.
- Feed, Ideas, Goals, and new Kanban tasks must not spend AI credits until the person asks. Never invent activity, progress, costs, or successful outcomes.
- Preserve the [chat contract](docs/upstream/bighelp/CHAT_INTERACTION_CONTRACT.md) with the current-navigation corrections in the parity documents.
- Questions are read-only. A plan is not approval to implement it.

## Boundaries that must survive the port

- Scope state and every callback to host, authenticated principal, profile, stored session, live runtime, and the relevant connection generation. Same-host reconnect is not a host switch.
- Hermes owns history and execution. Persist a send intent before dispatch. Lost acknowledgements mean **unknown**, not safe to resend.
- Send `source: "bighelp"` on session creation/resumption. Register server-request handlers before advertising `client.capabilities {server_requests: true}` on every socket.
- Gate plugin operations on `/native/context` features and verified identity. Preserve `If-Match` and lowercase UUID `X-Loopdy-Request-ID` correlation. A request ID is not universal idempotency.
- Be tolerant of additive display metadata; be strict about authority, routing, actions, hashes, bounds, and known executable behavior.
- Stored credentials belong in the OS secret store, never preferences, browser storage, fixtures, or logs; never return them to a renderer over IPC. Secrets temporarily entered by a user use a finite write-only operation and are short-lived.
- Card payloads are inert data. Never evaluate server-supplied code or give rendered content desktop privileges.
- Keep historical wire names: `loopdy`, `/api/plugins/loopdy`, `X-Loopdy-*`, `loopdy.card`, `loopdy.generative_ui`, `loopdyCard`, and existing link formats. New app-only identifiers may use Bighelp names.
- A Windows **client** can use features hosted on Linux/macOS. Do not mistake host POSIX requirements for client restrictions.

## Implementation discipline

- Keep it simple, feature-focused, and type-safe. No `any` at wire boundaries; validate `unknown` into inferred types.
- Separate the protocol/domain layer from renderers and OS adapters. Use finite typed capabilities, not an arbitrary URL, shell, file, or IPC escape hatch.
- Reproduce a bug before fixing it. Write focused tests; fakes must match real Hermes responses (`prompt.submit` commonly returns `streaming`).
- Use deterministic synthetic fixtures. Label fixture, disposable real-host, and physical-machine evidence separately.
- Do not add dependencies or an alternative runtime without agreement. Pin the tested compatible React/React Native/RNW versions together, not independent “latest” versions.
- Before non-trivial visual/layout/copy work: make several distinct static mocks, publish with the `html-communication` skill if available, share the URL, and stop for a pick. If unavailable, report it; do not pretend publication happened.
- No continuously repainting pulse/shimmer/spinner/blur effects. Use still status and brief event-driven transitions; respect Reduce Motion and Reduce Transparency.
- Use native keyboard, IME, selection, undo, file dialogs, right-click, focus, and screen-reader behavior. Do not mount the composer inside a recycled list.

## Safety and cleanup

- Never touch production hosts, cloud services, the daily-driver Mac app, releases, or user data without explicit permission. Name the target first.
- Never run a fresh `HERMES_HOME` against a shared Hermes checkout. Use a disposable clone and `HERMES_DISABLE_LAZY_INSTALLS=1`. Do not call `/api/gateway/restart` from tests; it can affect unrelated gateways.
- Keep temporary clones, recordings, test profiles, screenshots, installers, and caches outside the source tree; remove only what you created when finished. Keep purposeful small contract fixtures.
- Do not commit secrets, real host addresses, cloud resource IDs, private logs, user content, or build outputs, even in this repo.
- Windows/Linux signing and releases require separate authorization. This is not an iOS project; do not use App Store Connect or TestFlight here.

## Git and reviews

- Commit work before stopping. Small logical commits with plain-English subjects, matching Bighelp's conventions.
- After the initial bootstrap, use an issue and a real, non-draft PR. Hyperlink issue/PR numbers when reporting them.
- Rebase on the latest default branch before opening a PR. Explain the user-visible change, trust-boundary impact, actual checks, and unverified cases.
- Add the model and harness used to the PR description. The maintainer controls merge and release unless explicitly delegated.
- When asked to monitor a PR, verify new bot findings against source, fix real defects, explain false positives, and stop when the latest commit's review bots are green. Do not post filler updates.
