import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import { createDesktopService } from '../apps/desktop/src/main/desktop-service.ts';
import { parseDesktopAction } from '../apps/desktop/src/shared/desktop-api.ts';
import { DEFAULT_PREFERENCES, parsePreferenceChanges } from '../apps/desktop/src/shared/preferences.ts';
import {
  decodeApprovalMode, decodeModelInfo, decodeModelOptions, decodeModelSet, decodeReactionsSet, decodeReactionsSetting,
  decodeSkills, decodeToolsets,
} from '../packages/contracts/settings.ts';
import {
  approvalSummary, bugReport, cleanPersonName, CONFIRM_WINDOW_MS, MODEL_FLOW_IDLE, modelKey, modelOptions, parseModelKey,
  personNameChange, reduceModelFlow,
} from '../packages/domain/settings.ts';
import { createShellState, EVERYDAY_SETTINGS, reduceShell, settingsSections } from '../packages/domain/shell.ts';
import { HttpStatusError } from '../packages/platform/transport-policy.ts';

// Shapes recorded from a disposable Hermes 0.22.1 host (addresses replaced with documentation values).
const REAL_OPTIONS = {
  providers: [{ slug: 'custom', name: 'Custom endpoint', is_current: true, is_user_defined: true,
    models: ['gemma4:e2b', 'nomic-embed-text:latest'], total_models: 2, source: 'model-config', api_url: 'http://192.0.2.10:11434/v1',
    native_catalog_empty: false, authenticated: true, capabilities: { 'gemma4:e2b': { fast: false, reasoning: true } },
    featured_models: [], aliases: ['custom', 'custom endpoint'] }],
  model: 'gemma4:e2b', provider: 'custom',
};
const SPEC_OPTIONS = {
  providers: [
    { slug: 'example-provider', name: 'Example Provider', is_current: true, models: ['model-a', 'model-b', 'model-a', 'gone'],
      unavailable_models: ['gone'], authenticated: true, pricing: { 'model-a': { input: '$3.00' } } },
    { slug: 'other-provider', name: 'Other Provider', models: [], authenticated: false, key_env: 'OTHER_API_KEY',
      warning: 'paste OTHER_API_KEY to activate' },
    { slug: 'example-provider', name: 'Duplicate', models: ['model-z'] },
    { slug: 'bad slug ', name: 'Bad', models: ['x'] },
    'not a row',
    { slug: 'my-lab', name: 'My‮ Lab\n', models: ['m1'], api_url: 'http://192.0.2.10/v1', aliases: ['custom:my-lab'] },
  ],
  model: 'model-a', provider: 'example-provider',
};
const REAL_TOOLSETS = [
  { name: 'web', label: 'Web Search & Scraping', description: 'web_search, web_extract', platform: 'cli', platform_label: 'CLI',
    enabled: false, available: false, configured: true, tools: ['web_extract', 'web_search'] },
  { name: 'terminal', label: 'Terminal & Processes', description: 'terminal, process', platform: 'cli', platform_label: 'CLI',
    enabled: true, available: true, configured: true, tools: ['process_manage', 'terminal'] },
  { name: 'bighelp_workflows', label: 'Bighelp Workflows', description: "The bighelp app's plugin for Hermes.\n", platform: 'cli',
    platform_label: 'CLI', enabled: true, available: true, configured: true, tools: ['bighelp_workflows'] },
];
const REAL_SKILLS = [
  { name: 'apple-notes', description: 'Manage Apple Notes via memo CLI: create, search, edit.', category: 'apple', enabled: true, usage: 0, provenance: 'bundled' },
  { name: 'blocked-page-recovery', description: 'Use when a fetch fails: 403/429, paywall, WAF, bot wall.', category: 'web', enabled: true, usage: 0, provenance: 'bundled' },
];

test('settings calls refuse unknown fields, wrong types and unsafe profile names before main runs them', () => {
  const call = (name, input) => parseDesktopAction({ kind: 'call', connection: 1, name, input });
  assert.deepEqual(call('settings.models', { profile: 'default' }).input, { profile: 'default' });
  assert.deepEqual(call('settings.setModel', { profile: 'default', provider: 'custom', model: 'gemma4:e2b', confirmExpensive: false }).input,
    { profile: 'default', provider: 'custom', model: 'gemma4:e2b', confirmExpensive: false });
  for (const [name, input] of [
    ['settings.models', {}], ['settings.models', { profile: '../env' }], ['settings.models', { profile: 'a b' }],
    ['settings.models', { profile: '' }], ['settings.models', { profile: 'default', url: '/api/env' }],
    ['settings.setModel', { profile: 'default', provider: 'custom', model: 'm' }],
    ['settings.setModel', { profile: 'default', provider: 'custom', model: 'm', confirmExpensive: 'yes' }],
    ['settings.setModel', { profile: 'default', provider: 'custom', model: 'm\n', confirmExpensive: false }],
    ['settings.setModel', { profile: 'default', provider: 'custom', model: 'm', confirmExpensive: false, base_url: 'http://x' }],
    ['settings.setModel', { profile: 'default', provider: 'custom', model: 'm', confirmExpensive: false, api_key: 'k' }],
    ['settings.reactions', { on: true }], ['settings.setReactions', { on: 'true' }], ['settings.setReactions', {}],
    ['settings.approvals', { profile: 'default', key: 'approvals.mode' }], ['settings.toolsets', { profile: 1 }],
    ['settings.skills', null], ['settings.config', {}],
  ]) assert.throws(() => call(name, input), `${name} ${JSON.stringify(input)} must be refused`);
});

test('model options decode to provider names and model names only', () => {
  const real = decodeModelOptions(REAL_OPTIONS);
  assert.deepEqual(real, { current: { provider: 'custom', model: 'gemma4:e2b' },
    providers: [{ id: 'custom', name: 'Custom endpoint', models: ['gemma4:e2b', 'nomic-embed-text:latest'] }] });
  assert.equal(JSON.stringify(real).includes('192.0.2.10'), false, 'endpoint addresses never leave main');
  assert.ok(Object.isFrozen(real) && Object.isFrozen(real.providers[0].models));
  const spec = decodeModelOptions(SPEC_OPTIONS);
  assert.deepEqual(spec.providers.map(row => [row.id, row.name, row.models]), [
    ['example-provider', 'Example Provider', ['model-a', 'model-b']],
    ['my-lab', 'My Lab', ['m1']],
  ], 'signed-out, duplicate, malformed and unavailable entries are left out; hidden characters removed');
  assert.equal(JSON.stringify(spec).match(/OTHER_API_KEY|pricing|\$3/u), null);
  assert.deepEqual(decodeModelOptions({ providers: [] }), { current: null, providers: [] });
  assert.throws(() => decodeModelOptions({ providers: 'x' }));
  assert.throws(() => decodeModelOptions([]));
});

test('model set replies are either saved or a confirmation question', () => {
  assert.deepEqual(decodeModelSet({ ok: true, scope: 'main', provider: 'custom', model: 'gemma4:e2b', base_url: 'http://192.0.2.10/v1',
    gateway_tools: [], stale_aux: [] }), { status: 'saved', provider: 'custom', model: 'gemma4:e2b' });
  assert.deepEqual(decodeModelSet({ ok: false, scope: 'main', provider: 'p', model: 'm', confirm_required: true,
    confirm_message: 'This model costs about $15 per million output tokens.‮\n\n\n\nContinue?' }),
  { status: 'confirm', message: 'This model costs about $15 per million output tokens. \n\nContinue?' });
  for (const reply of [{ ok: false }, { ok: true, provider: 'p' }, { ok: true, scope: 'auxiliary', provider: 'p', model: 'm' },
    { confirm_required: true, confirm_message: '' }, { confirm_required: true, confirm_message: 'x'.repeat(5000) },
    { ok: true, confirm_required: true, confirm_message: 'x' }, null, []]) {
    assert.throws(() => decodeModelSet(reply), JSON.stringify(reply));
  }
  assert.deepEqual(decodeModelInfo({ model: 'gemma4:e2b', provider: 'custom', auto_context_length: 131072, capabilities: {} }),
    { provider: 'custom', model: 'gemma4:e2b' });
  assert.equal(decodeModelInfo({ model: '', provider: '' }), null);
});

test('approval mode, reactions, toolsets and skills decode to small display data', () => {
  assert.equal(decodeApprovalMode({ value: 'manual' }), 'manual');
  assert.equal(decodeApprovalMode({ value: 'smart' }), 'smart');
  assert.throws(() => decodeApprovalMode({ value: 'yolo' }));
  assert.throws(() => decodeApprovalMode('manual'));
  // The config document can carry expanded secrets; only the boolean is read.
  assert.equal(decodeReactionsSetting({ model: 'x', providers: { a: { api_key: 'sk-synthetic' } }, display: { message_reactions: true } }), true);
  assert.equal(decodeReactionsSetting({ display: { skin: 'default' } }), false);
  assert.equal(decodeReactionsSetting({}), false);
  assert.equal(decodeReactionsSetting({ display: { message_reactions: 'false' } }), true, 'Hermes reads the stored value with Python truthiness');
  assert.throws(() => decodeReactionsSetting({ display: { message_reactions: [] } }));
  assert.equal(decodeReactionsSet({ key: 'display.message_reactions', value: false }), false);
  assert.throws(() => decodeReactionsSet({ key: 'display.message_reactions', value: 'true' }));
  assert.throws(() => decodeReactionsSet({ key: 'approvals.mode', value: true }));
  const toolsets = decodeToolsets([...REAL_TOOLSETS, { name: 'terminal', label: 'dup' }, { name: '' }, 7]);
  assert.deepEqual(toolsets.map(set => [set.name, set.label, set.enabled, set.available]), [
    ['web', 'Web Search & Scraping', false, false], ['terminal', 'Terminal & Processes', true, true],
    ['bighelp_workflows', 'Bighelp Workflows', true, true]]);
  assert.equal(toolsets[2].description, "The bighelp app's plugin for Hermes.");
  assert.equal(Object.hasOwn(toolsets[0], 'platform'), false);
  assert.deepEqual(decodeSkills([...REAL_SKILLS, { name: 'off', enabled: false }]).map(skill => [skill.name, skill.category]),
    [['apple-notes', 'apple'], ['blocked-page-recovery', 'web']]);
  assert.equal(Object.hasOwn(decodeSkills(REAL_SKILLS)[0], 'provenance'), false);
  assert.throws(() => decodeSkills({ skills: [] }));
});

test('expensive-model confirmation: pick, confirm once, then saved; nothing resends by itself', () => {
  const pick = { provider: 'example-provider', model: 'model-a' };
  let flow = reduceModelFlow(MODEL_FLOW_IDLE, { type: 'pick', pick });
  assert.deepEqual(flow, { phase: 'saving', pick, confirmed: false });
  assert.equal(reduceModelFlow(flow, { type: 'pick', pick: { provider: 'x', model: 'y' } }), flow, 'one save at a time');
  flow = reduceModelFlow(flow, { type: 'reply', now: 1000, result: { ok: true, value: { status: 'confirm', message: 'Costs more.' } } });
  assert.deepEqual(flow, { phase: 'confirm', pick, message: 'Costs more.', expiresAt: 1000 + CONFIRM_WINDOW_MS });
  assert.equal(reduceModelFlow(flow, { type: 'pick', pick }), flow, 'a pending question blocks another pick');
  assert.equal(reduceModelFlow(flow, { type: 'cancel' }), MODEL_FLOW_IDLE);
  const late = reduceModelFlow(flow, { type: 'confirm', now: 1001 + CONFIRM_WINDOW_MS });
  assert.equal(late.phase, 'failed');
  assert.equal(late.unknown, false);
  flow = reduceModelFlow(flow, { type: 'confirm', now: 2000 });
  assert.deepEqual(flow, { phase: 'saving', pick, confirmed: true });
  const again = reduceModelFlow(flow, { type: 'reply', now: 2100, result: { ok: true, value: { status: 'confirm', message: 'Again?' } } });
  assert.equal(again.phase, 'failed', 'a second question after confirming is not looped');
  const saved = reduceModelFlow(flow, { type: 'reply', now: 2100, result: { ok: true, value: { status: 'saved' } } });
  assert.deepEqual(saved, { phase: 'saved', pick });
  const lost = reduceModelFlow(flow, { type: 'reply', now: 2100, result: { ok: false, code: 'unknown', message: 'Not sure this finished.' } });
  assert.deepEqual(lost, { phase: 'failed', pick, message: 'Not sure this finished.', unknown: true });
  assert.equal(reduceModelFlow(saved, { type: 'reply', now: 1, result: { ok: true, value: { status: 'saved' } } }), saved, 'stray replies are ignored');
  assert.equal(reduceModelFlow(flow, { type: 'reset' }), flow, 'a save in flight is never forgotten');
});

test('model choices become one labelled select list that always shows the current model', () => {
  const choices = decodeModelOptions(SPEC_OPTIONS);
  const options = modelOptions(choices);
  assert.deepEqual(options.map(option => option.label), ['model-a · Example Provider', 'model-b · Example Provider', 'm1 · My Lab']);
  assert.deepEqual(parseModelKey(options[2].value), { provider: 'my-lab', model: 'm1' });
  assert.deepEqual(parseModelKey(modelKey({ provider: 'a","b', model: '[x]' })), { provider: 'a","b', model: '[x]' });
  assert.equal(parseModelKey('not json'), null);
  assert.equal(parseModelKey('["a"]'), null);
  const single = modelOptions(decodeModelOptions(REAL_OPTIONS));
  assert.deepEqual(single.map(option => option.label), ['gemma4:e2b', 'nomic-embed-text:latest'], 'one provider: model names only');
  const retired = modelOptions({ current: { provider: 'p', model: 'old' }, providers: [{ id: 'p', name: 'P', models: ['new'] }] });
  assert.deepEqual(retired.map(option => option.label), ['old (current)', 'new']);
});

// A synthetic host for the full call path: renderer input -> main parse -> lease -> handler -> host.
function synthetic(handlers) {
  const seen = [];
  const gateway = { exclusiveSubmit: true, close() {}, restoreRequests() {},
    async requestHttp(op) {
      if (op.kind === 'health') return { body: { ok: true, auth_required: false } };
      if (op.kind === 'nativeContext') throw new HttpStatusError(404);
      seen.push(op);
      const handler = handlers[`${op.method} ${op.path}`];
      if (!handler) throw new HttpStatusError(404);
      return { body: await handler(op) };
    },
    async call(method, params, options) { seen.push({ method, params, options }); return handlers[method](params); },
    async operation(op) { if (op.kind === 'profilesList') return { profiles: [{ name: 'default' }, { name: 'coder' }] }; if (op.kind === 'sessionList') return { sessions: [] }; return {}; },
  };
  const values = new Map();
  const repository = { async read(key) { return values.get(key) ?? null; },
    async write(key, revision, value) { const next = { revision: (revision ?? 0) + 1, value }; values.set(key, next); return next; } };
  const service = createDesktopService({ repository, connect: async () => gateway, onChange() {} });
  return { seen, service, async connect() {
    await service.handle({ kind: 'connect', host: { label: 'Test', endpoint: 'https://test.invalid', authentication: 'dashboard', token: 'synthetic', allowPrivateHttp: false } });
    const lease = service.snapshot().connection;
    return (name, input) => service.call({ kind: 'call', connection: lease, name, input });
  } };
}

test('setting a default model: the host question is relayed, then the confirmed pick is saved and read back', async () => {
  let saved = { model: 'model-b', provider: 'example-provider' };
  const host = synthetic({
    'GET /api/model/options': () => SPEC_OPTIONS,
    'POST /api/model/set': op => {
      const body = JSON.parse(op.body);
      if (!body.confirm_expensive_model) return { ok: false, scope: 'main', provider: body.provider, model: body.model, confirm_required: true, confirm_message: 'model-a costs more.' };
      saved = { model: body.model, provider: body.provider };
      return { ok: true, scope: 'main', provider: body.provider, model: body.model, base_url: '', gateway_tools: [], stale_aux: [] };
    },
    'GET /api/model/info': () => ({ ...saved, auto_context_length: 0, capabilities: {} }),
  });
  const call = await host.connect();
  const listed = await call('settings.models', { profile: 'coder' });
  assert.equal(listed.ok, true);
  assert.deepEqual(host.seen.at(-1).query, { profile: 'coder', refresh: 'false', include_unconfigured: 'false', explicit_only: 'false' });
  const asked = await call('settings.setModel', { profile: 'coder', provider: 'example-provider', model: 'model-a', confirmExpensive: false });
  assert.deepEqual(asked, { ok: true, value: { status: 'confirm', message: 'model-a costs more.' } });
  assert.deepEqual(saved, { model: 'model-b', provider: 'example-provider' }, 'nothing is saved before confirmation');
  const done = await call('settings.setModel', { profile: 'coder', provider: 'example-provider', model: 'model-a', confirmExpensive: true });
  assert.deepEqual(done, { ok: true, value: { status: 'saved', current: { provider: 'example-provider', model: 'model-a' } } });
  const posts = host.seen.filter(op => op.method === 'POST');
  assert.deepEqual(posts.map(op => JSON.parse(op.body)), [
    { scope: 'main', provider: 'example-provider', model: 'model-a', task: '', base_url: '', api_key: '', confirm_expensive_model: false },
    { scope: 'main', provider: 'example-provider', model: 'model-a', task: '', base_url: '', api_key: '', confirm_expensive_model: true },
  ]);
  assert.ok(posts.every(op => op.query.profile === 'coder'));
});

test('setting a default model refuses picks the host does not offer and reports lost or odd replies honestly', async () => {
  let reply = { ok: true, scope: 'main', provider: 'example-provider', model: 'model-b' };
  let info = { model: 'model-b', provider: 'example-provider' };
  let options = SPEC_OPTIONS;
  const host = synthetic({
    'GET /api/model/options': () => { if (options instanceof Error) throw options; return options; },
    'POST /api/model/set': () => { if (reply instanceof Error) throw reply; return reply; },
    'GET /api/model/info': () => info,
  });
  const call = await host.connect();
  const pick = { profile: 'default', provider: 'example-provider', model: 'model-b', confirmExpensive: false };
  for (const input of [{ ...pick, model: 'gone' }, { ...pick, provider: 'other-provider' }, { ...pick, model: 'nope' }]) {
    const result = await call('settings.setModel', input);
    assert.equal(result.code, 'stale', JSON.stringify(input));
  }
  assert.equal(host.seen.some(op => op.method === 'POST'), false, 'refused picks never reach the host');
  assert.equal((await call('settings.setModel', { ...pick, profile: 'stranger' })).code, 'stale', 'only listed agents');
  options = new HttpStatusError(500);
  assert.equal((await call('settings.setModel', pick)).code, 'unavailable', 'a failed read before writing is not an unknown outcome');
  options = SPEC_OPTIONS;
  info = { model: 'model-a', provider: 'example-provider' };
  assert.equal((await call('settings.setModel', pick)).code, 'conflict', 'read-back mismatch is not reported as saved');
  reply = { ok: 'yes' };
  assert.equal((await call('settings.setModel', pick)).code, 'unknown');
  reply = new HttpStatusError(500);
  assert.equal((await call('settings.setModel', pick)).code, 'unknown', 'a failed write is "not sure", never retried');
  reply = new HttpStatusError(400, 'Model rejected by provider');
  assert.deepEqual(await call('settings.setModel', pick), { ok: false, code: 'invalid', message: 'Model rejected by provider' });
});

test('reactions and approval mode use fixed host keys and keep config secrets in main', async () => {
  const host = synthetic({
    'GET /api/config': () => ({ display: { message_reactions: false }, providers: { x: { api_key: 'sk-synthetic' } } }),
    'config.set': params => ({ key: params.key, value: params.value === 'true' }),
    'config.get': params => ({ value: params.key === 'approvals.mode' ? 'smart' : 'x' }),
    'GET /api/tools/toolsets': () => REAL_TOOLSETS,
    'GET /api/skills': () => REAL_SKILLS,
  });
  const call = await host.connect();
  const read = await call('settings.reactions', {});
  assert.deepEqual(read, { ok: true, value: { on: false } });
  assert.equal(JSON.stringify(read).includes('sk-synthetic'), false);
  assert.deepEqual(await call('settings.setReactions', { on: true }), { ok: true, value: { on: true } });
  const set = host.seen.find(entry => entry.method === 'config.set');
  assert.deepEqual(set.params, { key: 'display.message_reactions', value: 'true' });
  assert.notEqual(set.options?.mutation, false, 'the write is a mutation');
  assert.deepEqual(await call('settings.approvals', { profile: 'coder' }), { ok: true, value: { mode: 'smart' } });
  const get = host.seen.find(entry => entry.method === 'config.get');
  assert.deepEqual(get.params, { key: 'approvals.mode', profile: 'coder' });
  assert.equal(get.options.mutation, false);
  const toolsets = await call('settings.toolsets', { profile: 'default' });
  assert.deepEqual(toolsets.value.toolsets.map(set => set.name), ['web', 'terminal', 'bighelp_workflows']);
  assert.deepEqual(host.seen.at(-1).query, { profile: 'default' });
  assert.equal((await call('settings.skills', { profile: 'default' })).value.skills.length, 2);
  assert.equal((await call('settings.approvals', { profile: 'nobody' })).code, 'stale');
});

test('preference helpers send only validated changes', () => {
  assert.equal(cleanPersonName('  Ada   Lovelace '), 'Ada Lovelace');
  assert.equal(cleanPersonName(''), '');
  assert.equal(cleanPersonName('Ada\nLovelace'), null);
  assert.equal(cleanPersonName('a‮b'), null);
  assert.equal(cleanPersonName('x'.repeat(41)), null);
  assert.equal(cleanPersonName('😀'.repeat(40)), '😀'.repeat(40), 'the limit counts characters, not UTF-16 units');
  assert.deepEqual(personNameChange('', ' Ada '), { personName: 'Ada' });
  assert.equal(personNameChange('Ada', 'Ada '), null, 'unchanged');
  assert.deepEqual(personNameChange('Ada', '  '), { personName: '' }, 'removing the name');
  // Every change the pages send is one main accepts.
  for (const change of [{ personName: 'Ada' }, { personName: '' }, { textSize: 'larger' }, { busyMode: 'interrupt' },
    { enterToSend: false }, { showReasoning: true }, { foldFinishedTurns: false }, { notifyAttention: false },
    { notifyReplies: true }, { notificationPreview: true }, { keepRunningInTray: true }, { openAtLogin: true }]) {
    assert.deepEqual({ ...parsePreferenceChanges(change) }, change);
  }
  for (const change of [{ busyMode: 'queued' }, { textSize: 'huge' }, { voice: true }, { notifyReplies: 'yes' }]) {
    assert.throws(() => parsePreferenceChanges(change), JSON.stringify(change));
  }
  assert.equal(DEFAULT_PREFERENCES.notifyReplies, false, 'reply alerts are off by default');
});

test('bug report details hold versions and state only', () => {
  const text = bugReport({ appVersion: '0.0.0 (development build)', system: 'Linux 6.8.0 x64', connection: 'connected',
    hermesVersion: '0.22.1', hermesReleaseDate: '2026.9.24', plugin: { installed: true, version: '3.13.0' } });
  assert.equal(text, [
    'bighelp for Windows and Linux: 0.0.0 (development build)', 'System: Linux 6.8.0 x64', 'Connection: Connected',
    'Hermes: 0.22.1 (released 2026.9.24)', 'bighelp plugin: 3.13.0'].join('\n'));
  const offline = bugReport({ appVersion: '', system: '', connection: 'disconnected', hermesVersion: '0.22.1', hermesReleaseDate: null,
    plugin: { installed: true, version: '3.13.0' } });
  assert.match(offline, /Hermes: Not connected\nbighelp plugin: Not connected$/u);
  assert.match(offline, /^bighelp for Windows and Linux: Unknown\nSystem: Unknown/u);
  const hostile = bugReport({ appVersion: '1\nToken: abc', system: 'Linux', connection: 'connected', hermesVersion: 'v‮1',
    hermesReleaseDate: null, plugin: { installed: false, version: null } });
  assert.equal(hostile.split('\n').length, 5, 'every fact stays on its own line');
  assert.match(hostile, /bighelp plugin: Not installed/u);
});

test('approval modes read in plain words and never call "smart" no prompts', () => {
  assert.equal(approvalSummary('manual').asks, true);
  assert.equal(approvalSummary('smart').asks, true);
  assert.equal(approvalSummary('off').asks, false);
  assert.match(approvalSummary('smart').detail, /ask/u);
});

test('Settings has no Voice row; unknown sections stay closed', () => {
  assert.deepEqual([...EVERYDAY_SETTINGS], ['you', 'assistants', 'appearance', 'chat', 'notifications', 'hosts', 'permissions', 'help']);
  const state = reduceShell(createShellState(), { type: 'place', place: 'settings' });
  assert.equal(settingsSections(state).includes('voice'), false);
  assert.equal(reduceShell(state, { type: 'settingsSection', section: 'voice' }), state);
  const nerd = reduceShell(state, { type: 'nerdMode', on: true });
  assert.deepEqual(settingsSections(nerd).slice(-2), ['system', 'hermesTools']);
});

// Render every page with real React (static markup: effects and host reads do not run).
const rendered = await build({ stdin: { contents: `
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { SettingsOverview } from './packages/ui/components/Settings.tsx';
import { SettingsPage } from './packages/ui/components/SettingsPage.tsx';
import { ThemeProvider } from './packages/ui/theme.tsx';
import { PALETTES } from './packages/ui/tokens.ts';
const wrap = node => renderToStaticMarkup(<ThemeProvider value={{theme:'light',palette:PALETTES.light,font:'sans-serif'}}>{node}</ThemeProvider>);
export const overview = nerdMode => wrap(<SettingsOverview nerdMode={nerdMode} onOpen={() => {}} onNerdMode={() => {}} />);
export const page = (section, desktop, shell) => wrap(<SettingsPage section={section} appearance="automatic" host={null}
  onAppearance={() => {}} onBack={() => {}} desktop={desktop} shell={shell} />);
`, resolveDir: process.cwd(), loader: 'tsx' }, jsx: 'automatic', bundle: true, platform: 'node', format: 'cjs', packages: 'external', write: false });
const ui = { exports: {} };
new Function('require', 'module', 'exports', rendered.outputFiles[0].text)(createRequire(import.meta.url), ui, ui.exports);
const text = html => html.replace(/<[^>]+>/gu, ' ').replace(/&#x27;/gu, "'").replace(/&amp;/gu, '&').replace(/\s+/gu, ' ');

test('every Settings page renders real content in the sample preview and when connected', () => {
  assert.doesNotMatch(text(ui.exports.overview(true)), /Voice/u);
  assert.match(text(ui.exports.overview(true)), /Hermes tools/u);
  const sections = ['you', 'assistants', 'appearance', 'chat', 'notifications', 'permissions', 'help', 'system', 'hermesTools'];
  const desktop = { act: async () => true, api: { call: () => new Promise(() => {}), preferences: async () => ({ ok: false }),
    copyText: async () => true, openLink: async () => true },
  snapshot: { status: 'connected', connection: 3, generation: 7, storageAvailable: true, preferences: { ...DEFAULT_PREFERENCES, personName: 'Ada' },
    data: { host: { label: 'Workshop', state: 'connected' }, agents: [{ id: 'default', name: 'Default', summary: '', color: 'blue' },
      { id: 'coder', name: 'Coder', summary: '', color: 'blue' }] } } };
  const shell = { platform: 'linux', fixturePreview: false, appVersion: '0.0.0 (development build)', system: 'Linux 6.8.0 x64' };
  for (const section of sections) {
    for (const mode of [undefined, desktop]) {
      const body = text(ui.exports.page(section, mode, shell));
      assert.doesNotMatch(body, /Not built yet/u, section);
      assert.ok(body.length > 40, section);
    }
  }
  assert.match(ui.exports.page('you', desktop, shell), /value="Ada"/u);
  const chat = text(ui.exports.page('chat', undefined, shell));
  for (const words of ['Show reasoning', 'Fold finished turns', 'While an agent is working', 'Steer', 'Queue', 'Interrupt and send',
    'Send context into the live turn so the agent can adjust its response.', 'Enter sends', 'Shift+Enter starts a new line.']) {
    assert.ok(chat.includes(words), words);
  }
  const alerts = text(ui.exports.page('notifications', undefined, shell));
  for (const words of ['When an agent needs your OK or has a question', 'When a reply finishes', 'Show message text in notifications',
    'Keep bighelp running in the background when you close the window', 'Open bighelp when you sign in to this computer',
    'Alerts only arrive while bighelp is running. Quitting bighelp stops them.']) assert.ok(alerts.includes(words), words);
  const help = text(ui.exports.page('help', desktop, shell));
  assert.match(help, /0\.0\.0 \(development build\)/u);
  assert.match(help, /Copy details for a bug report/u);
  assert.match(help, /Hermes on Workshop/u);
  assert.match(text(ui.exports.page('assistants', desktop, shell)), /Agent.*Default.*Coder/u, 'agent choice appears with more than one agent');
  assert.match(text(ui.exports.page('system', undefined, shell)), /Sample preview/u);
  assert.match(text(ui.exports.page('hermesTools', undefined, shell)), /This preview doesn't connect to a computer\./u);
  assert.match(text(ui.exports.page('system', desktop, shell)), /Lease 3 · selection 7/u);
});
