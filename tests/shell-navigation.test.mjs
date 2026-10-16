import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createShellState, reduceShell, visiblePanes, showsAgentTabs, settingsSections, SHELL_LIMITS,
} from '../packages/domain/shell.ts';

const open = (state, chatId = 'chat-1', agentId = 'agent-1') => reduceShell(state, { type: 'openChat', chatId, agentId });

test('shell: one rail picks the context list; the default is Chats in a wide window', () => {
  const state = createShellState();
  assert.equal(state.place, 'chats');
  assert.deepEqual(visiblePanes(state), { list: true, detail: true });
  const agents = reduceShell(state, { type: 'place', place: 'agents' });
  assert.equal(agents.place, 'agents');
  assert.equal(Object.isFrozen(agents), true);
});

test('shell: unknown places, tabs and sections leave state unchanged', () => {
  const state = createShellState();
  assert.equal(reduceShell(state, { type: 'place', place: 'terminal' }), state);
  assert.equal(reduceShell(open(state), { type: 'agentTab', tab: 'shell' }).agentTab, 'chat');
  assert.equal(reduceShell(state, { type: 'settingsSection', section: 'raw-config' }), state);
  assert.equal(reduceShell(state, { type: 'nope' }), state);
});

test('shell: agent tabs appear only while an agent conversation is open', () => {
  let state = createShellState();
  assert.equal(showsAgentTabs(state), false);
  state = open(state);
  assert.equal(showsAgentTabs(state), true);
  state = reduceShell(state, { type: 'place', place: 'workflows' });
  assert.equal(showsAgentTabs(state), false, 'function pages have no agent tab bar');
  state = reduceShell(state, { type: 'place', place: 'settings' });
  assert.equal(showsAgentTabs(state), false);
  state = reduceShell(state, { type: 'place', place: 'chats' });
  assert.equal(showsAgentTabs(state), true, 'returning to Chats restores the open conversation');
  state = reduceShell(state, { type: 'place', place: 'agents' });
  state = reduceShell(state, { type: 'openAgent', agentId: 'agent-2' });
  assert.equal(showsAgentTabs(state), true);
  assert.equal(state.selectedAgentId, 'agent-2');
});

test('shell: navigation never clears or moves a draft', () => {
  let state = open(createShellState());
  state = reduceShell(state, { type: 'draft', chatId: 'chat-1', text: 'Also remind me about the projector' });
  for (const place of ['agents', 'workflows', 'settings', 'vault', 'usage', 'chats']) {
    state = reduceShell(state, { type: 'place', place });
    assert.equal(state.drafts['chat-1'], 'Also remind me about the projector');
  }
  state = reduceShell(state, { type: 'layout', layout: 'narrow' });
  state = reduceShell(state, { type: 'back' });
  assert.equal(state.drafts['chat-1'], 'Also remind me about the projector');
  state = open(state, 'chat-2', 'agent-1');
  assert.equal(state.drafts['chat-1'], 'Also remind me about the projector');
  assert.equal(state.drafts['chat-2'], undefined);
});

test('shell: an emptied draft is removed, an oversized or malformed draft is refused', () => {
  let state = reduceShell(open(createShellState()), { type: 'draft', chatId: 'chat-1', text: 'keep' });
  assert.equal(reduceShell(state, { type: 'draft', chatId: 'chat-1', text: 'x'.repeat(SHELL_LIMITS.draftCharacters + 1) }), state);
  assert.equal(reduceShell(state, { type: 'draft', chatId: 'chat-1', text: '\ud800' }), state);
  assert.equal(reduceShell(state, { type: 'draft', chatId: '', text: 'x' }), state);
  state = reduceShell(state, { type: 'draft', chatId: 'chat-1', text: '' });
  assert.equal(Object.hasOwn(state.drafts, 'chat-1'), false);
});

test('shell: the draft map is bounded without evicting an existing draft', () => {
  let state = createShellState();
  for (let n = 0; n < SHELL_LIMITS.drafts; n++) state = reduceShell(state, { type: 'draft', chatId: `c${n}`, text: 'x' });
  assert.equal(Object.keys(state.drafts).length, SHELL_LIMITS.drafts);
  assert.equal(reduceShell(state, { type: 'draft', chatId: 'one-more', text: 'x' }), state);
  const edited = reduceShell(state, { type: 'draft', chatId: 'c0', text: 'still editable' });
  assert.equal(edited.drafts.c0, 'still editable');
});

test('shell: drafts are a null-prototype map, so chat IDs cannot alias Object members', () => {
  let state = createShellState();
  assert.equal(state.drafts.constructor, undefined);
  state = reduceShell(state, { type: 'draft', chatId: '__proto__', text: 'synthetic' });
  assert.equal(state.drafts['__proto__'], 'synthetic');
  assert.equal(Object.getPrototypeOf(state.drafts), null);
});

test('shell: narrow windows show the list or the conversation, and Back returns to the list', () => {
  let state = reduceShell(createShellState(), { type: 'layout', layout: 'narrow' });
  assert.deepEqual(visiblePanes(state), { list: true, detail: false });
  state = open(state);
  assert.deepEqual(visiblePanes(state), { list: false, detail: true });
  assert.equal(showsAgentTabs(state), true);
  state = reduceShell(state, { type: 'back' });
  assert.deepEqual(visiblePanes(state), { list: true, detail: false });
  assert.equal(showsAgentTabs(state), false);
  assert.equal(state.selectedChatId, 'chat-1', 'Back is navigation, not closing the chat');
  state = reduceShell(state, { type: 'layout', layout: 'wide' });
  assert.deepEqual(visiblePanes(state), { list: true, detail: true });
});

test('shell: picking a rail place in a narrow window shows that place\'s list first', () => {
  let state = open(reduceShell(createShellState(), { type: 'layout', layout: 'narrow' }));
  state = reduceShell(state, { type: 'place', place: 'agents' });
  assert.deepEqual(visiblePanes(state), { list: true, detail: false });
});

test('shell: one Settings; Hermes items exist only while Nerd Mode is on', () => {
  let state = reduceShell(createShellState(), { type: 'place', place: 'settings' });
  const everyday = settingsSections(state);
  assert.equal(everyday.includes('system'), false);
  assert.equal(everyday.includes('hermesTools'), false);
  assert.equal(reduceShell(state, { type: 'settingsSection', section: 'system' }), state);
  state = reduceShell(state, { type: 'nerdMode', on: true });
  const nerd = settingsSections(state);
  assert.deepEqual(nerd.slice(0, everyday.length), everyday, 'everyday rows never move');
  assert.deepEqual(nerd.slice(everyday.length), ['system', 'hermesTools']);
  state = reduceShell(state, { type: 'settingsSection', section: 'system' });
  assert.equal(state.settingsSection, 'system');
  state = reduceShell(state, { type: 'nerdMode', on: false });
  assert.equal(state.settingsSection, null, 'hiding Nerd Mode leaves its sections for the overview');
});

test('shell: Settings opens on its overview; a section can be opened and closed again', () => {
  let state = reduceShell(createShellState(), { type: 'place', place: 'settings' });
  assert.equal(state.settingsSection, null);
  state = reduceShell(state, { type: 'settingsSection', section: 'hosts' });
  assert.equal(state.settingsSection, 'hosts');
  state = reduceShell(state, { type: 'settingsSection', section: null });
  assert.equal(state.settingsSection, null);
});

test('shell: in a narrow window a Settings page replaces the list, and Back returns to it', () => {
  let state = reduceShell(createShellState(), { type: 'layout', layout: 'narrow' });
  state = reduceShell(state, { type: 'place', place: 'settings' });
  assert.deepEqual(visiblePanes(state), { list: true, detail: false });
  state = reduceShell(state, { type: 'settingsSection', section: 'appearance' });
  assert.deepEqual(visiblePanes(state), { list: false, detail: true });
  state = reduceShell(state, { type: 'back' });
  assert.deepEqual(visiblePanes(state), { list: true, detail: false });
  assert.equal(state.settingsSection, null, 'Back from a Settings page closes it');
});

test('shell: appearance follows the system until the person picks light or dark', () => {
  let state = createShellState();
  assert.equal(state.appearance, 'automatic');
  state = reduceShell(state, { type: 'appearance', value: 'dark' });
  assert.equal(state.appearance, 'dark');
  assert.equal(reduceShell(state, { type: 'appearance', value: 'sepia' }), state);
  assert.equal(reduceShell(state, { type: 'appearance', value: 'automatic' }).appearance, 'automatic');
});

test('shell: opening a different conversation starts on its Chat tab', () => {
  let state = reduceShell(open(createShellState()), { type: 'agentTab', tab: 'goals' });
  assert.equal(state.agentTab, 'goals');
  state = open(state, 'chat-2', 'agent-3');
  assert.equal(state.agentTab, 'chat');
  assert.equal(state.selectedAgentId, 'agent-3');
});

test('shell: function row detail and Back use the existing narrow panes without agent tabs or draft changes', () => {
  let state = reduceShell(open(createShellState()), {type:'draft',chatId:'chat-1',text:'Keep this'});
  assert.equal(reduceShell(state, {type:'functionDetail'}), state);
  state = reduceShell(state, {type:'layout',layout:'narrow'});
  for (const place of ['projects','scheduled','usage']) {
    state = reduceShell(state, {type:'place',place});
    assert.deepEqual(visiblePanes(state), {list:true,detail:false});
    state = reduceShell(state, {type:'functionDetail'});
    assert.deepEqual(visiblePanes(state), {list:false,detail:true});
    assert.equal(showsAgentTabs(state), false);
    state = reduceShell(state, {type:'back'});
    assert.deepEqual(visiblePanes(state), {list:true,detail:false});
    assert.equal(state.drafts['chat-1'], 'Keep this');
  }
});
