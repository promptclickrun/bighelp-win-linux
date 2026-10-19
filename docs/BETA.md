# bighelp for Windows and Linux — beta 0.9.0-beta.1

bighelp is a desktop window onto the [Hermes agent](https://github.com/NousResearch/hermes-agent) you already run, on the same computer or another one you use. Hermes does the work and keeps the history; bighelp shows it and sends what you type. There is no bighelp account or cloud service.

This is an **experimental beta**. It is unsigned, it has no automatic updates, and several Mac features are not here yet (see [Not in this beta](#not-in-this-beta)). Please report problems with **Settings → Help & feedback → Copy details for a bug report**.

## Install

Download the unsigned portable archives from the [0.9.0-beta.1 release](https://github.com/promptclickrun/bighelp-win-linux/releases/tag/v0.9.0-beta.1) (`bighelp-beta-<version>-<os>-x64`). Each comes with a `.sha256` file; check it before running. These production packages exclude development sample data. See the [README](../README.md#download) for checksum commands and step-by-step installation.

**Windows 11 (x64)**
1. Unzip `bighelp-beta-…-win32-x64.zip` to a folder you own (for example `Documents\bighelp`).
2. Run `bighelp.exe`. If Windows warns, follow [Windows download warnings](../README.md#windows-download-warnings). After verifying and scanning the download, an unknown-app SmartScreen warning may be acknowledged with **More info → Run anyway**. A named antivirus detection needs investigation, not a blanket exclusion or disabled protection.
3. To remove it, quit bighelp and delete the folder. Your saved sign-in and drafts live in `%APPDATA%\bighelp` (delete it too for a clean removal).

**Ubuntu 24.04 (x64) and similar**
1. `tar xzf bighelp-beta-…-linux-x64.tar.gz` and open the folder.
2. A working keyring is required to save your sign-in (GNOME Keyring on GNOME, KWallet on KDE). Without one, bighelp refuses to store credentials rather than saving them in plain text.
3. Chromium's sandbox needs its helper owned by root once: `sudo chown root:root chrome-sandbox && sudo chmod 4755 chrome-sandbox` (see `README.txt` in the archive).
4. Run `./bighelp`. Optional: `./install-desktop-entry.sh` adds a menu entry for your user (`--remove` takes it out).
5. Data lives in `~/.config/bighelp`.

## Connect to Hermes

Open bighelp and choose **Connect to Hermes** (or **Settings → Hosts**).

- **Hermes on this computer:** choose *On this computer* (Hermes uses port 9119 unless you changed it) and **Connect**. bighelp reads the local sign-in itself; no token needed.
- **Another computer:** choose *On another computer* and type its address. bighelp asks Hermes what it needs: a username and password (Hermes's own sign-in), or a token under *Advanced*. Plain `http` works only with a private IP address (like `192.168.1.20` or a Tailscale `100.x` address); otherwise use `https`. Browser-based sign-in is not in this beta.
- Sign-in material stays in the main process and the OS key store (Windows DPAPI, Linux Secret Service). It never reaches the window, logs or chat history.
- If the connection drops, bighelp reconnects on its own and reopens your chat. It never resends a message by itself; if a send's outcome is unknown, it says so.

## What you can do

**Chat**
- Chat with any of your agents; replies stream with Markdown (headings, lists, tables, code with Copy, links that open in your browser).
- See what the agent is doing: tool steps with plain labels, failures marked as failures, and finished work folded into "Worked · N steps" (expand for inputs and results). Reasoning is available in Settings → Chat.
- Approve or deny actions and answer agent questions right in the chat.
- Attach files and photos (picker or drag-and-drop; up to 10 files, 8 MB each, 24 MB per message).
- `/` opens Hermes's own commands and skills; choose the model and reasoning for a chat.
- While an agent works you can steer it, queue a message, or stop it (Settings → Chat chooses what Send does).
- Saved chats open read-only while offline. Drafts survive navigation and restarts. Long chats load older messages on request.

**Your workspace**
- Chats: newest first, search, rename, archive and delete.
- Agents: create, edit (name, purpose, instructions, color, default model), duplicate and delete.
- Agent Feed, Ideas and Goals with their actions, and the agent's Files.
- Projects (create, rename, make current, archive), Scheduled tasks (create, edit, pause, run now, delete, recent runs), Usage.
- Kanban (new tasks wait in Later and never start on their own; moves that start an agent say so first).
- Workflows: start a run, follow it, and answer the steps that need you (sign-off, retry, cancel). Editing workflows stays on the Mac for now.
- Vault: see what each agent's vault holds (names only), add a login, remove items, lock and unlock password managers. Secret values are write-only and never kept by bighelp. Agents' requests for a password, code or sudo during a chat are answered the same way.

**Desktop**
- Notifications while bighelp runs when an agent needs your OK or has a question (and, if you turn it on, when a reply finishes).
- Optional: keep running in the tray when the window closes; open at sign-in.
- Light and dark appearance, text size, native right-click menus, keyboard shortcuts (Ctrl+N new chat, Ctrl+K search, Ctrl+, Settings, Ctrl+L message box, Ctrl +/− zoom).

## Not in this beta

Voice and read-aloud, Bot Screen, group chats, the IDE/Git surfaces, editing workflows, connectors (apps), AI provider and MCP/plugin administration, browser sign-in, calendar and reminders, alerts after quitting, signed installers and automatic updates. The Mac app remains the reference for these.

## Known limitations

- Unsigned builds: expect SmartScreen and antivirus prompts. The Windows executable still shows Electron's file icon.
- Qualified on hosted Windows Server 2022 and Ubuntu 24.04 CI runners and a macOS development machine. Physical Windows 11 and Ubuntu desktops (Wayland and X11), screen readers, IMEs and high-DPI displays still need hands-on testing.
- Notifications only cover the chat that is open; other chats' replies appear when you open them.
- Files the agent delivers show inline when they are images in Hermes's media folders; other files show as a name you can find in the agent's Files tab.
- A plain `hermes serve` host refuses renaming or deleting a chat while its gateway is busy; bighelp falls back to the live session where it can and says so otherwise.
- Linux without a keyring cannot save a sign-in (by design).

## Privacy and safety

- bighelp talks only to the Hermes address you give it (no redirects, no third-party services). Links open in your browser only after you click them.
- Files are read only when you choose or drop them; bighelp never browses your computer.
- Anything that can spend AI credits (Kanban starts, workflow runs, scheduled runs) says so before it happens. New Kanban tasks and Feed/Ideas/Goals actions never start AI work on their own.
