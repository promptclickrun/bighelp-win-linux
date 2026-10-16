import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readdir, readFile, writeFile, symlink, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash, createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

// Synthetic authenticated encryption: no OS key-store qualification implied.
const secret = randomBytes(32);
const protection = {
  isEncryptionAvailable: () => true,
  getSelectedStorageBackend: () => 'gnome_libsecret',
  encryptString(text) {
    const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', secret, iv);
    const body = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), body]);
  },
  decryptString(bytes) {
    const input = Buffer.from(bytes), cipher = createDecipheriv('aes-256-gcm', secret, input.subarray(0, 12));
    cipher.setAuthTag(input.subarray(12, 28));
    return Buffer.concat([cipher.update(input.subarray(28)), cipher.final()]).toString('utf8');
  },
};
const pathFor = (directory, key) => join(directory, `${createHash('sha256').update(key).digest('hex')}.enc`);
async function setup(t) {
  const directory = await mkdtemp(join(tmpdir(), 'bighelp-protected-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const { createProtectedRepository } = await import('../packages/platform/protected-repository.ts');
  const open = (overrides = {}) => createProtectedRepository({ directory, protection, platform: 'linux', ...overrides });
  return { directory, open };
}

test('encrypted roundtrip, reload, CAS serialization and scoped removal', async t => {
  const { directory, open } = await setup(t);
  let repository = await open();
  assert.equal(await repository.read('opaque/key'), null);
  assert.deepEqual(await repository.write('opaque/key', null, { text: 'private draft' }), { revision: 1, value: { text: 'private draft' } });
  assert.equal((await readFile(pathFor(directory, 'opaque/key'))).includes(Buffer.from('private draft')), false);
  const results = await Promise.allSettled([repository.write('opaque/key', 1, 'first'), repository.write('opaque/key', 1, 'second')]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  await assert.rejects(open(), /locked/);
  await repository.close();
  repository = await open();
  assert.deepEqual(await repository.read('opaque/key'), { revision: 2, value: 'first' });
  await repository.write('other', null, true);
  await assert.rejects(repository.remove('opaque/key', 1), /revision/);
  await repository.remove('opaque/key', 2);
  assert.equal(await repository.read('opaque/key'), null);
  assert.deepEqual(await repository.read('other'), { revision: 1, value: true });
  await repository.close();
  await assert.rejects(repository.read('other'), /closed/);
});

test('unavailable and Linux basic_text protection refuse persistence', async t => {
  const { open } = await setup(t);
  await assert.rejects(open({ protection: { ...protection, isEncryptionAvailable: () => false } }), /protection/);
  await assert.rejects(open({ protection: { ...protection, getSelectedStorageBackend: () => 'basic_text' } }), /protection/);
  const repository = await open();
  protection.isEncryptionAvailable = () => false;
  try { await assert.rejects(repository.write('key', null, 'secret'), /protection/); }
  finally { protection.isEncryptionAvailable = () => true; await repository.close(); }
});

test('invalid values, corruption, substituted identity and unsafe files fail closed', async t => {
  const { directory, open } = await setup(t), repository = await open();
  for (const key of ['', 'a'.repeat(1025), '\ud800']) await assert.rejects(repository.read(key));
  for (const value of [undefined, NaN, new Date(), { a: undefined }, 'a'.repeat(1024 * 1024 + 1)]) {
    await assert.rejects(repository.write('key', null, value));
  }
  await repository.write('key', null, 'value');
  await writeFile(pathFor(directory, 'other'), await readFile(pathFor(directory, 'key')));
  await assert.rejects(repository.read('other'));
  await writeFile(pathFor(directory, 'key'), 'broken');
  await assert.rejects(repository.read('key'));
  await rm(pathFor(directory, 'key'));
  await symlink(pathFor(directory, 'other'), pathFor(directory, 'key'));
  await assert.rejects(repository.read('key'));
  await rm(pathFor(directory, 'key'));
  await mkdir(pathFor(directory, 'key'));
  await assert.rejects(repository.read('key'));
  await repository.close();
});

test('encryption failure and interrupted temporary writes preserve committed value', async t => {
  const { directory, open } = await setup(t);
  let fail = false;
  const repository = await open({ protection: { ...protection, encryptString(text) { if (fail) throw Error('synthetic encryption failure'); return protection.encryptString(text); } } });
  await repository.write('key', null, 'old');
  fail = true;
  await assert.rejects(repository.write('key', 1, 'new'));
  assert.deepEqual(await repository.read('key'), { revision: 1, value: 'old' });
  await writeFile(join(directory, '.interrupted.tmp'), protection.encryptString('uncommitted'));
  await repository.close();
  const reopened = await open();
  assert.deepEqual(await reopened.read('key'), { revision: 1, value: 'old' });
  assert.ok((await readdir(directory)).includes('.interrupted.tmp'));
  await reopened.close();
});

test('another process cannot acquire a live lock and dead owners are safely reclaimed', async t => {
  const { directory, open } = await setup(t);
  const { execFile, spawn } = await import('node:child_process');
  const { once } = await import('node:events');
  const { promisify } = await import('node:util');
  const run = promisify(execFile);
  const moduleUrl = new URL('../packages/platform/protected-repository.ts', import.meta.url).href;
  const program = `import { createProtectedRepository } from ${JSON.stringify(moduleUrl)};
    const repository = await createProtectedRepository({directory: process.argv[1], platform:'linux', protection: {
      isEncryptionAvailable:()=>true, getSelectedStorageBackend:()=> 'synthetic',
      encryptString: text => Buffer.from(text), decryptString: bytes => Buffer.from(bytes).toString()
    }}); process.exit(0);`;
  const repository = await open();
  await assert.rejects(run(process.execPath, ['--experimental-strip-types', '--input-type=module', '-e', program, directory]), /Repository locked/);
  await repository.close();
  const child = spawn(process.execPath, ['--experimental-strip-types', '--input-type=module', '-e',
    program.replace('process.exit(0);', "process.send('ready'); setInterval(() => {}, 1000);"), directory], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
  await once(child, 'message');
  const exited = once(child, 'exit');
  child.kill('SIGKILL');
  await exited;
  const recovered = await open();
  await recovered.write('after-crash', null, true);
  await recovered.close();
});

test('oversized files are rejected before decryption and file modes are private', async t => {
  const { directory, open } = await setup(t);
  let decryptions = 0;
  const repository = await open({ protection: { ...protection, decryptString(bytes) { decryptions++; return protection.decryptString(bytes); } } });
  await repository.write('key', null, 'secret');
  const { stat } = await import('node:fs/promises');
  if (process.platform !== 'win32') assert.equal((await stat(pathFor(directory, 'key'))).mode & 0o777, 0o600);
  await writeFile(pathFor(directory, 'key'), Buffer.alloc(2 * 1024 * 1024));
  await assert.rejects(repository.read('key'), /file/);
  assert.equal(decryptions, 0);
  await repository.close();
});

test('JSON strings with escaped quotes do not count brackets as nested values', async t => {
  const { open } = await setup(t), repository = await open();
  const value = '"' + '['.repeat(100) + '\\end';
  await repository.write('key', null, value);
  assert.deepEqual(await repository.read('key'), { revision: 1, value });
  await repository.close();
});

test('queued writes snapshot their input and rejected updates leave prior revision intact', async t => {
  const { open } = await setup(t), repository = await open();
  const value = { text: 'before' };
  const pending = repository.write('key', null, value);
  value.text = 'after';
  await pending;
  let deeplyNested = null;
  for (let index = 0; index < 70; index++) deeplyNested = [deeplyNested];
  await assert.rejects(repository.write('key', 1, deeplyNested));
  await assert.rejects(repository.write('key', 1, { get secret() { throw Error('must not invoke accessor'); } }));
  assert.deepEqual(await repository.read('key'), { revision: 1, value: { text: 'before' } });
  await repository.close();
});

test('newer envelopes remain untouched and a symlink directory is rejected', async t => {
  const { directory, open } = await setup(t), repository = await open();
  const bytes = protection.encryptString(JSON.stringify({ version: 2, key: 'key', revision: 1, value: 'preserve' }));
  await writeFile(pathFor(directory, 'key'), bytes);
  await assert.rejects(repository.write('key', 1, 'replacement'));
  assert.deepEqual(await readFile(pathFor(directory, 'key')), bytes);
  await repository.close();
  const link = join(directory, 'linked');
  await symlink(directory, link);
  await assert.rejects(open({ directory: link }), /directory/);
});


test('missing owner metadata and abandoned recovery claims fail closed', async t => {
  const { directory, open } = await setup(t);
  const lock = join(directory, '.repository.lock');
  await mkdir(lock);
  await assert.rejects(open(), /locked/);
  await writeFile(join(lock, 'owner'), JSON.stringify({ pid: process.pid, nonce: 'a'.repeat(36) }));
  await mkdir(join(lock, 'reclaim'));
  await assert.rejects(open(), /locked/);
});

async function observeSync(t, directory, hook) {
  const { open } = await import('node:fs/promises');
  const probe = await open(directory, 'r');
  const prototype = Object.getPrototypeOf(probe), original = prototype.sync;
  await probe.close();
  t.mock.method(prototype, 'sync', async function () {
    const stat = await this.stat();
    await hook(stat);
    return original.call(this);
  });
}

test('POSIX writes and removals sync the containing directory after changing entries', async t => {
  if (process.platform === 'win32') return t.skip('POSIX filesystem semantics');
  const { directory, open } = await setup(t);
  let syncs = 0, expected = 'creating';
  await observeSync(t, directory, async stat => {
    if (!stat.isDirectory()) return;
    syncs++;
    if (expected === 'written') assert.ok((await readFile(pathFor(directory, 'key'))).length);
    if (expected === 'removed') await assert.rejects(readFile(pathFor(directory, 'key')), { code: 'ENOENT' });
  });
  const repository = await open();
  assert.ok(syncs >= 2, 'lock metadata and repository entries are synced during creation');
  const before = syncs;
  expected = 'written';
  await repository.write('key', null, 'value');
  assert.ok(syncs > before, 'write awaited directory sync');
  const afterWrite = syncs;
  expected = 'removed';
  await repository.remove('key', 1);
  assert.ok(syncs > afterWrite, 'remove awaited directory sync');
  await repository.close();
});

test('POSIX directory sync failure reports uncertainty and blocks further operations until reopen', async t => {
  if (process.platform === 'win32') return t.skip('POSIX filesystem semantics');
  const { directory, open } = await setup(t), repository = await open();
  let fail = true;
  await observeSync(t, directory, stat => { if (stat.isDirectory() && fail) throw Error('synthetic sync failure'); });
  await assert.rejects(repository.write('key', null, 'value'), /durability.*uncertain/i);
  await assert.rejects(repository.write('other', null, 'blocked'), /reopen/i);
  fail = false;
  await repository.close();
  const reopened = await open();
  assert.deepEqual(await reopened.read('key'), { revision: 1, value: 'value' });
  await reopened.close();
});

test('values at JSON node and depth limits remain readable after envelope wrapping', async t => {
  const { open } = await setup(t), repository = await open();
  const nodes = Array(99_999).fill(0);
  await repository.write('nodes', null, nodes);
  assert.equal((await repository.read('nodes')).value.length, nodes.length);
  let depth = null;
  for (let index = 0; index < 64; index++) depth = [depth];
  await repository.write('depth', null, depth);
  assert.deepEqual((await repository.read('depth')).value, depth);
  await assert.rejects(repository.write('nodes', 1, 'x'.repeat(1024 * 1024 - 2)), /size/);
  assert.equal((await repository.read('nodes')).revision, 1);
  await repository.close();
});

test('POSIX failed removal sync reports uncertainty without pretending the record survived', async t => {
  if (process.platform === 'win32') return t.skip('POSIX filesystem semantics');
  const { directory, open } = await setup(t), repository = await open();
  await repository.write('key', null, 'value');
  let fail = true;
  await observeSync(t, directory, stat => { if (stat.isDirectory() && fail) throw Error('synthetic sync failure'); });
  await assert.rejects(repository.remove('key', 1), /durability.*uncertain/i);
  await assert.rejects(repository.read('key'), /reopen/i);
  fail = false;
  await repository.close();
  const reopened = await open();
  assert.equal(await reopened.read('key'), null);
  await reopened.close();
});

test('values close to the complete envelope byte limit roundtrip', async t => {
  const { open } = await setup(t), repository = await open();
  const value = 'x'.repeat(1024 * 1024 - 128);
  await repository.write('key', null, value);
  assert.equal((await repository.read('key')).value, value);
  await repository.close();
});
