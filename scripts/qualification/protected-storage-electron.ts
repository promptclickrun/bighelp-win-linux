// Disposable main-process entry only. Never import the application or load hosts.
import { app, safeStorage } from 'electron';
import { writeFile } from 'node:fs/promises';
import { isDeepStrictEqual } from 'node:util';
import { join, resolve } from 'node:path';
import { createProtectedRepository } from '../../packages/platform/protected-repository.ts';

function probeArguments() {
  // Electron retains switches before the entry path in process.argv on Linux.
  // Validate the caller's two matching paths rather than __filename: Windows
  // can canonicalize the module's path spelling (including short temp paths).
  const entryIndex = process.argv.length - 3;
  const [phase, directory] = process.argv.slice(-2);
  if ((phase !== 'write' && phase !== 'read') || !directory || resolve(directory) !== directory
    || entryIndex < 1 || process.argv[entryIndex] !== join(directory, 'probe.cjs')
    || process.argv.slice(1, entryIndex).some(value => !['--ozone-platform=headless', '--disable-gpu'].includes(value))
    || !['linux', 'win32'].includes(process.platform)) process.exit(2);
  return { phase, directory };
}
const { phase, directory } = probeArguments();

// All Electron profile/cache state belongs to the caller-created temporary root.
app.setName('bighelp-os-protection-qualification');
app.setPath('userData', join(directory, 'user-data'));
app.setPath('sessionData', join(directory, 'session-data'));
app.setPath('crashDumps', join(directory, 'crash-dumps'));
app.enableSandbox();
const deadline = setTimeout(() => app.exit(1), 25_000);

const key = 'synthetic-protected-restart-v1';
const value = { marker: 'synthetic-bighelp-os-protection-restart-value-v1', sequence: 1 };
const linuxBackends = ['gnome_libsecret', 'kwallet', 'kwallet5', 'kwallet6'];
let backend = 'unknown';
let repository: Awaited<ReturnType<typeof createProtectedRepository>> | undefined;

async function report(status: string, reason: string): Promise<void> {
  await writeFile(join(directory, `${phase}.json`), JSON.stringify({
    phase, status, reason, backend, electron: process.versions.electron,
  }), { flag: 'wx', mode: 0o600 });
}

void app.whenReady().then(async () => {
  const available = safeStorage.isEncryptionAvailable();
  const selected = process.platform === 'linux' ? safeStorage.getSelectedStorageBackend() : 'windows-dpapi';
  backend = ['windows-dpapi', 'basic_text', ...linuxBackends].includes(selected) ? selected : 'unknown';
  if (!available || (process.platform === 'linux' && !linuxBackends.includes(backend))) {
    await report('unavailable', 'os-encryption-unavailable');
    return;
  }
  // Same safeStorage adapter as desktop main; no fake or plaintext fallback.
  repository = await createProtectedRepository({ directory: join(directory, 'protected'), platform: process.platform,
    protection: { isEncryptionAvailable: () => safeStorage.isEncryptionAvailable(),
      getSelectedStorageBackend: () => process.platform === 'linux' ? safeStorage.getSelectedStorageBackend() : 'os',
      encryptString: text => safeStorage.encryptString(text),
      decryptString: bytes => safeStorage.decryptString(Buffer.from(bytes)) } });
  if (phase === 'write') {
    if (await repository.read(key) !== null) throw Error('Unexpected existing value');
    const written = await repository.write(key, null, value);
    if (!isDeepStrictEqual(written, { revision: 1, value })) throw Error('Write mismatch');
  } else if (!isDeepStrictEqual(await repository.read(key), { revision: 1, value })) {
    throw Error('Restart read mismatch');
  }
  await repository.close();
  repository = undefined;
  await report('passed', phase === 'write' ? 'synthetic-value-written' : 'synthetic-value-recovered');
}).catch(async () => {
  // Never emit raw Electron/keyring errors, paths, credentials, or plaintext.
  try { await repository?.close(); } catch { /* still report only a fixed category */ }
  try { await report('failed', 'protected-storage-operation-failed'); } catch { /* parent detects missing report */ }
  process.exitCode = 1;
}).finally(() => {
  clearTimeout(deadline);
  app.exit(process.exitCode === 1 ? 1 : 0);
});
