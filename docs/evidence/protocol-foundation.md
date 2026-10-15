# Bounded protocol foundation

Implementation lane for [issue #3](https://github.com/promptclickrun/bighelp-win-linux/issues/3), based on merged [PR #2](https://github.com/promptclickrun/bighelp-win-linux/pull/2). This is dependency-free protocol/domain infrastructure, not an application, a live-host compatibility result, or Windows/Linux acceptance.

## Source receipts

The app evidence is pinned to `d62a545386fb1b63f8ca33365766a46b3b1bd636`, as recorded in [SOURCES.md](../SOURCES.md). No Apple implementation code or runtime dependency is imported.

| Behavior | Evidence |
|---|---|
| Text frames contain newline-delimited objects, not JSON-RPC array batches; events, string-ID requests, results, errors are distinct | [DirectHermesInterfaces.swift, 436–539](https://github.com/promptclickrun/bighelp/blob/d62a545386fb1b63f8ca33365766a46b3b1bd636/Bighelp/DirectHermes/DirectHermesInterfaces.swift#L436-L539) |
| 4 MiB inbound, 4,096 line objects, 256-byte methods, 1,024-byte IDs; exact cancellation payload; 2 MiB server response | [DirectHermesInterfaces.swift, 436–605](https://github.com/promptclickrun/bighelp/blob/d62a545386fb1b63f8ca33365766a46b3b1bd636/Bighelp/DirectHermes/DirectHermesInterfaces.swift#L436-L605), [Hermes API §3](../contracts/HERMES_API.md#3-gateway-websocket-contract) |
| 64 pending outbound requests, 2 MiB general outbound frames | [DirectHermesNetworking.swift, 82–85](https://github.com/promptclickrun/bighelp/blob/d62a545386fb1b63f8ca33365766a46b3b1bd636/Bighelp/DirectHermes/DirectHermesNetworking.swift#L82-L85) |
| Register only actual handlers; advertise `client.capabilities {server_requests:true}` once per connected socket, with a 15-second deadline | [DirectHermesNetworking.swift, 331–361](https://github.com/promptclickrun/bighelp/blob/d62a545386fb1b63f8ca33365766a46b3b1bd636/Bighelp/DirectHermes/DirectHermesNetworking.swift#L331-L361) |
| `gateway.ready` resumes opening; advertisement follows open. A repeated ready is invalid; early server responses wait for ready | [DirectHermesNetworking.swift, 620–668](https://github.com/promptclickrun/bighelp/blob/d62a545386fb1b63f8ca33365766a46b3b1bd636/Bighelp/DirectHermes/DirectHermesNetworking.swift#L620-L668) |
| Default RPC timeout is 45 seconds; readiness timeout is 20 seconds | [DirectHermesNetworking.swift, 327–328](https://github.com/promptclickrun/bighelp/blob/d62a545386fb1b63f8ca33365766a46b3b1bd636/Bighelp/DirectHermes/DirectHermesNetworking.swift#L327-L328), [620–626](https://github.com/promptclickrun/bighelp/blob/d62a545386fb1b63f8ca33365766a46b3b1bd636/Bighelp/DirectHermes/DirectHermesNetworking.swift#L620-L626) |
| Reconnect obtains a fresh socket/ticket and never resends pending RPCs | [DirectHermesNetworking.swift, 268–288](https://github.com/promptclickrun/bighelp/blob/d62a545386fb1b63f8ca33365766a46b3b1bd636/Bighelp/DirectHermes/DirectHermesNetworking.swift#L268-L288) |
| Unknown server methods receive `-32601`; duplicate IDs cannot create a second decision | [DirectHermesNetworking.swift, 680–705](https://github.com/promptclickrun/bighelp/blob/d62a545386fb1b63f8ca33365766a46b3b1bd636/Bighelp/DirectHermes/DirectHermesNetworking.swift#L680-L705) |
| `gateway.capabilities` requires boolean `per_session_exclusive_submit`; independent reads remain usable when false | [DirectHermesCapabilityManifest.swift](https://github.com/promptclickrun/bighelp/blob/d62a545386fb1b63f8ca33365766a46b3b1bd636/Bighelp/DirectHermes/DirectHermesCapabilityManifest.swift), [Hermes API §§3–4](../contracts/HERMES_API.md#3-gateway-websocket-contract) |
| `prompt.submit` accepts exact runtime/profile/text; `streaming` is accepted, nonterminal | [Hermes API §§3–4](../contracts/HERMES_API.md#frame-shapes), existing `packages/domain/text-send.ts` |

`gateway.ready` is an event, not the response to `client.capabilities`. Waiting for capability advertisement before processing ready would deadlock the source ordering. This implementation registers a copied finite handler map before `transport.start`, waits for ready, advertises if any handlers exist, waits for that response, then probes the gateway manifest. It does this for each new connection.

## Implemented surface

- `packages/contracts/rpc.ts`: `decodeRpcFrame`, `encodeBoundedJson`, `encodeServerReply`, `boundedString`, `rpcId`, `rpcMethod`, `jsonObject`, `RPC_LIMITS`, `RpcProtocolError`; discriminated `RpcFrame` and JSON/response types.
- `packages/contracts/rpc-methods.ts`: `encodeProbe` for exactly `client.capabilities`, `gateway.capabilities`, `gateway.ping`; `encodeTextRequest` for the existing `TextRequest`; `parseGatewayCapabilities`; finite `SERVER_REQUEST_METHODS` and handler method type.
- `packages/hermes-client/connection.ts`: `createConnectionRegistry`, `CONNECTION_LIMITS`, `ConnectionError`, and lease/transport/handler/receipt types. Its returned object exposes `connect`, `disconnect`, `snapshot`, `markReconciled`, `ping`, `submitText`.

No public `request(method, arbitraryParams)` API exists. The low-level frame codecs belong in the privileged protocol layer, not preload/renderer IPC. No session create/resume builder is added; their required `source: "bighelp"` contract is unchanged.

### Codec behavior

The parser validates the whole text frame before delivering any of its objects. It checks input UTF-8 size without first allocating an encoded copy, enforces nesting while parsing, rejects duplicate decoded property keys (including escaped aliases), freezes decoded arrays and null-prototype objects, and rejects malformed Unicode, unsafe integers, and nonfinite numbers. It only uses `JSON.parse` for individually bounded string tokens, not the unchecked input frame.

Results cannot also contain errors, methods, or request params. Event IDs are forbidden; server request IDs are echoed exactly, including Unicode normalization differences. Additive inert result/event metadata survives. Cancellation requires exact `{id,method,reason}` and retires only a matching ID/method pair.

Outbound serialization budgets escaped UTF-8 bytes before assembling the final string. It rejects cycles, accessors, sparse arrays, non-JSON values, and custom prototypes; it never invokes `toJSON`. Server handler output must contain only `result` or `error`, so it cannot override `id` or `jsonrpc`. This is validation of data, not a sandbox for hostile JavaScript proxies supplied by privileged code.

### Connection ownership and uncertainty

Every entry point, frame, deadline, asynchronous handler completion, and response publication checks the captured owner and local connection generation. Owner coordinates come from the existing domain `Owner`: host, principal, profile, stored session, runtime, auth generation, and connection generation. Lease handles are exact object identities. A reconnect gets a new local generation even if a caller mistakenly reuses owner strings.

The registry never replays a request. Disconnect/transport failure/reclaim rejects pending text writes with `outcome-unknown`, rejects reads with `transport-unavailable`, aborts outstanding handler signals, cancels deadlines, and fences old callbacks. A text timeout also revokes the reconciliation gate. A matched receipt resolved just before owner replacement is checked again before publication. `session.reclaimed` for this session, or an unscoped reclaim, retires the socket.

Text send admission additionally requires negotiated exclusive-submit support, acknowledged server-request capability, and a trusted coordinator's explicit `markReconciled`. This flag is not a history/replay implementation or renderer-authorized action. Streaming receipts are returned in the original JSON-RPC envelope for the existing durable sender. No receipt is upgraded to terminal success.

This is deliberately a **single-session connection slot**, not a shared multi-session socket router. Other-session events are ignored; a routed server request for another runtime retires the connection without invoking a handler. Missing method-specific routing/answer validation remains a handler obligation. No generic routing fallback guesses the active session.

## Narrower local policies

These are explicit local constraints, not inferred server requirements:

- Reject duplicate keys anywhere, even additive metadata, and require finite safely represented integer values. Error messages/reasons have a 4,096-byte cap; missing/non-string error messages fail closed rather than using the source app's display fallback.
- Only text strings enter the codec. A future transport adapter must enforce frame limits before receiving/decoding large buffers and supply strictly decoded text. Binary WebSocket message support is not implemented.
- Outbound text is limited to 1 MiB, runtime/profile strings to 4,096 bytes, and the full general frame to 2 MiB. Attachment/profile-asset larger-frame exceptions are not implemented.
- Only `-32601` advertisement rejection is treated as older-host compatibility; it still disables text admission because no legacy interactive-prompt fallback exists. Other advertisement errors and invalid/missing manifests close the socket. The source client tolerates a broader class of capability rejections.
- 64 concurrent inbound handler slots and 4,096 distinct inbound/outbound IDs per socket prevent unbounded maps. Completed/cancelled IDs remain tombstones for that socket, so duplicates cannot re-run a decision or correlate a late response to a reused request ID. Outbound budget exhaustion returns `capacity`; inbound exhaustion closes the socket. A trusted coordinator may explicitly reconnect after reconciling; there is no automatic rollover/replay.
- Handler rejection/invalid output and inbound overflow retire the socket instead of silently discarding required interaction. This is stricter than the source's inbound-capacity ignore behavior.
- There is no automatic heartbeat, reconnect, cancellation wire method, legacy event-based prompt response, session adoption/replay, or full gateway operation catalogue. `request.cancel` is only consumed as the documented inbound event.

## Adapter and integration obligations

1. Keep this API in privileged/domain code. Use reviewed finite IPC capabilities; never expose the injected transport or low-level encoders to rendered content.
2. `currentOwner` exposes verified identity. Immediately disconnect on logout/host selection/runtime replacement and advance the relevant domain generations. Lazy callback checks are a second fence, not a logout notification mechanism.
3. `transport.start` installs callbacks before opening or delivering frames; `send` synchronously enqueues in call order or throws; `close` releases the socket. A send throw is conservatively uncertain. Authentication, exact origin/TLS/redirect/header policy, fresh tickets, strict UTF-8 decoding, and bounded transport queues/backpressure remain unimplemented. No actual socket is opened by these modules.
4. The injected monotonic deadline scheduler invokes a callback asynchronously once, unless cancelled, and returns a nonthrowing cancellation function. Test scheduling is deterministic and does not sleep.
5. Register only working prompt handlers. They own method-specific validators, exact prompt/session identity, user consent, secure transient fields, cancellation/timeout behavior, and response schemas. Observe the supplied abort signal and do not retain secrets. No production prompt UI or credential handler is supplied here; `{params:{}}`/`{result:{}}` in envelope tests do not certify clarification semantics. Throwing on handler failure retires the connection, never auto-answers blank.
6. Reconcile authoritative saved history/replay and writer ownership before `markReconciled`. Compose `submitText` through the existing durable `createTextSend`; this registry neither persists intents nor prevents cross-process/recreated-intent duplication. Gate domain `currentOwner` on this readiness and reconciliation, and recheck leases before updating UI.
7. Host error strings remain bounded untrusted content, not sanitized presentation or log messages. Do not log frames, prompt answers, transport URLs, or credentials.

## Verification

Synthetic/local only: `npm test` on Node 22.23.0, macOS: **60 passed, 0 failed**, including the existing 30 domain tests and 30 new protocol tests. `git diff --check` passed. No dependency or toolchain was installed; `package.json` and existing domain/common tests are unchanged. Node's strip-types execution does **not** type-check TypeScript; the approved pinned compiler/strict gate remains pending.

Focused checks cover escaped duplicate keys, exact byte/count/depth bounds, Unicode, immutable decode, hostile outbound accessors, server-envelope ID override, exact cancellation, finite methods, whole-frame atomicity, synchronous early server requests, per-socket advertisement, incompatible capability behavior, out-of-order receipt correlation, pending/identity capacity, timeout uncertainty, all owner coordinates, reclaim, foreign-session routing, handler failure, stale handlers/frames/deadlines, reconnect without replay, and the existing durable text sender consuming a synthetic contract-correct `streaming` receipt.

An initial adversarial test reproduced an ID-override flaw in server-response construction; exact handler-envelope validation fixed it. The initial fake timer retained fired timers incorrectly; its scheduler was corrected to one-shot semantics, with later deadline-fencing tests passing. No fabricated host receipt is presented as real network evidence.

Disposable real Hermes host: not exercised. Target OS, physical-machine, packaging, auth/secret storage, IPC isolation, and application acceptance: not exercised. Exact dependencies remain approval-gated; a real transport and method-specific prompt handlers are integration work, not completed by this lane.
