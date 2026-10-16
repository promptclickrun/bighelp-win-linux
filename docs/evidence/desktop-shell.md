# Desktop shell: first runnable slice

Date: 2026-10-16. Builds the approved hybrid direction ([D5](../DECISIONS.md), mock D) as a runnable Electron + React Native Web app. It has no host connection. Toolchain and dependency decisions are in [TOOLCHAIN.md](../qualification/TOOLCHAIN.md).

## What a person sees

- **Rail → context list → page.** The rail is the one navigation: Chats, Agents, Projects, Kanban, Workflows, Scheduled, Usage, then Vault, the computer status and Settings at the foot. The rail decides what the list beside it shows.
- **Agent tabs belong to the agent.** Chat/Feed/Ideas/Goals/Files sit under the composer only while an agent conversation is open. They are absent on function pages and in Settings.
- **One Settings.** The everyday rows (You, Assistants, Appearance, Chat, Voice, Notifications, Hosts, Permissions, Help & feedback) never move. The Nerd Mode switch adds a separate Hermes zone with System and Hermes tools. The Companion pet row is not included (D5). Appearance works: Automatic, Light or Dark, for this session.
- **Narrow windows (< 900 px).** The rail stays. The list takes the page, opening something replaces it, and Back returns to the list.
- **First launch is honest.** With no computer, the app says so, shows empty lists, and invents no agents, chats, progress or results.
- **Development preview.** `npm run desktop:preview` loads the mock's synthetic content (Juniper, Otto, Marigold), labelled "Sample data" in the lists and window title. It includes the **unknown send** state: "Not sure this arrived", with Check chat history first, Copy text, and an explicit Send again… that warns the action could run twice. A packaged build ignores the flag.
- **Composer.** You can type and keep a draft per conversation. Drafts survive navigation and window resizing. The composer sits outside the scrolling transcript. Send, attachments, voice and new-chat buttons are visibly disabled with the reason ("Needs a connected computer"). Enter does not send.

## Trust boundary

- **Main process** (`apps/desktop/src/main`): `policy.ts` is pure and unit-tested; `main.ts` applies it. Each window uses `contextIsolation`, renderer `sandbox`, and no Node integration in the page, workers or subframes. `webSecurity` is on, insecure content is off, `<webview>` is off, drag-drop navigation is off, spellcheck is off (its dictionaries download from the network), and dialogs are safe. `app.enableSandbox()` and no application menu.
- **Packaged origin.** UI loads from `app://bighelp`, a custom protocol that serves an exact three-file allowlist (`/`, `/index.html`, `/renderer.js`). Main and preload bundles are never served. Traversal, encoded paths, query, fragment, userinfo, port and other hosts all get 404 (unit-tested).
- **Two network layers.** The CSP has `connect-src 'none'` and `script-src 'self'`, with no `unsafe-eval` and no inline scripts. Styles allow `'unsafe-inline'` only because RNW inserts generated rules at runtime. Independently, the main process cancels every request that is not `app://bighelp/…`. The smoke run bypasses CSP through DevTools and confirms the main-process filter still blocks a loopback request (`net::ERR_BLOCKED_BY_CLIENT`).
- **Navigation, popups, permissions.** `will-navigate`, `will-redirect`, `will-attach-webview` and `window.open` are all denied. Every permission request and check, device permission, display capture and download is refused.
- **Preload.** It exposes one frozen object, `{ platform, fixturePreview }`. It has no functions, no IPC and no `ipcRenderer`. The renderer validates it with `parseShellInfo` and falls back to `{ platform: 'other', fixturePreview: false }` for any other shape.
- **Renderer** (`packages/ui`, `apps/desktop/src/renderer`): is type-checked without Node types. Its view data (`view-model.ts`) has no credentials, addresses or callbacks. The build fails if the renderer bundle pulls in `react-native`, `node:` modules, or main/preload code.

## Verification

Development host: Ubuntu 24.04.4 **ARM64**, X11 virtual display, Node 24.22.0, Electron 44.7.2 / Chromium 152.0.7977.149. **Synthetic/local evidence only.** It is not on the Windows 11 x64 / Ubuntu 24.04 x64 qualification matrix.

- `npm test`: 119/119. New: `shell-navigation` (17), `desktop-policy` (8), `ui-tokens` (4), `ui-view-model` (4). Each was watched failing before its implementation.
- `npm run typecheck`: three strict projects, zero errors, `skipLibCheck: false`.
- `npm run desktop:smoke -- --no-os-sandbox --fixture-preview`: 27/27 in real Electron, driven over the DevTools protocol on 127.0.0.1:
  - isolation (no `require`/`process`/`module`, no electron/IPC globals, frozen two-field preload object, `app://bighelp` origin);
  - CSP present; internet and loopback `fetch` blocked; the main-process filter blocks even with CSP bypassed; `window.open` denied; navigation away refused; no non-`app://` request received a response;
  - keyboard: Tab reaches the rail, and Enter and Space activate rail items;
  - shell: one navigation; sample data labelled; agent tabs on a chat and absent on Workflows; unknown send shown as unknown and never "failed";
  - typing through Chromium's text-commit path; Enter neither sends nor clears; draft survives navigation; Send disabled; Nerd Mode reveals System and Hermes tools; narrow chat has Back.
- Without sample data: 18/18, including "no invented data without a computer".
- Six screenshots reviewed (wide light chat, wide dark chat, wide dark Settings with Nerd Mode, workflows, narrow list, narrow chat) plus the empty first launch. Defects found and fixed are listed in TOOLCHAIN.md.

`--no-os-sandbox` disables Chromium's OS-level sandbox. This host cannot provide it; see TOOLCHAIN.md. The renderer sandbox preference still applies.

## Visual status

The direction (D) is approved. These renders follow mock D's tokens, structure and copy. They have **not** been compared with shipping-app screenshots, and pixel-level acceptance is still pending (D5). Glyphs and the Noodle are mock D's stand-ins, not the licensed Design/Glyphs set or brand kit. Fonts use system stacks only: Segoe UI on Windows, Noto Sans on Linux, nothing bundled. This host had neither font, so the renders use a fallback face.

## Not built or not verified

- Host sign-in and connection, and everything that needs a host: send, history, approvals, agents, Feed/Ideas/Goals/Files contents, Projects, Kanban, Workflows, Scheduled, Usage, Vault, and the remaining Settings pages. Each shows a plain "not built yet" state.
- OS secret storage, the protected journal, and persisted preferences (appearance and drafts reset on relaunch).
- Long virtualized transcript, Markdown, tool-row disclosure, prepend anchoring and follow-tail behavior.
- Real IME composition, screen readers (Narrator/UIA, Orca/AT-SPI), high contrast, scaling and RTL.
- Packaging, fuses, AppArmor/setuid sandbox, signing, tray mode, autostart, notifications.
- Windows, x64 Linux and Wayland.
