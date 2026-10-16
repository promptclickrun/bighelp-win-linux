# Unsigned portable development packaging

Date: 2026-10-16. These artifacts are development builds, not installers or releases.

`node scripts/desktop/package.mjs [linux|win32] [x64]` builds production resources, downloads the pinned Electron runtime with `@electron/get`, independently verifies its archive against the checksums bundled with the locked Electron dependency, and assembles a portable directory under ignored `artifacts/`. Run on the target OS. Other operating systems and architectures fail before building or downloading. No dependencies were added.

The runtime retains its original executable name (`electron` or `electron.exe`). Its packaged application has the private identity `bighelp-development`, version `0.0.0`, and entry point `resources/app/main.cjs`. Only the four application bundle files and optional esbuild license companions enter application resources. Source, fixtures, environment files, source maps, repositories, and credentials are not copied. Symlinks and special source entries are rejected. Electron's default application is removed. Project LICENSE/NOTICE and Electron/Chromium licenses are retained. SHA256SUMS covers every regular artifact file except itself; a separate SHA256 accompanies the tar.gz or zip. SHA256 detects corruption; it is not a signing identity.

Linux archives use system tar; Windows archives use PowerShell Compress-Archive. There is no installer, signing, publishing, auto-update feed, ARM build, or reproducible-byte archive claim. The Electron executable and OS sandbox configuration are retained: the package never sets `--no-sandbox`, changes chrome-sandbox ownership, or relaxes OS settings. Linux operators must provide a supported sandbox configuration and desktop environment; OS sandbox setup on ephemeral CI runners belongs to the runner administrator. Launching from a root container is not qualification.

The platform workflow targets Ubuntu 24.04 x64 and Windows Server 2022 x64 hosted runners with Node 24. It installs the lockfile, explicitly verifies esbuild and fetches Electron, runs tests and strict compilation, builds production resources, packages, and uploads short-lived unsigned development artifacts. Passing this workflow qualifies build assembly on these runners only. It does not qualify Windows 10/11, Linux distributions, Wayland/X11, accessibility, audio, notifications, OS key stores, physical hardware, or production distribution. Packaged launch and sandbox smoke evidence must be recorded separately.

## Checks in this workspace

- `node --test tests/desktop-package.test.mjs`: 4 passed. Tests exercise supported targets, incomplete bundles, prohibited credentials/source/fixtures/maps, symlink rejection, and manifest coverage with a known digest and changed contents.
- `node scripts/desktop/package.mjs`: production bundle completed. Runtime download failed with `ECONNREFUSED` connecting to github.com port 443 in this environment. No completed portable artifact or packaged launch is claimed from this attempt.
- `npm run typecheck`: passed. Unsupported `darwin/x64` CLI target rejected before building.
- Windows packaging and both hosted CI jobs have not been run in this Linux workspace. CI configuration is implementation, not executed evidence.
