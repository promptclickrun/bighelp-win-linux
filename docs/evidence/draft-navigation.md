# Draft preservation during navigation

Date: 2026-10-16. Final review finding 2; baseline `7c776cf`.

Typing in chat A and choosing a saved chat, New chat, or an agent before the 300 ms draft debounce previously rotated the service generation before any draft write. The next render cleared the dirty buffer and timer, and returning to A showed its older protected draft.

`packages/ui/App.tsx` now shares one pending flush per generation. Intentional chat navigation and explicit host connect/disconnect wait for protected draft persistence under the original generation. Main's existing finite `draft` operation admits only the current selected chat and synchronously captures its host/principal/profile/session storage key before queueing a write. No renderer host/principal token, API capability, dependency, display layout, or persistence format was added.

A successful flush removes only the acknowledged text. New typing while a write is pending remains dirty and is saved before navigation proceeds. Failed persistence retains the dirty value and blocks generation-changing navigation; the person can retry. Rail/back navigation starts the same flush while retaining unsaved same-generation text. A renderer navigation sequence permits only the latest pending navigation; leaving chat cancels a delayed intent. Existing canonical-navigation cancellation retains its original initiating generation.

Both the rendered generation and the draft response's snapshot generation fence delayed work. This also rejects a replacement authority acknowledged before React commits its next render. Generation changes discard the old renderer buffer and timers; an old flush cannot retry its text against a replacement host, principal or session. Send retains its existing compare-and-clear behavior and is never replayed by navigation.

## Synthetic verification

`tests/ui-draft-navigation.test.mjs` compiles the actual App using the existing esbuild dependency. Its synthetic hook harness exercises App callbacks, refs, reducer transitions and effects with inert child elements and a finite API fake. It covers:

- Saved-chat, New chat, and canonical-agent switches before debounce, including return to the original draft.
- Failed saves and retry; a failed save also blocks explicit host replacement.
- New typing during a held write and supersession by a later navigation intent.
- Leaving chat while navigation waits, without a later unexpected reopening.
- Explicit host connect/disconnect waiting for the original draft.
- Authority replacement during a held save, including replacement before the next React render.
- Cancellation of admitted canonical navigation using its original initiating generation.
- Ordinary debounce and preservation of newer text when an earlier Send finishes.

The same 14 tests compiled against baseline App source at `7c776cf` produce **11 failures and 3 passes**. All three quick-switch cases fail because no original draft is persisted. Temporary baseline probe source was removed; the local log is `/tmp/bighelp-draft-baseline-tests.log`.

Final checks:

- `node --experimental-strip-types --test tests/ui-draft-navigation.test.mjs tests/ui-connected.test.mjs tests/desktop-service.test.mjs`: **41 passed, zero failed/skipped/cancelled**.
- `node node_modules/typescript/bin/tsc -p config/tsconfig.renderer.json`: passed.
- `git diff --check -- packages/ui/App.tsx tests/ui-draft-navigation.test.mjs docs/evidence/draft-navigation.md`: passed.

These are synthetic/local checks. No browser input, IME, physical Windows/Linux UI, production host, real key store, package build, external service, or successful model turn was exercised. Unexpected authority loss, process crash, or shutdown before an acknowledged protected save can still discard unsaved keystrokes; this change does not claim per-keystroke durability.
