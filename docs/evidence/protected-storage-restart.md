# Disposable OS protection restart probe

`scripts/qualification/protected-storage.mjs` bundles a separate Electron main
entry with the existing protected repository and the desktop's actual
`safeStorage` adapter. It never imports the app main/service, loads saved hosts,
scans provider configuration, or contacts a Hermes host.

The probe creates one temporary directory outside the source tree and redirects
Electron user data, session data, crash dumps, home/config/cache/data and temporary
paths into it. Only fixed OS launcher, display, and Secret Service environment
inputs reach the child; provider variables and Node/Electron overrides do not.

When OS encryption is available, the first Electron process writes one fixed
synthetic value and closes the repository. After that process exits, a second
Electron process opens the same isolated profile/repository and verifies the
original revision and value. The harness checks that the encrypted file excludes
the synthetic plaintext in UTF-8 and UTF-16, and that the read leaves its bytes
unchanged. No ciphertext, plaintext, local paths, environment values, or raw child
diagnostics appear in the JSON report.

Each child has a 30-second parent deadline and a 25-second Electron watchdog;
combined stdout/stderr is limited to 64 KiB and discarded. Timeout, interruption,
or excess output terminates the process group/tree, with a bounded confirmation
period. The generated directory is removed on success, unavailable protection,
and ordinary failure. The harness never requests `--no-sandbox` or a plaintext
password-store fallback. It does not delete anything outside its generated root.

## Reproduce

After the pinned dependency install and `npm run electron:fetch`:

```sh
node node_modules/typescript/bin/tsc -p scripts/qualification/tsconfig.protected-storage.json
node --test scripts/qualification/protected-storage.test.mjs
```

Windows, including the existing Windows desktop build job:

```sh
node scripts/qualification/protected-storage.mjs --require-available
```

Linux without requiring an installed desktop key service:

```sh
node scripts/qualification/protected-storage.mjs --headless
```

Exit 0 means `passed`, or explicitly `unavailable` when availability was optional.
Exit 1 means a failed probe, failed cleanup, or required-but-unavailable OS
encryption. Exit 2 means invalid arguments. Read `status` and `checks` in the JSON;
an optional exit 0 alone does not qualify encryption. Linux `basic_text` and
unrecognized backends are unavailable. Unexpected startup/storage failures still
fail the job. The Windows CI step requires actual protection, write, restart,
read, plaintext exclusion, and cleanup. Both CI jobs also run the harness tests
and the probe's strict TypeScript check.

Linux CI copies the installed Electron runtime into a new runner-temp directory
and configures its `chrome-sandbox` helper as root-owned mode 4755, matching the
existing packaged smoke setup. It passes that runtime with explicit
`--executable <path>` and removes the generated runtime copy with a shell trap.
This keeps the sandbox enabled on hosted runners whose policy blocks unprivileged
user namespaces; missing Secret Service is classified only after Electron starts.

## Local evidence, 2026-10-16

- Harness: 10/10 synthetic boundary tests passed (finite flags, environment
  isolation, evidence validation, plaintext detection, child success/failure,
  combined output limit, deadline, interruption, missing executable, redacted CLI).
- Probe source: passed the repository's strict compiler options through
  `tsconfig.protected-storage.json`.
- Existing protected-repository synthetic regression suite: 15/15 passed.
- Actual installed Electron 44.7.2 on Linux, sandbox enabled: `unavailable`,
  `backend: basic_text`, `reason: os-encryption-unavailable`, `cleanup: removed`.
  Optional invocation exited 0; adding `--require-available` exited 1.
- Explicit installed-runtime path produced the same unavailable result. A
  synthetic missing executable produced exit 1, `process-launch-failed`, and
  `cleanup: removed`, without echoing the path. No probe/test directories remained.
- No real encryption write/restart/read passed locally because the Linux secret
  service was unavailable. Windows execution remains CI evidence to collect;
  this document does not claim a successful Windows run.

This probe qualifies only the tested OS account/runtime's protected-storage
restart behavior. It does not establish Windows 11 hardware acceptance,
keyring/DPAPI user lock or revocation behavior, power-loss durability, physical
security, UI accessibility, or Hermes compatibility. `platformAcceptance` stays
false. Synthetic harness tests do not establish OS encryption.
