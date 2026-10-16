// Focused exception-path checks. Rendering is stubbed; the actual test-only
// fixture setup/cleanup and smoke runner execute, without Electron or any host.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';
import { createContext, runInContext } from 'node:vm';
import { fileURLToPath } from 'node:url';
import { runWorkspaceFixture } from '../scripts/qualification/workspace-ui-smoke.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const fixture = await build({ absWorkingDir: root,
  entryPoints: ['scripts/qualification/workspace-ui-fixture.tsx'], bundle: true,
  write: false, platform: 'browser', format: 'iife', jsx: 'automatic', logLevel: 'silent',
  plugins: [{ name: 'rendering-only-stubs', setup(builder) {
    builder.onResolve({ filter: /(?:react-dom\/client|react\/jsx-runtime|packages\/ui\/App\.tsx)$/ }, args => ({ path: args.path, namespace: 'rendering-only-stubs' }));
    builder.onLoad({ filter: /.*/, namespace: 'rendering-only-stubs' }, args => ({ contents:
      args.path === 'react-dom/client' ? 'export const createRoot = container => globalThis.renderer.createRoot(container);' :
        args.path === 'react/jsx-runtime' ? 'export const jsx = (type, props) => ({ type, props });' :
          'export const ConnectedApp = () => null;', loader: 'js' }));
  } }],
});
const fixtureCode = fixture.outputFiles[0].text;

function harness({ hidden = null, inert = null, failCreate = false, failRender = false, failUnmount = false } = {}) {
  const elements = new Map();
  class Element {
    id = ''; style = {}; attributes = new Map(); attached = false;
    get hidden() { return this.attributes.has('hidden'); }
    set hidden(value) { if (value) this.setAttribute('hidden', ''); else this.removeAttribute('hidden'); }
    get inert() { return this.attributes.has('inert'); }
    set inert(value) { if (value) this.setAttribute('inert', ''); else this.removeAttribute('inert'); }
    setAttribute(name, value) { this.attributes.set(name, value); }
    getAttribute(name) { return this.attributes.get(name) ?? null; }
    removeAttribute(name) { this.attributes.delete(name); }
    remove() { elements.delete(this.id); this.attached = false; }
  }
  const original = new Element(); original.id = 'root'; original.attached = true; elements.set('root', original);
  if (hidden !== null) original.setAttribute('hidden', hidden);
  if (inert !== null) original.setAttribute('inert', inert);
  const observations = { creates: 0, renders: 0, unmounts: 0, hiddenBeforeCreate: false, cleanup: null };
  const context = createContext({ document: {
    createElement: () => new Element(), getElementById: id => elements.get(id) ?? null,
    body: { append: element => { elements.set(element.id, element); element.attached = true; } },
  }, renderer: { createRoot: container => {
    observations.creates++;
    observations.hiddenBeforeCreate = original.hidden && original.inert && container.attached;
    assert.equal(context.workspaceQualification, undefined, 'controller is not registered at createRoot');
    observations.cleanup = context.workspaceQualificationCleanup;
    if (failCreate) throw new Error('create-root failed after DOM insertion');
    return {
      render: () => { observations.renders++; if (failRender) throw new Error('render failed'); },
      unmount: () => { observations.unmounts++; if (failUnmount) throw new Error('unmount failed'); },
    };
  } } });
  runInContext('globalThis.window=globalThis', context);
  const restored = () => {
    assert.equal(elements.has('workspace-qualification'), false);
    assert.equal(context.workspaceQualification, undefined);
    assert.equal(context.workspaceQualificationCleanup, undefined);
    assert.equal(original.getAttribute('hidden'), hidden);
    assert.equal(original.getAttribute('inert'), inert);
  };
  return { context, observations, restored };
}

for (const attributes of [{ hidden: null, inert: null }, { hidden: 'until-found', inert: 'preserved-value' }]) {
  test(`partial setup exception restores exact original attributes ${JSON.stringify(attributes)}`, () => {
    const h = harness({ ...attributes, failCreate: true });
    assert.throws(() => runInContext(fixtureCode, h.context), /create-root failed after DOM insertion/u);
    assert.equal(h.observations.hiddenBeforeCreate, true);
    assert.equal(typeof h.observations.cleanup, 'function', 'fallback is registered before live DOM changes');
    h.restored(); h.observations.cleanup(); h.restored();
    assert.equal(h.observations.unmounts, 0);
  });
}

test('render exception before ready controller unmounts once and restores DOM', () => {
  const h = harness({ failRender: true });
  assert.throws(() => runInContext(fixtureCode, h.context), /render failed/u);
  h.restored(); h.observations.cleanup(); h.restored();
  assert.equal(h.observations.unmounts, 1);
});

test('cleanup remains idempotent and restores DOM when React unmount throws', () => {
  const h = harness({ failUnmount: true }); runInContext(fixtureCode, h.context);
  assert.throws(() => h.context.workspaceQualification.cleanup(), /unmount failed/u);
  h.restored(); h.observations.cleanup(); h.restored();
  assert.equal(h.observations.unmounts, 1);
});

for (const failure of ['exceptionDetails', 'protocolError', 'transportError']) {
  test(`runner tears down when injection reports ${failure}`, async () => {
    const h = harness(); const checks = []; let teardownAttempts = 0;
    await assert.rejects(runWorkspaceFixture({ root, sleep: async () => {}, capture: async () => {},
      check: (name, ok) => checks.push({ name, ok }),
      evaluate: async expression => { if (expression.includes('workspaceQualificationCleanup ??')) teardownAttempts++; return runInContext(expression, h.context); },
      send: async () => {
        if (failure === 'transportError') throw new Error('CDP transport failed');
        return failure === 'exceptionDetails' ? { result: { exceptionDetails: { text: 'Synthetic injection failure' } } } : { error: { message: 'Synthetic protocol error' } };
      },
    }), failure === 'transportError' ? /CDP transport failed/u : /Synthetic fixture injection failed/u);
    assert.equal(teardownAttempts, 1); assert.deepEqual(checks, [{ name: 'synthetic UI root and controller removed', ok: true }]); h.restored();
  });
}

test('runner tears down a partial fixture injection failure before controller registration', async () => {
  const h = harness({ failCreate: true }); const checks = []; let teardownAttempts = 0;
  await assert.rejects(runWorkspaceFixture({ root, sleep: async () => {}, capture: async () => {},
    check: (name, ok) => checks.push({ name, ok }),
    evaluate: async expression => { if (expression.includes('workspaceQualificationCleanup ??')) teardownAttempts++; return runInContext(expression, h.context); },
    send: async () => { try { runInContext(fixtureCode, h.context); } catch { return { result: { exceptionDetails: { text: 'Partial fixture failure' } } }; } throw new Error('Expected partial setup failure'); },
  }), /Synthetic fixture injection failed/u);
  assert.equal(teardownAttempts, 1); assert.equal(h.observations.hiddenBeforeCreate, true);
  assert.deepEqual(checks, [{ name: 'synthetic UI root and controller removed', ok: true }]); h.restored();
});

test('runner tears down actual fixture lifecycle after a later interaction failure', async () => {
  const h = harness({ hidden: 'until-found', inert: '' }); const checks = [];
  await assert.rejects(runWorkspaceFixture({ root, sleep: async () => {}, capture: async () => {},
    check: (name, ok) => checks.push({ name, ok }),
    evaluate: async expression => {
      if (expression.startsWith('Boolean(')) { assert.ok(h.context.workspaceQualification); throw new Error('Later interaction failed'); }
      return runInContext(expression, h.context);
    },
    send: async () => { runInContext(fixtureCode, h.context); h.context.qualificationComposer = {}; return { result: {} }; },
  }), /Later interaction failed/u);
  assert.equal(h.observations.renders, 1); assert.equal(h.observations.unmounts, 1);
  assert.equal(h.context.qualificationComposer, undefined);
  assert.deepEqual(checks, [{ name: 'synthetic UI root and controller removed', ok: true }]);
  h.restored(); h.observations.cleanup(); h.restored(); assert.equal(h.observations.unmounts, 1);
});
