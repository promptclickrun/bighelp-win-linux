# Privileged transport policy evidence

Scope: [issue #3](https://github.com/promptclickrun/bighelp-win-linux/issues/3), based on merged [PR #2](https://github.com/promptclickrun/bighelp-win-linux/pull/2). This is a dependency-free policy module and scripted adapter proof. **There is no Electron/OS/network adapter or renderer bridge yet.**

## Source-backed finite surface

`packages/platform/transport-policy.ts` accepts named operations, not caller-provided paths, URLs, methods, request headers or bodies.

| Operation | Fixed route | Contract |
| --- | --- | --- |
| `status` | GET `/api/status` | [Hermes API §2](../contracts/HERMES_API.md#2-discovery-and-authentication) |
| `providers` | GET `/api/auth/providers` | Same |
| `identity` | GET `/api/auth/me` | Same |
| `health` | GET `/api/health` | Same |
| `nativeContext` | GET `/api/plugins/loopdy/native/context` | [Plugin API §2](../contracts/PLUGIN_API.md#2-native-context-and-request-envelope) |
| `templateList` | POST `/api/plugins/loopdy/native/cards/templates/list` with exactly `{agentId}` | [Native workspace API](../upstream/plugin/NATIVE_WORKSPACE_API.md#card-templates) |
| Internal ticket mint | POST `/api/auth/ws-ticket` with exactly `{}` | Hermes API §2 |
| Socket attempt | `/api/ws`, `wss` or explicitly approved private `ws` | [Hermes API §3](../contracts/HERMES_API.md#3-gateway-websocket-contract) |

Template list retains exact `If-Match` and canonical lowercase UUID `X-Loopdy-Request-ID`, validates the success echoes, and never treats correlation as idempotency. Native-context results preserve the canonical ETag for a separate verified context/capability layer. Every other response body remains `unknown`, not a claimed validated feature DTO. The module does not create sessions, submit prompts, expose generic RPC send, or invent endpoint payloads.

## Exported API and ownership

- `parseEndpoint(value: unknown, approvedPrivateHttpOrigin?: unknown): Endpoint`: copies/freeze canonical HTTP and paired socket origins.
- `parseHttpOperation(value: unknown): HttpOperation`: finite strict input decoding; unknown executable fields fail.
- `createTransportPolicy(configuration: unknown, adapters: TransportAdapters)`: captures copied credentials/proxy headers and the endpoint. Returns frozen `request(operation, signal)` and `createSocketAttempt(onFrame)` functions.
- `request` returns `Promise<HttpResult>`: `{body: unknown, etag?, requestId?}`. Only selected native metadata is returned; arbitrary response headers/cookies are not propagated.
- Each socket attempt exposes a one-use `open(signal): Promise<SocketHandle>`. Concurrent/repeated calls fail before I/O. The returned handle only closes this socket. No generic send/network/file/shell interface is exposed.
- Exported types: `Endpoint`, `HttpOperation`, `HttpResult`, `HttpPlan`, `SocketPlan`, `SocketHandle`, `TransportAdapters`.

Configuration shape is `{endpoint, approvedPrivateHttpOrigin?, authentication: {kind: 'provider' | 'dashboard', token}, proxy?: {custom?: [{name,value}], cloudflare?: {clientId,clientSecret}, basic?: 'Basic <encoded credential>'}}`. This is **privileged setup**, never renderer-readable or renderer-controlled configuration. Tokens, socket query strings, subprotocols, and plans must never be logged or sent over IPC. No stored credential access is implemented.

The connection coordinator supplies `isCurrent()` for one immutable verified lease. It must include host/endpoint, principal, authentication generation, connection generation, and any applicable profile/session coordinates. It must not become true again after replacement. Transport does not duplicate a connection registry. Coordinator retirement must also abort the lifetime signal or close the returned socket, including when no callback is arriving. Checks run before dispatch, after awaits, and before every frame callback. Retirement during socket creation closes a late-arriving handle; retired callbacks stay silent.

AbortSignal is passed through HTTP and socket adapters. Late completion is rejected even if a double ignores abort. Prompt rejection/cancellation of a permanently pending adapter requires the real adapter to honor abort; this module does not add timers or polling. Closing this transport never sends a host interrupt or cancels accepted Hermes work.

## Security policy implemented

- Root HTTP(S) endpoints only. Reject userinfo (including empty userinfo), fragments/queries (including empty delimiters), backslashes, control/whitespace repair, percent escapes, base paths, dot segments, encoded/double-encoded path tricks, and numeric IPv4 aliases.
- HTTPS canonicalization retains effective port and exact origin. All route suffixes are internal literals. No arbitrary URL is resolved against the base.
- Plain HTTP requires separately supplied consent matching the canonical origin exactly. Allow only canonical literal RFC1918 IPv4, IPv4 loopback, CGNAT `100.64.0.0/10`, IPv6 loopback or IPv6 ULA. Public, link-local/metadata, unspecified, IPv4-mapped IPv6 and DNS-named HTTP hosts fail closed. CGNAT is a local policy choice to cover private VPN/Tailscale addresses, not proof every CGNAT network is trusted.
- HTTP plans require redirect refusal and no ambient cookies. Responses must report the exact requested URL and `redirected: false`; all non-2xx responses fail without retry. A post-response check is defense in depth, **not proof that a nonconforming adapter did not already forward credentials**.
- WS plans forbid redirects/cookies and use the paired exact socket origin. Provider sockets carry `hermes-gateway-v1` and `hermes-gateway-ticket.<ticket>`, not the provider bearer. Dashboard sockets retain the sensitive `?token=` and `X-Hermes-Session-Token` wire behavior.
- Provider attempts mint a new ticket each time, never reuse the attempt after success/failure, validate URL-safe bounded token and finite positive TTL at most 300 seconds, and conservatively measure expiry from ticket-request start. A slow response or backwards clock fails. `ticketExpiresAt` is passed to the adapter so queuing cannot silently outlive freshness. The adapter must use the same monotonic clock and initiate only one handshake before that deadline.
- Up to 16 custom headers, copied/frozen, with case-insensitive duplicate rejection and no control/non-ASCII/header-injection values. Reserved auth, cookie, transport, content, conditional, forwarding and legacy Hermes/Loopdy/Cloudflare namespaces cannot be overridden.
- Cloudflare Access requires HTTPS and is exclusive with proxy Basic. Basic plus dashboard-session auth is supported. Provider bearer plus proxy Basic fails closed because both claim `Authorization`; no alternate bearer wire header is invented.
- HTTP/socket adapter exceptions are replaced by fixed nonsecret messages, without retaining their causes. There is no automatic retry or credential refresh.

## Synthetic verification

Commands: `npm test` and `git diff --check`.

Final result: **52 passed, 0 failed**, including **22 transport tests**, using Node **22.23.0** on the **macOS/Darwin development host**. No dependencies or toolchains were installed. Node's type stripping is not a strict TypeScript compilation gate.

Covered: malicious origins and URL repair; private-HTTP consent, port/protocol changes and address boundaries; finite operations; fixed legacy routes/headers and response correlation; copied proxy/auth configuration; reserved headers/injection; redirects without retry; provider/dashboard socket differences; one-shot concurrent opens; ticket TTL/token/clock failures; cancellation/staleness during HTTP/ticket/socket awaits; final-await ownership race; post-retirement callbacks; credential-bearing adapter-error redaction. The frame double uses the real `result: {status: 'streaming'}` receipt shape. Transport forwards it as opaque data and does not claim it completed a turn.

The first full test run reproduced an HTTP adapter-error redaction failure (47 passed, 1 failed); the fixed transport suppresses adapter details. Final tests include both HTTP and socket exception paths.

## Remaining adapter and integration gates

1. Approve dependencies, strict TypeScript compiler/config and real Electron main/preload adapters. Validate IPC sender/frame and expose separate finite feature operations with safe validated outputs, never these privileged configuration/plan objects.
2. Prove TLS verification, actual HTTP/WS redirect refusal, cookie isolation, no environment/proxy/connection-pool destination rewriting, compressed/raw streaming byte limits, duplicate critical headers/JSON keys, bounded parsing and socket framing. `maxResponseBytes` is an adapter obligation, not a proven network allocation bound. Existing context/template bounds are 16 KiB/196608 bytes; the 64 KiB small-stock-response and 16 KiB ticket limits plus 4096-character ticket and input/header ceilings are conservative local policy choices, not claimed upstream constants.
3. Root-only endpoints and literal-only private HTTP intentionally exclude reverse-proxy path prefixes and private DNS names. Add only after documented prefix semantics and a pinned, revalidated resolver/dialer proof; `.local` or a private DNS answer is not sufficient by itself.
4. Complete provider-plus-Basic compatibility from actual upstream implementation evidence. Provider/password/PKCE bootstrap, browser callback listener, token rotation, public assets and other sockets/routes are outside this slice. Weak/compression ETag wrappers currently fail closed; only canonical ETags are accepted until the narrowly documented normalization has its own fixtures.
5. Feature clients must verify authentication principal, plugin features/runtime, process/profile authority and operation-specific DTOs. Passing `templateList` syntax and echoes is not authorization. Consumers must recheck their own lease after awaiting this API before publication.
6. Injected adapters must return nonthrowing, idempotent socket `close`, honor abort, use the ticket deadline before actual handshake, reject redirects during handshake, and avoid replaying connection attempts. Gateway readiness/capability/server-request negotiation and framing belong to the connection/protocol lanes, not this policy.
7. Disposable real-host behavior and **Windows 11 / Ubuntu 24.04 Wayland/X11 acceptance remain untested**. No production host, cloud service, daily-driver app, real credential, installer, OS storage, or UI was touched.
