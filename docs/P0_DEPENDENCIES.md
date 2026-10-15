# Desktop proof dependency proposal

Status: **proposal, not installed or approved**. Prepared from the Orca shell/security research lane on 2026-10-15. The coordinator independently retrieved the core package versions and peer/engine declarations from npm. Metadata compatibility is not build qualification.

The current domain proof needs only Node 22.23.0 and has no third-party dependencies. Keep that baseline for the first shell experiment unless the clean-install proof finds a reason to change it. Do not silently upgrade the workstation Node installation.

## Exact candidate direct pins

| Package | Version | Placement/purpose |
|---|---|---|
| react | 19.3.1 | Renderer |
| react-dom | 19.3.1 | Renderer |
| react-native-web | 0.21.4 | Shared renderer primitives |
| react-native | 0.88.0 | Development/type source only, not a native renderer |
| electron | 44.7.2 | Development shell tooling |
| typescript | 5.9.3 | Development compiler |
| vite | 8.3.4 | Renderer bundling |
| @vitejs/plugin-react | 6.1.2 | Renderer transform |
| ws | 8.22.0 | Privileged socket transport only |
| @electron/packager | 20.3.0 | Unsigned application directories for proof |
| @electron/fuses | 2.1.3 | Packaged capability restrictions |

React DOM requires React ^19.3.1; RN Web accepts React/React DOM 18 or 19; RN 0.88.0 requires React ^19.3.0. The listed Node engine ranges admit 22.23.0. React Native is a substantial development graph even without mobile runtime use. Alias exact `react-native` imports to RN Web; reject native-only/deep imports. Do not add Metro, Expo, RN Windows, or another renderer.

Declaration packages and any mandatory bundler peers must be resolved to exact compatible pins before installation. Optional Babel/compiler/style/native-acceleration peers are not permission to add them indiscriminately. No lockfile, install, vulnerability audit, transitive license audit, type-check or package build has been performed for this proposal.

Sources: npm version metadata at `https://registry.npmjs.org/<package>/<version>`; [RN Web setup](https://necolas.github.io/react-native-web/docs/setup/); [Electron security](https://www.electronjs.org/docs/latest/tutorial/security); [pinned safeStorage](https://github.com/electron/electron/blob/v44.7.2/docs/api/safe-storage.md); [pinned fuses](https://github.com/electron/electron/blob/v44.7.2/docs/tutorial/fuses.md); [preload module rules](https://www.electronjs.org/docs/latest/tutorial/esm).

## Blocking proof gates

1. **Clean graph and strict compilation:** exact pins, lockfile integrity, engine/peer checks, licenses and vulnerability review. Separate main/preload/renderer boundaries. A sandboxed preload cannot simply load arbitrary ESM modules; do not disable sandboxing to work around that.
2. **Packaged trust boundary:** sandbox/context isolation on, Node integration off, packaged fixed origin, restrictive CSP, denied navigation/popups and permissions, finite runtime-validated IPC. Validate sender frame/origin/generation. No renderer tokens, generic fetch/RPC, shell or filesystem bridge. Inspect packaged fuses, not just source settings.
3. **OS credentials:** Windows DPAPI-backed account isolation; Ubuntu Secret Service. Electron safeStorage `basic_text` is insecure and must be rejected. API availability or ciphertext appearance is not backend attestation. Exercise locked/missing keyring, cancelled unlock, D-Bus loss, provider restart, lock/suspend and corrupt records. Preserve existing ciphertext on temporary failure. The synchronous backend selector must not be used to attest an unrelated async provider. If safeStorage cannot prove fail-closed behavior and acceptable responsiveness, propose a separately approved adapter.
4. **Durable state:** owner-bound protected records, transactional/CAS writes, crash injection around flush/rename, disk full, concurrent writers and stale rotation. Synthetic commit fakes do not qualify disk durability.
5. **Transport:** privileged custom-header HTTP/WS, no authenticated redirects, explicit frame bounds/UTF-8 handling, finite callbacks and fresh socket tickets. Register server requests before advertising support. Use scripted endpoints first, then an authorized disposable Hermes clone.
6. **Lifecycle:** tray/autostart off by default; explicit opt-in. Full Quit retires callbacks and ends client alerts without cancelling remote Hermes work. Real notification enrollment remains a separate host/plugin contract question. No hidden service or after-quit cloud delivery.
7. **Target evidence:** unsigned packaged artifacts on Windows 11 x64 and Ubuntu 24.04 x64 under both Wayland and X11. Record actual OS/session/backend/artifact versions. macOS development results do not qualify these rows. Long-chat input/IME, accessibility, media and visual proofs still remain for full P0.

No product UI, installer, signing, updater, production host or cloud deployment is approved by this proposal.
