# Beta readiness — 0.9.0-beta.1 (2026-10-16)

Scope and install steps: [beta guide](../BETA.md). Per-row coverage: [feature matrix](../parity/FEATURE_MATRIX.md#beta-090-beta1-coverage). This record separates synthetic checks, a disposable real Hermes, hosted CI runners and what is still unverified. Nothing was signed, published or released.

## What changed since PR #10

- **Chat core:** live events project into Markdown replies, tool steps (Hermes's own failure rule), hidden-by-default reasoning, to-dos and plain failure rows; saved history comes from REST rows with tool results (RPC fallback), pages back up to 3,000 rows, strips attached context, and shows agent-delivered images. Every send carries `queued:true`; sending mid-reply steers, queues or interrupts per Settings; slash commands run through `slash.exec`/`command.dispatch`; file/photo attachments (picker and drop) stage before one journaled prompt; per-chat model and reasoning; speaker name note; OS alerts for approvals, questions and (opt-in) finished replies.
- **Fixed defects:** bare `message.start` dropped; any history containing tools failed to decode (`count` is the raw row count); attachment frames refused by the encoder; protected storage refused system-linked parents (macOS `/var`, Fedora Atomic `/home`); every snapshot re-sent every chat's transcript; plus 14 findings of an independent review (see below).
- **Features built in parallel and merged:** address-first connection with one-click this computer, password sign-in and token refresh, automatic reconnect; chat list management; agent management; every Settings page (Voice removed); scheduled tasks and projects editing; Feed/Ideas/Goals actions and the Files tab; Kanban (Later parks tasks as `scheduled` so Hermes does not auto-start them); workflow runs; vault and secure prompts; notifications, tray, start at sign-in, window memory, text size; `bighelp`-named portable packages with README and menu entry.
- **Platform:** finite feature calls (`shared/calls` + `main/calls`) with a validated route operation (no auth, gateway, env, ops, update or raw-config paths), one-line safe host error details, native context menus, app menu shortcuts, system-browser links (http/https/mailto only), clipboard through main.

## Synthetic and local checks (macOS development host, Node 24.20, Electron 44.7.2)

- `npm test`: **640 passed**, 0 failed.
- `npm run typecheck`: five strict projects (core, desktop, renderer, workspace-UI fixture, protected-storage harness).
- Electron smoke on a development build with a throwaway profile: **26/26** (no host), **28/28** (`--fixture-preview`), **169/169** (`--workspace-fixture`: 41 controlled reads, zero writes or sends).
- Markdown parser: hostile inputs that previously took 0.9–33 s now parse in under 30 ms (regression test included).

## Disposable real Hermes

Isolated clone of NousResearch/hermes-agent `b0f9ade1984ff5734f1b5ce70d0a3c417f519f83` (0.22.1+774) with its own venv, home and OS home, an explicit environment allowlist, `HERMES_DISABLE_LAZY_INSTALLS=1`, bound to 127.0.0.1. Model: local Ollama `gemma4:e2b` through Hermes's custom OpenAI-compatible provider (no cloud provider, no credits). Plugin: bighelp-plugin `45a82c31bccdd2544ef4b86f8d43e1faed545545` (3.13.0, 36 features). Kanban: bundled plugin. No gateway restart was ever called; the user's own Hermes was never touched.

Verified through the real desktop service and/or the built Electron app driven over DevTools:

- Connect "On this computer" through the Hosts page with no token typed; token and address absent from every snapshot.
- Real AI turns: streamed Markdown reply with a table and code block; a terminal tool call folded as "Worked · 1 step"; an approval card answered with **Allow once** in the UI and the command ran.
- `/help` via `slash.exec`; the 125-entry command menu; the model list; a message with a text file and a photo that the agent read.
- Agent-delivered image shown inline from Hermes's media folder.
- Feature agents additionally exercised: schedules (real Run now), projects, chat list (open-chat rename, archive, delete, search), agents (create/edit/duplicate/delete, conflicts), Kanban (create, move, comment, delete, one real Start now), workflow start/poll/retry, Files (recent, browse, preview, save 3 MB byte-for-byte), board actions (items seeded through the plugin's own store), vault add/remove with fake secrets, socket drop and automatic reconnect.

## Independent review

A separate reviewer read the chat core and reproduced 10 of 15 findings against the real service code. Fixed with regression tests: commands steered mid-reply, accepted sends filling the journal and triggering false warnings, history reads cancelled by follow-up turns, stale transcripts restored by refresh, uploads before the send intent and photos not taken back on abort, queued sends settled early, the interrupt-and-send race, a stuck send after deleting the open agent, quadratic streaming and silent truncation, Markdown worst cases, raw "Not Found" messages, command drafts not cleared, the newest-500 history limit, and following one's own new reply. Documented, not changed: agent-delivered images are read through Hermes's `/api/media`, which serves only images inside Hermes's media folders (the plugin's provenance-checked attachment routes are a later step).

## Hosted CI

[CI run 38977637932](https://github.com/promptclickrun/bighelp-win-linux/actions/runs/38977637932) at `22f88dc` passed both jobs (build, five strict compiler projects, tests, production packaging and packaged smoke with the OS sandbox enabled):

| Runner | Tests | OS protection | Packaged smoke | Download |
|---|---|---|---|---|
| Windows Server 2022 x64 | 640: 631 passed, 9 POSIX-only skips, 0 failed | DPAPI write → restart → read: all checks true | 169/169 | [bighelp-beta-windows-2022](https://github.com/promptclickrun/bighelp-win-linux/actions/runs/38977637932/artifacts/12079442664) |
| Ubuntu 24.04 x64 (xvfb) | 640 passed, 0 failed | No keyring on the runner: unavailable/basic_text, refused (fail closed) | 169/169 | [bighelp-beta-ubuntu-24.04](https://github.com/promptclickrun/bighelp-win-linux/actions/runs/38977637932/artifacts/12079886112) |

Downloads need repository access and expire after 14 days. They are unsigned portable archives with SHA-256 files. Hosted runners are not Windows 11 or Ubuntu desktop qualification.

## Not verified

- Physical Windows 11 and Ubuntu 24.04 desktops (Wayland and X11), screen readers, IMEs, high-DPI scaling, Windows toasts and tray, Linux AppIndicator, start at sign-in, a real Linux Secret Service unlock.
- Password sign-in and token refresh against a host that offers them (the disposable host has no sign-in; covered by fakes built from Hermes source). Browser (PKCE) sign-in is not built.
- Workflow sign-off against real stage output (the disposable host cannot run workflow agent stages), password-manager lock/unlock, and real `secret`/`sudo` prompts (covered by fakes).
- Visual parity: no new static mocks were published for the new pages (the `html-communication` skill is unavailable here); all pages reuse the approved hybrid D shell and A list/detail pattern and need a design review.
