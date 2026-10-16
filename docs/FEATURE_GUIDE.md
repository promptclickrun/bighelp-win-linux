# Adding a feature

How to add a host-backed feature without widening the renderer's authority. Read [AGENTS.md](../AGENTS.md) first.

## Layers

| Layer | Location | Rule |
|---|---|---|
| Wire codecs | `packages/contracts/<feature>.ts` | Decode `unknown` host replies into frozen, bounded plain data. Drop unknown fields; never pass host paths, tokens or raw errors through. |
| Call declarations | `apps/desktop/src/shared/calls/<feature>.ts` | `defineCall<Output>()(parse)` per operation. `parse` uses `shared/validate.ts` and refuses unknown fields. Register the module in `shared/calls/index.ts`. |
| Call handlers | `apps/desktop/src/main/calls/<feature>.ts` | `Pick<CallHandlers, keyof typeof X_CALLS>`. `mutation: true` for writes. Use `context.rpc(method, params)` or `context.http({ method, path, query, body, maxBytes })`. Register in `main/calls/index.ts`. |
| UI | `packages/ui/components/<Feature>.tsx` | `useQuery(name, input)` for reads, `useCall()` for writes. Use `controls.tsx` (Button, TextField, SelectField, Toggle, Dialog, ConfirmDialog, MenuButton, Banner, Card, Row, PageBody). |

The renderer can only name a call from the registry. Main parses the input again, checks the host lease (`snapshot.connection`) and runs the handler. Results must be structured-clone data.

## Host requests

- RPC methods are fixed strings in the handler; params are built from parsed input. `context.rpc` refuses non-object params.
- HTTP paths are `/api/...` built with `encodeURIComponent` on validated `segment()` values. The policy refuses traversal and auth, gateway, env, ops, update and raw-config routes. Writes send JSON bodies.
- Plugin (`/api/plugins/loopdy/...`) writes: read the context with `requirePluginFeature(context, '<feature-v1>')` and pass `native: { etag: plugin.etag, requestId: context.requestId() }`. The policy adds `If-Match` and `X-Loopdy-Request-ID` and checks the echoed ID.
- Errors: throw `CallError(code, plain sentence)` for known conditions. Anything else is mapped by `callFailure()` (unsupported, invalid with the host's one-line detail, conflict, unknown outcome for lost write replies).
- After a confirmed change that affects agents or chats, call `context.refreshCatalog()`.

## Product rules that reviews check

- Plain words. No raw IDs, paths or JSON outside Nerd Mode.
- Destructive actions use `ConfirmDialog` with the exact consequence. Anything that can spend AI credits says so before it runs.
- A lost write reply is "not sure this finished", never success. Never retry a write automatically.
- No spinners, shimmer or pulsing. Busy state is still text ("Saving…").
- Unsupported host or plugin: a clear sentence, never a broken or blank page. Hide controls the host cannot do.
- No new npm dependencies.

## Tests

Add `tests/<feature>.test.mjs` (Node test runner, synthetic data shaped like real replies). Cover: input refusal, decode of a real-shaped reply, unknown fields dropped, error mapping. Run `npm test` and `npm run typecheck`.

A disposable Hermes for manual checks may be running at `http://127.0.0.1:9137` (token file outside the repository). Never point tests at another host.
