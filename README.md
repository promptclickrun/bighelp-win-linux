# bighelp for Windows and Linux

**Your Hermes agents, in a desktop app.** Chat, follow the work, approve actions, and manage your agents and projects without keeping a dashboard tab open.

bighelp connects directly to the [Hermes](https://github.com/NousResearch/hermes-agent) instance you already run, on this computer or another one. Hermes runs your agents and keeps their history. There is no bighelp account, hosted chat service, or bundled agent runtime.

**Experimental beta: 0.9.0-beta.1.** These are unsigned, portable x64 builds. They start without sample agents or conversations and are ready for you to connect to your own Hermes.

## Download

Get the app archive and its matching `.sha256` file from [the beta release](https://github.com/promptclickrun/bighelp-win-linux/releases/tag/v0.9.0-beta.1):

| System | App | Checksum |
| --- | --- | --- |
| Windows 11, x64 | [Windows ZIP](https://github.com/promptclickrun/bighelp-win-linux/releases/download/v0.9.0-beta.1/bighelp-beta-0.9.0-beta.1-win32-x64.zip) | [SHA-256](https://github.com/promptclickrun/bighelp-win-linux/releases/download/v0.9.0-beta.1/bighelp-beta-0.9.0-beta.1-win32-x64.zip.sha256) |
| Ubuntu 24.04 LTS, x64 | [Linux tar.gz](https://github.com/promptclickrun/bighelp-win-linux/releases/download/v0.9.0-beta.1/bighelp-beta-0.9.0-beta.1-linux-x64.tar.gz) | [SHA-256](https://github.com/promptclickrun/bighelp-win-linux/releases/download/v0.9.0-beta.1/bighelp-beta-0.9.0-beta.1-linux-x64.tar.gz.sha256) |

Repository access is required while this repository is private. Download the app archive under **Assets**, not GitHub's automatically generated source-code archives. You do not need Node, npm, or Electron installed.

### Windows

1. Save the ZIP and its `.sha256` file in the same folder.
2. Open PowerShell in that folder and check the download:

   ```powershell
   $archive = 'bighelp-beta-0.9.0-beta.1-win32-x64.zip'
   $expected = (Get-Content -LiteralPath "$archive.sha256").Split(' ')[0]
   if ((Get-FileHash -Algorithm SHA256 -LiteralPath $archive).Hash -ne $expected) {
       throw 'Checksum mismatch. Do not run this download.'
   }
   ```

3. Right-click the ZIP and choose **Extract All**. Keep the entire extracted folder together, somewhere you own, such as `Documents\bighelp`.
4. Open `bighelp.exe` inside the extracted folder. If Windows shows a warning, follow [Windows download warnings](#windows-download-warnings) below.

### Linux

Download both files into the same folder, then run:

```sh
sha256sum --check bighelp-beta-0.9.0-beta.1-linux-x64.tar.gz.sha256 &&
tar xzf bighelp-beta-0.9.0-beta.1-linux-x64.tar.gz &&
cd bighelp-beta-0.9.0-beta.1-linux-x64
```

Stop if the checksum does not say **OK**. From inside the extracted folder, set up Chromium's sandbox helper once:

```sh
sudo chown root:root chrome-sandbox &&
sudo chmod 4755 chrome-sandbox &&
./bighelp
```

Run the app as your normal user, not with `sudo`. Do not use `--no-sandbox`. A working, unlocked GNOME Keyring or KWallet is required to save your sign-in; without secure storage, the app refuses to connect rather than store credentials in plain text.

Optional: run `./install-desktop-entry.sh` to add bighelp to your app menu. Run it again if you move the folder.

## Connect to Hermes

Your Hermes dashboard must already be running and reachable. bighelp does not install or start Hermes.

1. Open **Connect to Hermes**, or **Settings > Hosts**.
2. If Hermes runs on this computer, choose **On this computer** and **Connect**. The default port is `9119`; bighelp reads the local sign-in itself.
3. For a remote instance, choose **On another computer** and enter its dashboard address. Use the username and password Hermes requests, or enter a token under **Advanced**. Use `https` unless connecting directly to a private IP address over a network you trust. Browser-based sign-in is not available in this beta.
4. Choose an agent and start a chat. Workspace features appear according to what your Hermes instance and plugins support.

Sign-in credentials stay in the privileged app process and OS-protected storage. A dropped connection reconnects automatically; an uncertain send is never silently sent again.

## What you can do

- **Chat:** streamed Markdown, code and tables, tool steps, approvals and questions, file and photo attachments, slash commands, model selection, steering, queued messages, and Stop.
- **Organize:** search and manage chats, create and edit agents, manage projects and scheduled tasks, and browse agent files.
- **Follow work:** Feed, Ideas, Goals, Kanban tasks, workflow runs and sign-offs, and usage.
- **Keep secrets private:** manage vault entries and answer password or code requests through write-only controls.
- **Make it yours:** light and dark appearance, text size, keyboard shortcuts, notifications while running, and optional tray and start-at-sign-in behavior.

New Kanban tasks wait until you start them. Feed, Ideas, and Goals do not automatically start paid AI work. Actions that start agents disclose that they may spend credits.

See the [beta guide](docs/BETA.md) for the full feature list.

## Windows download warnings

**This beta is not code-signed.** An unknown-publisher or SmartScreen reputation warning is not the same as an antivirus malware detection. We cannot promise that any detection is a false positive.

Before making an exception, download only from this repository's release, verify the archive's SHA-256 as above, and scan the extracted folder with up-to-date antivirus. Matching checksums detect changed or damaged downloads; they do not prove the app is harmless.

**If SmartScreen only says "Windows protected your PC":** after those checks, choose **More info > Run anyway**, if available. The publisher will be unknown for this unsigned build. If Windows instead reports that a downloaded file is blocked, right-click the verified ZIP, choose **Properties**, select **Unblock** if shown, then **Apply**, and extract it again. This removes the download block for that archive only; it does not disable antivirus.

**If Defender or another antivirus names a threat or quarantines a file:** do not immediately allow or restore it. Update the antivirus definitions and scan again. Report the detection name, affected filename, file hash, and release version in [an issue](https://github.com/promptclickrun/bighelp-win-linux/issues). Do not include credentials, host addresses, or chat content. Submit the flagged release binary to [Microsoft's file review service](https://www.microsoft.com/en-us/wdsi/filesubmission), or the vendor's equivalent, for a suspected false-positive review. Do not upload your app data folder. Wait for confirmation and updated definitions before trying again.

Do not disable real-time protection, exclude Downloads or the entire app folder, or work around a work/school device policy. If **Run anyway** is unavailable or your organization blocks unsigned apps, ask your administrator or wait for a signed build.

## Beta limits

There is no installer or automatic updater. Voice, browser sign-in, group chats, IDE/Git tools, workflow editing, connectors, plugin/MCP administration, and notifications after quitting are not included.

Packages have passed hosted Windows Server 2022 and Ubuntu 24.04 CI checks, including packaged-app interactions. Physical Windows 11 and Linux desktop testing, Wayland/X11 coverage, screen readers, IMEs, and high-DPI checks remain incomplete. See [readiness evidence](docs/evidence/beta-readiness.md). These are beta builds, not a claim of production certification.

To update, quit bighelp and extract the new version into a separate folder. To remove it, first turn off start-at-sign-in in Settings, quit, and delete the app folder. On Linux, remove the menu entry with `./install-desktop-entry.sh --remove` before deleting it. Settings, encrypted sign-in, and cached chats remain in `%APPDATA%\bighelp` on Windows or `~/.config/bighelp` on Linux unless you separately remove them. Authoritative chat history stays on Hermes.

## Development

The app uses React Native Web inside Electron, with networking and OS capabilities behind finite privileged operations. Read [CONTRIBUTING.md](CONTRIBUTING.md), [AGENTS.md](AGENTS.md), and [SECURITY.md](SECURITY.md) before changing it.

Use Node 24.22.0 and npm 11.19.1:

```sh
npm ci
npm run esbuild:verify
npm run electron:fetch
npm run check                 # tests, five strict type checks, guarded development bundle
npm run desktop:start         # real connection, no sample data
npm run desktop:preview       # synthetic development preview only
npm run desktop:package       # production portable archive; run on the target OS
```

See the [feature guide](docs/FEATURE_GUIDE.md), [toolchain](docs/qualification/TOOLCHAIN.md), [contracts](docs/contracts/HERMES_API.md), and [source provenance](docs/SOURCES.md) for implementation details.

Apache-2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).
