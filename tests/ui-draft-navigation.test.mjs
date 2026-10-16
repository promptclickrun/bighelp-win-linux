import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';

const childModuleFilter = /packages[\\/]ui[\\/](components[\\/].*|theme)\.tsx$/;
function inertChildModule(path) {
  // Export every name the real module exports, each as an inert string element.
  const relative = path.replaceAll('\\', '/').split('packages/ui/').at(-1);
  const source = readFileSync(new URL(`../packages/ui/${relative}`, import.meta.url), 'utf8');
  const names = [...source.matchAll(/^export (?:function|const) (\w+)/gmu)].map(match => match[1]);
  return {contents: names.map(name => `export const ${name} = '${name}';`).join('\n'), loader: 'js'};
}

// Exercise App's actual callbacks, refs, reducer and effect lifecycle. Child
// components are inert elements; no browser, physical input or IME is claimed.
const compiled = await build({ entryPoints: ['packages/ui/App.tsx'], bundle: true, write: false,
  platform: 'node', format: 'cjs', jsx: 'automatic', packages: 'external', plugins: [{name: 'inert-children', setup(builder) {
    builder.onLoad({filter: childModuleFilter}, ({path}) => inertChildModule(path));
  }}] });

test('inert child modules match Windows and POSIX paths with the same exports', async () => {
  for (const file of ['theme.tsx', 'components/ContextList.tsx', 'components/primitives.tsx', 'components/Settings.tsx', 'components/Conversation.tsx']) {
    const posix = `/workspace/bighelp/packages/ui/${file}`;
    const windows = `D:\\a\\bighelp\\packages\\ui\\${file.replaceAll('/', '\\')}`;
    assert.equal(childModuleFilter.test(posix), true);
    assert.equal(childModuleFilter.test(windows), true);
    assert.deepEqual(inertChildModule(windows), inertChildModule(posix));
  }
  // Exercise esbuild's own serialized filter against a Windows path on any OS.
  const probe = await build({ stdin: { contents: "export { ThemeProvider } from 'windows-theme';" },
    bundle: true, write: false, format: 'cjs', plugins: [{name: 'windows-path-probe', setup(builder) {
      builder.onResolve({filter: /^windows-theme$/}, () => ({path: 'D:\\a\\bighelp\\packages\\ui\\theme.tsx', namespace: 'synthetic-windows'}));
      builder.onLoad({filter: childModuleFilter}, ({path}) => inertChildModule(path));
    }}] });
  const module = {exports: {}};
  new Function('module', 'exports', probe.outputFiles[0].text)(module, module.exports);
  assert.equal(module.exports.ThemeProvider, 'ThemeProvider');
});

function harness() {
  const slots = []; let cursor = 0, changed = true, effects = [], tree;
  const hooks = {
    useRef(initial) { const index = cursor++; return slots[index] ??= {current: initial}; },
    useState(initial) { const index = cursor++; if (!(index in slots)) slots[index] = initial;
      return [slots[index], value => { slots[index] = typeof value === 'function' ? value(slots[index]) : value; changed = true; }]; },
    useReducer(reduce, initial, init) { const index = cursor++; if (!(index in slots)) slots[index] = init(initial);
      return [slots[index], action => { const next = reduce(slots[index], action); if (next !== slots[index]) { slots[index] = next; changed = true; } }]; },
    createContext(value) { return { Provider: 'Provider', value }; }, useContext(context) { cursor++; return context?.value ?? null; },
    useCallback(callback) { cursor++; return callback; },
    useEffect(effect, deps) { const index = cursor++, old = slots[index];
      if (!old || deps.some((dep, i) => !Object.is(dep, old.deps[i]))) {
        effects.push(() => { old?.cleanup?.(); slots[index] = {deps, cleanup: effect()}; });
      }
    },
  };
  const element = (type, props) => ({type, props});
  const module = {exports: {}};
  new Function('require', 'module', 'exports', compiled.outputFiles[0].text)(name => {
    if (name === 'react') return hooks;
    if (name === 'react/jsx-runtime') return {jsx: element, jsxs: element};
    if (name === 'react-native-web') return {View: 'View', ScrollView: 'ScrollView', useColorScheme: () => 'light', useWindowDimensions: () => ({width: 1200})};
    throw Error(`Unexpected import: ${name}`);
  }, module, module.exports);
  const calls = [], saved = new Map(); let authority = 'original', holdDraft, holdCanonical, holdSend, failDraft = false;
  let snapshot = {generation: 1, revision: 1, status: 'connected', selectedChatId: 'A', drafts: {}, running: false,
    canSend: true, notice: '', prompts: [], storageAvailable: true, workspace: null,
    data: {sample: false, host: {label: 'Synthetic', state: 'connected'}, workflows: [],
      agents: [{id:'agent', name:'Synthetic', summary:'', color:'blue'}],
      chats: ['A','B','C'].map(id => ({id, agentId:'agent', title:id, preview:'', transcript:[]}))}};
  const result = () => ({ok: true, snapshot});
  const select = (kind, generation, id) => {
    calls.push({kind, generation, id});
    if (generation !== snapshot.generation) return Promise.resolve({ok:false});
    snapshot = {...snapshot, generation:generation + 1, revision:snapshot.revision + 1, selectedChatId:id,
      drafts: Object.fromEntries(['A','B','C'].map(chat => [chat, saved.get(`${authority}:${chat}`) ?? '']))}; changed = true;
    return Promise.resolve(result());
  };
  const api = {
    async draft(generation, chatId, text) {
      const owner = authority; calls.push({kind:'draft', generation, chatId, text, owner});
      if (generation !== snapshot.generation || chatId !== snapshot.selectedChatId) return {ok:false};
      if (holdDraft) await holdDraft;
      if (failDraft) return {ok:false};
      saved.set(`${owner}:${chatId}`, text);
      if (generation === snapshot.generation) { snapshot = {...snapshot, drafts:{...snapshot.drafts, [chatId]:text}}; changed = true; }
      return result();
    },
    openChat: (generation, id) => select('openChat', generation, id),
    newChat: generation => select('newChat', generation, 'C'),
    canonicalChat: async (generation, id, requestId) => { const response = select('canonicalChat', generation, 'B'); if (holdCanonical) await holdCanonical; return response; },
    cancelNavigation: async (generation, requestId) => { calls.push({kind:'cancelNavigation', generation, requestId}); return result(); },
    connect: async () => { calls.push({kind:'connect'}); replaceAuthority(); return result(); },
    disconnect: async () => { calls.push({kind:'disconnect'}); replaceAuthority(); return result(); },
    send: async (generation, chatId, text) => { calls.push({kind:'send'}); if (holdSend) await holdSend;
      if (saved.get(`${authority}:${chatId}`) === text) { saved.set(`${authority}:${chatId}`, ''); snapshot = {...snapshot, drafts:{...snapshot.drafts, [chatId]:''}}; }
      changed = true; return result(); },
  };
  const act = async promise => { const outcome = await promise; changed = true; return outcome.ok; };
  const render = () => {
    do { changed = false; cursor = 0; effects = []; tree = module.exports.App({api, snapshot, data:snapshot.data, platform:'linux', act});
      for (const effect of effects) effect();
    } while (changed);
    return tree;
  };
  const find = type => {
    render();
    const walk = node => { if (!node || typeof node !== 'object') return null;
      if (node.type === type) return node.props;
      for (const child of [node.props?.children, node.props?.hostContent].flat(Infinity)) { const found = walk(child); if (found) return found; }
      return null;
    };
    const found = walk(tree); assert.ok(found, `Missing ${type}`); return found;
  };
  function replaceAuthority(renderNow = true) { authority = 'replacement'; snapshot = {...snapshot, generation:snapshot.generation + 1, drafts:{}, selectedChatId:'A'}; changed = true; if (renderNow) render(); }
  const settle = async () => { for (let i=0; i<20; i++) { await Promise.resolve(); render(); } };
  render();
  return {find, settle, calls, saved, replaceAuthority,
    replaceAgents(agents) { snapshot={...snapshot,data:{...snapshot.data,agents}};changed=true;render(); },
    hold() { let release; holdDraft = new Promise(resolve => { release = resolve; }); return () => { holdDraft = undefined; release(); }; },
    holdCanonical() { let release; holdCanonical = new Promise(resolve => { release = resolve; }); return () => { holdCanonical = undefined; release(); }; },
    holdSend() { let release; holdSend = new Promise(resolve => { release = resolve; }); return () => { holdSend = undefined; release(); }; },
    fail(value) { failDraft = value; },
    unmount() { for (const slot of slots) slot?.cleanup?.(); },
  };
}

for (const route of ['saved', 'new', 'canonical']) test(`typing then ${route} navigation before debounce saves the original chat`, async () => {
  const h = harness();
  try {
    h.find('Conversation').onDraft('Do not lose this draft');
    if (route === 'saved') h.find('ContextList').onOpenChat('B', 'agent');
    else if (route === 'new') h.find('Conversation').onNewChat();
    else h.find('ContextList').onOpenAgent('agent');
    await h.settle();
    assert.equal(h.saved.get('original:A'), 'Do not lose this draft');
    assert.equal(h.calls[0].kind, 'draft'); assert.equal(h.calls[0].generation, 1); assert.equal(h.calls[1].kind, route === 'saved' ? 'openChat' : route === 'new' ? 'newChat' : 'canonicalChat');
    h.find('ContextList').onOpenChat('A', 'agent'); await h.settle();
    assert.equal(h.find('Conversation').draft, 'Do not lose this draft');
    assert.ok(!h.calls.some(call => call.kind === 'send'));
  } finally { h.unmount(); }
});

test('failed save retains the dirty editor and prevents generation-changing navigation', async () => {
  const h = harness();
  try {
    h.fail(true); h.find('Conversation').onDraft('Keep after failure'); h.find('Conversation').onNewChat(); await h.settle();
    assert.equal(h.find('Conversation').draft, 'Keep after failure'); assert.ok(!h.calls.some(call => call.kind === 'newChat'));
    h.fail(false); h.find('Conversation').onNewChat(); await h.settle(); assert.equal(h.saved.get('original:A'), 'Keep after failure');
  } finally { h.unmount(); }
});

test('new typing during a held save is persisted before the latest navigation runs', async () => {
  const h = harness();
  try {
    const release = h.hold(); h.find('Conversation').onDraft('older'); h.find('ContextList').onOpenChat('B','agent');
    h.find('Conversation').onDraft('newer'); h.find('ContextList').onOpenChat('C','agent');
    release(); await h.settle();
    assert.equal(h.saved.get('original:A'), 'newer');
    assert.deepEqual(h.calls.filter(call => call.kind === 'openChat').map(call => call.id), ['C']);
    assert.deepEqual(h.calls.filter(call => call.kind === 'draft').map(call => call.text), ['older','newer']);
  } finally { h.unmount(); }
});

test('leaving chat cancels delayed navigation and persists without reopening chat', async () => {
  const h = harness();
  try {
    const release = h.hold(); h.find('Conversation').onDraft('Saved when leaving'); h.find('ContextList').onOpenChat('B','agent');
    h.find('Rail').onPlace('projects'); release(); await h.settle();
    assert.equal(h.saved.get('original:A'), 'Saved when leaving'); assert.ok(!h.calls.some(call => call.kind === 'openChat'));
    assert.equal(h.find('Rail').place, 'projects');
  } finally { h.unmount(); }
});

for (const action of ['onConnect','onDisconnect']) test(`explicit host ${action} waits for the original protected draft`, async () => {
  const h = harness();
  try {
    const release = h.hold(); h.find('Conversation').onDraft('Original only'); h.find('Rail').onHost();
    h.find('HostConnection')[action]({}); await h.settle();
    assert.ok(!h.calls.some(call => call.kind === 'connect' || call.kind === 'disconnect'));
    release(); await h.settle(); assert.equal(h.saved.get('original:A'), 'Original only'); assert.equal(h.saved.get('replacement:A'), undefined);
    assert.equal(h.calls.at(-1).kind, action === 'onConnect' ? 'connect' : 'disconnect');
  } finally { h.unmount(); }
});

test('authority replacement cancels a delayed navigation and never moves draft text to the replacement', async () => {
  const h = harness();
  try {
    const release = h.hold(); h.find('Conversation').onDraft('Old authority'); h.find('ContextList').onOpenChat('B','agent');
    h.replaceAuthority(); h.find('Conversation').onDraft('New authority'); release(); await h.settle();
    assert.equal(h.find('Conversation').draft, 'New authority'); assert.equal(h.saved.get('replacement:A'), undefined);
    assert.ok(!h.calls.some(call => call.kind === 'openChat'));
    h.find('ContextList').onOpenChat('C','agent'); await h.settle();
    assert.equal(h.saved.get('original:A'), 'Old authority'); assert.equal(h.saved.get('replacement:A'), 'New authority');
  } finally { h.unmount(); }
});


test('draft acknowledgement fences authority replacement before React commits its next render', async () => {
  const h = harness();
  try {
    const release = h.hold(); h.find('Conversation').onDraft('Old text'); h.find('Rail').onHost();
    h.find('HostConnection').onDisconnect();
    h.replaceAuthority(false); release();
    await new Promise(resolve => setImmediate(resolve));
    assert.ok(!h.calls.some(call => call.kind === 'disconnect'));
    await h.settle(); assert.equal(h.find('ContextList').place, 'settings');
  } finally { h.unmount(); }
});

test('leaving an admitted canonical navigation still cancels its original initiating generation', async () => {
  const h = harness();
  try {
    const release = h.holdCanonical(); h.find('ContextList').onOpenAgent('agent'); await h.settle();
    h.find('Rail').onPlace('projects'); await h.settle();
    assert.equal(h.calls.find(call => call.kind === 'cancelNavigation')?.generation, 1);
    release(); await h.settle(); assert.equal(h.find('Rail').place, 'projects');
  } finally { h.unmount(); }
});

test('ordinary debounce persists through the same acknowledged draft path', async t => {
  t.mock.timers.enable({apis:['setTimeout']});
  const h = harness();
  try {
    h.find('Conversation').onDraft('Debounced'); t.mock.timers.tick(300); await h.settle();
    assert.equal(h.saved.get('original:A'), 'Debounced'); assert.equal(h.find('Conversation').draft, 'Debounced');
    assert.equal(h.calls.filter(call => call.kind === 'draft').length, 1);
  } finally { h.unmount(); t.mock.timers.reset(); }
});


test('the navigation draft flush preserves newer typing while an older Send finishes', async () => {
  const h = harness();
  try {
    const release = h.holdSend(); h.find('Conversation').onDraft('Submitted'); h.find('Conversation').onSend(); await h.settle();
    assert.equal(h.calls.filter(call => call.kind === 'send').length, 1);
    h.find('Conversation').onDraft('Newer unsent text'); release(); await h.settle();
    assert.equal(h.find('Conversation').draft, 'Newer unsent text');
    h.find('ContextList').onOpenChat('B','agent'); await h.settle();
    assert.equal(h.saved.get('original:A'), 'Newer unsent text'); assert.equal(h.calls.filter(call => call.kind === 'send').length, 1);
  } finally { h.unmount(); }
});

test('failed draft persistence prevents explicit host replacement and remains retryable', async () => {
  const h = harness();
  try {
    h.fail(true); h.find('Conversation').onDraft('Retry safely'); h.find('Rail').onHost(); await h.settle();
    h.find('HostConnection').onConnect({}); await h.settle();
    assert.ok(!h.calls.some(call => call.kind === 'connect'));
    h.fail(false); h.find('HostConnection').onConnect({}); await h.settle();
    assert.equal(h.saved.get('original:A'), 'Retry safely'); assert.equal(h.saved.get('replacement:A'), undefined);
    assert.equal(h.calls.at(-1).kind, 'connect');
  } finally { h.unmount(); }
});


for (const page of ['projects','scheduled','usage']) test(`global ${page} navigation retains protected draft and never opens a canonical chat`, async () => {
  const h = harness();
  try {
    h.find('Conversation').onDraft('Keep for return');
    h.find('Rail').onPlace(page); await h.settle();
    const functionPage = h.find('WorkspaceFunctionPage');
    assert.equal(functionPage.page, page);
    assert.deepEqual(functionPage.panes, {list:true,detail:true});
    functionPage.onOpenDetail(); await h.settle();
    assert.equal(h.find('Rail').place, page);
    assert.equal(h.saved.get('original:A'), 'Keep for return');
    assert.ok(!h.calls.some(call => ['canonicalChat','openChat','send'].includes(call.kind)));
    h.find('Rail').onPlace('chats'); await h.settle();
    assert.equal(h.find('Conversation').draft, 'Keep for return');
  } finally { h.unmount(); }
});

for(const tab of ['feed','ideas','goals'])test(`agent ${tab} navigation preserves dirty draft and returns without chat creation`,async()=>{
 const h=harness();try{
 h.find('Conversation').onDraft('Draft across board');h.find('Conversation').onTab(tab);await h.settle();assert.equal(h.find('Conversation').tab,tab);
 assert.equal(h.find('Conversation').board.type,'AgentBoard');assert.equal(h.find('Conversation').board.props.profile,'agent');assert.equal(h.find('Conversation').board.props.page,tab);
 assert.ok(!h.calls.some(call=>['canonicalChat','newChat','send'].includes(call.kind)));
 h.find('Conversation').onTab('chat');await h.settle();assert.equal(h.find('Conversation').draft,'Draft across board');
 h.find('Conversation').onNewChat();await h.settle();assert.equal(h.saved.get('original:A'),'Draft across board');
 }finally{h.unmount();}
});
test('board tab cancels held canonical navigation without reverting to Chat on its snapshot',async()=>{
 const h=harness();try{const release=h.holdCanonical();h.find('ContextList').onOpenAgent('agent');
 // Navigation begins after draft flush, before the held canonical result.
 await h.settle();h.find('Conversation').onTab('feed');await h.settle();
 assert.ok(h.calls.some(call=>call.kind==='cancelNavigation'));
 release();await h.settle();assert.equal(h.find('Conversation').tab,'feed');
 }finally{h.unmount();}
});


test('board chat prefills open a new chat and only fill in its message box; Files gets its own page',async()=>{
 const h=harness();const text='Yes, go ahead with this idea: “Plan meals”.';
 try{h.find('Conversation').onTab('ideas');await h.settle();
  h.find('Conversation').board.props.onStartChat(text);await h.settle();
  assert.deepEqual(h.calls.slice(-2).map(call=>[call.kind,call.chatId??call.id,call.text]),[['newChat','C',undefined],['draft','C',text]]);
  const conversation=h.find('Conversation');assert.equal(conversation.tab,'chat');assert.equal(conversation.draft,text);
  assert.ok(!h.calls.some(call=>call.kind==='send'),'nothing is sent');
  h.find('Conversation').onTab('files');await h.settle();
  const files=h.find('Conversation').files;assert.equal(files.type,'AgentFiles');assert.equal(files.props.profile,'agent');
 }finally{h.unmount();}
});

test('board integration retains the exact selected agent and never falls back to another catalog entry',async()=>{
 const h=harness();try{h.replaceAgents([{id:'agent',name:'Same name',color:'blue'},{id:'other',name:'Same name',color:'red'}]);h.find('Conversation').onTab('ideas');await h.settle();assert.equal(h.find('Conversation').board.props.profile,'agent');
 h.replaceAgents([{id:'other',name:'Same name',color:'red'}]);assert.throws(()=>h.find('Conversation'),/Missing Conversation/);assert.ok(!h.calls.some(call=>['canonicalChat','newChat','send'].includes(call.kind)));
 }finally{h.unmount();}
});
