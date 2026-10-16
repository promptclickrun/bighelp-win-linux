# Gateway request-history lifetime

Task 6 of [the chat recovery plan](../plans/2026-10-16-chat-recovery.md), based on
`0230a81314f9dd4569c43bb723e4baf2ec5fcc8b`.

## Reproduction and change

The gateway retains every dispatched outgoing request ID for its connection's
lifetime, with a 4,096-ID limit. The two capability-negotiation requests count
toward that limit. Before this fix, 4,094 successful application operations left
the next request rejected as unavailable while the socket remained open and
the consumer received no closure notification. The regression failed with
`closeCount` equal to zero instead of one; the rejected mutation was not sent.

`packages/hermes-client/gateway.ts` now calls the existing idempotent close path
when another request encounters the exhausted history. Pending reads reject as
`transport-unavailable`; pending mutations reject as `outcome-unknown`. The
rejected new request remains undispatched. Closure aborts the connection and
notifies the consumer once, including when socket closure calls back
synchronously. The client performs no automatic reconnect, retry, or replay.

The retained-ID limit and 64-pending-request limit remain intact. No mutation
tombstones are evicted and no outgoing request IDs are rewritten. A separately
opened connection negotiates again and has its own full history budget. The
transport continues to rely on its consumer for explicit reconnection.

## Verification

All evidence here uses deterministic synthetic socket adapters, not a live host.

- Red: `node --experimental-strip-types --test --test-name-pattern='outgoing history exhaustion retires' tests/gateway-client.test.mjs`
  failed on the original implementation at the missing closure assertion.
- Green: `node --experimental-strip-types --test tests/gateway-client.test.mjs`
  passed **12 tests**, with zero failures, cancellations, or skips.
- `./node_modules/.bin/tsc -p config/tsconfig.core.json` passed.
- `git diff --check` passed.

New regressions cover exact exhaustion after negotiation; rejected-mutation
non-dispatch; one closure notification despite repeated, reentrant, and late
callbacks; pending read versus mutation settlement; late-reply suppression;
an explicit fresh connection's complete independent budget; settled and pending
duplicate-ID rejection; and capacity rejection without socket retirement or
consumption of the rejected ID.

The full suite, desktop compilation/build, service/UI disconnection rendering,
real Hermes behavior, CI packages, and physical Windows/Linux qualification are
outside this isolated gateway check. Integration validation belongs to Task 4;
Task 3 concurrently owns service/UI recovery changes.
