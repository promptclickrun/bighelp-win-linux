// App-shell navigation for the approved hybrid direction (docs/DECISIONS.md D5,
// mock D). Pure and renderer-independent: no I/O, no host authority, no timers.
// The rail is the only global navigation. It picks what the context list shows.
// The Chat/Feed/Ideas/Goals/Files tabs belong to the open agent, not the app.

export const PLACES = Object.freeze([
  'chats', 'agents', 'projects', 'kanban', 'workflows', 'scheduled', 'usage', 'vault', 'settings',
] as const);
export type Place = typeof PLACES[number];

export const AGENT_TABS = Object.freeze(['chat', 'feed', 'ideas', 'goals', 'files'] as const);
export type AgentTab = typeof AGENT_TABS[number];

// Everyday rows never move. Hermes host administration exists only in Nerd Mode.
export const EVERYDAY_SETTINGS = Object.freeze([
  'you', 'assistants', 'appearance', 'chat', 'voice', 'notifications', 'hosts', 'permissions', 'help',
] as const);
export const NERD_SETTINGS = Object.freeze(['system', 'hermesTools'] as const);
export type SettingsSection = typeof EVERYDAY_SETTINGS[number] | typeof NERD_SETTINGS[number];

export type Layout = 'wide' | 'narrow';
export const APPEARANCES = Object.freeze(['automatic', 'light', 'dark'] as const);
export type Appearance = typeof APPEARANCES[number];
export type Drafts = Readonly<Record<string, string>>;

export type ShellState = Readonly<{
  place: Place;
  layout: Layout;
  // Narrow windows show one of the two panes; wide windows show both.
  narrowPane: 'list' | 'detail';
  selectedChatId: string | null;
  selectedAgentId: string | null;
  agentTab: AgentTab;
  nerdMode: boolean;
  // Local display preference only. Not persisted in this slice.
  appearance: Appearance;
  // null is the Settings overview list; a section opens one page.
  settingsSection: SettingsSection | null;
  // Unsent text per conversation. Navigation never clears or moves it.
  drafts: Drafts;
}>;

export type ShellAction =
  | Readonly<{ type: 'place'; place: unknown }>
  | Readonly<{ type: 'openChat'; chatId: unknown; agentId: unknown }>
  | Readonly<{ type: 'openAgent'; agentId: unknown }>
  | Readonly<{ type: 'agentTab'; tab: unknown }>
  | Readonly<{ type: 'back' }>
  | Readonly<{ type: 'layout'; layout: unknown }>
  | Readonly<{ type: 'nerdMode'; on: unknown }>
  | Readonly<{ type: 'appearance'; value: unknown }>
  | Readonly<{ type: 'settingsSection'; section: unknown }>
  | Readonly<{ type: 'draft'; chatId: unknown; text: unknown }>;

export const SHELL_LIMITS = Object.freeze({ idCharacters: 1024, draftCharacters: 262144, drafts: 512 });

function member<T extends string>(values: readonly T[], value: unknown): value is T {
  return typeof value === 'string' && values.some(known => known === value);
}
function identity(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= SHELL_LIMITS.idCharacters && value.isWellFormed();
}
function freezeDrafts(entries: Iterable<readonly [string, string]>): Drafts {
  // Null prototype: a chat ID such as "__proto__" stays plain data.
  const drafts: Record<string, string> = Object.create(null);
  for (const [key, text] of entries) drafts[key] = text;
  return Object.freeze(drafts);
}
function next(state: ShellState, changes: Partial<ShellState>): ShellState {
  return Object.freeze({ ...state, ...changes });
}

export function createShellState(): ShellState {
  return Object.freeze({
    place: 'chats', layout: 'wide', narrowPane: 'list', selectedChatId: null, selectedAgentId: null,
    agentTab: 'chat', nerdMode: false, appearance: 'automatic', settingsSection: null, drafts: freezeDrafts([]),
  });
}

export function settingsSections(state: ShellState): readonly SettingsSection[] {
  return Object.freeze(state.nerdMode ? [...EVERYDAY_SETTINGS, ...NERD_SETTINGS] : [...EVERYDAY_SETTINGS]);
}

export function visiblePanes(state: ShellState): Readonly<{ list: boolean; detail: boolean }> {
  if (state.layout === 'wide') return Object.freeze({ list: true, detail: true });
  return Object.freeze({ list: state.narrowPane === 'list', detail: state.narrowPane === 'detail' });
}

// Function pages (Workflows, Kanban, Settings, ...) have no agent open, so no tab bar.
export function showsAgentTabs(state: ShellState): boolean {
  if (!visiblePanes(state).detail) return false;
  if (state.place === 'chats') return state.selectedChatId !== null;
  if (state.place === 'agents') return state.selectedAgentId !== null;
  return false;
}

// Invalid or unknown input returns the same state object: the renderer cannot
// invent places, tabs or Settings sections, and nothing here has side effects.
export function reduceShell(state: ShellState, action: ShellAction): ShellState {
  switch (action.type) {
    case 'place':
      if (!member(PLACES, action.place)) return state;
      return next(state, { place: action.place, narrowPane: 'list' });
    case 'openChat':
      if (!identity(action.chatId) || !identity(action.agentId)) return state;
      return next(state, {
        place: 'chats', selectedChatId: action.chatId, selectedAgentId: action.agentId, narrowPane: 'detail',
        agentTab: action.chatId === state.selectedChatId ? state.agentTab : 'chat',
      });
    case 'openAgent':
      if (!identity(action.agentId)) return state;
      return next(state, {
        place: 'agents', selectedAgentId: action.agentId, narrowPane: 'detail',
        agentTab: action.agentId === state.selectedAgentId ? state.agentTab : 'chat',
      });
    case 'agentTab':
      if (!member(AGENT_TABS, action.tab) || !showsAgentTabs(state)) return state;
      return next(state, { agentTab: action.tab });
    case 'back':
      if (state.layout !== 'narrow' || state.narrowPane !== 'detail') return state;
      return next(state, { narrowPane: 'list', ...(state.place === 'settings' ? { settingsSection: null } : {}) });
    case 'layout':
      if (action.layout !== 'wide' && action.layout !== 'narrow') return state;
      return action.layout === state.layout ? state : next(state, { layout: action.layout });
    case 'nerdMode': {
      if (typeof action.on !== 'boolean') return state;
      const leaving = !action.on && member(NERD_SETTINGS, state.settingsSection);
      return next(state, { nerdMode: action.on, ...(leaving ? { settingsSection: null } : {}) });
    }
    case 'appearance':
      if (!member(APPEARANCES, action.value)) return state;
      return next(state, { appearance: action.value });
    case 'settingsSection':
      if (action.section === null) return next(state, { settingsSection: null, narrowPane: 'list' });
      if (!member(settingsSections(state), action.section)) return state;
      return next(state, { settingsSection: action.section, narrowPane: 'detail' });
    case 'draft': {
      const { chatId, text } = action;
      if (!identity(chatId) || typeof text !== 'string' || text.length > SHELL_LIMITS.draftCharacters
        || !text.isWellFormed()) return state;
      const existing = Object.hasOwn(state.drafts, chatId);
      if (!existing && text.length === 0) return state;
      // Bounded without evicting anyone's unsent text.
      if (!existing && Object.keys(state.drafts).length >= SHELL_LIMITS.drafts) return state;
      const entries = Object.entries(state.drafts).filter(([key]) => key !== chatId);
      if (text.length > 0) entries.push([chatId, text]);
      return next(state, { drafts: freezeDrafts(entries) });
    }
    default:
      return state;
  }
}
