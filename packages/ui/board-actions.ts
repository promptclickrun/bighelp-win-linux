// What each Feed, Ideas and Goals item offers, and the exact words the Mac app
// uses (Board/AgentBoard.swift, AgentBoardViews.swift, AgentGoalsView.swift).
// Pure: no I/O. Chat texts are composer prefills; the person decides to send.
import type { WorkspaceBoardFeatures, WorkspaceBoardItem } from '../contracts/workspace.ts';

export type BoardActionId = 'thumbsUp' | 'thumbsDown' | 'letsDoIt' | 'discuss' | 'promote' | 'done' | 'read' | 'copy' | 'dismiss';
export type BoardAction = Readonly<{ id: BoardActionId; label: string; tone: 'primary' | 'secondary' | 'quiet' | 'danger' }>;
const NO_FEATURES: WorkspaceBoardFeatures = Object.freeze({ feedback: false, answers: false, goalCategories: false });

// Shown after a thumbs down. Optional; "Skip" sends nothing more.
export const LESS_LIKE_THIS = Object.freeze(['Not relevant', 'Too frequent', 'Already knew', 'Wrong timing'] as const);

// Older plugins (AgentBoard.swift letsDoItMessage) match this exact text.
export function letsDoItText(title: string): string { return `Yes, go ahead with this idea: “${title}”.`; }
export function discussText(item: Pick<WorkspaceBoardItem, 'kind' | 'title'>): string {
  if (item.kind === 'idea') return `About your idea “${item.title}”: `;
  if (item.kind === 'goal') return `About my goal “${item.title}”: `;
  return `About “${item.title}”: `;
}
export function dismissWords(kind: WorkspaceBoardItem['kind']): Readonly<{ label: string; undo: (title: string) => string }> {
  if (kind === 'idea') return Object.freeze({ label: 'Not now', undo: (title: string) => `Not now: “${title}”` });
  if (kind === 'goal') return Object.freeze({ label: 'Remove', undo: (title: string) => `Removed “${title}”` });
  return Object.freeze({ label: 'Clear', undo: (title: string) => `Cleared “${title}”` });
}
export function isDone(item: Pick<WorkspaceBoardItem, 'status'>): boolean { return item.status === 'done'; }

// In the Mac's order. The prompt names the category so the agent files the goal there.
export const GOAL_CATEGORIES = Object.freeze([
  ['health', 'Health', 'a health goal'], ['relationships', 'Relationships', 'a relationship goal'],
  ['finance', 'Finance', 'a money goal'], ['career', 'Career', 'a career goal'],
  ['interests', 'Interests', 'a goal for one of my interests'], ['productivity', 'Productivity', 'a productivity goal'],
  ['other', 'Other', 'a goal'],
] as const);
export type GoalCategory = typeof GOAL_CATEGORIES[number][0];
export function goalPrompt(category: GoalCategory): string {
  const entry = GOAL_CATEGORIES.find(([id]) => id === category) ?? GOAL_CATEGORIES[6];
  const place = category === 'other' ? 'my Goals' : `my Goals under ${entry[1]}`;
  return `I'd like to set ${entry[2]}. Ask me a few quick questions about what I'm after, then make a plan and add it to ${place}.`;
}
export function goalCategoryTitle(category: string | undefined): string {
  return GOAL_CATEGORIES.find(([id]) => id === category)?.[1] ?? 'Other';
}
export function categoryChoiceLabel(category: GoalCategory): string {
  return category === 'other' ? 'Something else' : goalCategoryTitle(category);
}

// Actions for one item, in the Mac's order, offered only when the host's plugin
// can do them. chat: whether a chat can be opened from here.
export function boardActions(item: WorkspaceBoardItem, features: WorkspaceBoardFeatures | undefined, chat: boolean,
  tellFailed = false): readonly BoardAction[] {
  const can = features ?? NO_FEATURES;
  const actions: BoardAction[] = [];
  if (item.kind === 'feed') {
    actions.push({ id: 'thumbsUp', label: item.rating === 'up' ? 'Remove thumbs up' : 'Thumbs up', tone: 'secondary' });
    if (can.feedback) actions.push({ id: 'thumbsDown', label: item.rating === 'down' ? 'Remove thumbs down' : 'Thumbs down', tone: 'secondary' });
    if (chat) actions.push({ id: 'discuss', label: 'Discuss', tone: 'secondary' });
  } else if (item.kind === 'idea') {
    if (chat || can.answers) actions.push({ id: 'letsDoIt', label: tellFailed ? 'Try again' : "Let's do it", tone: 'primary' });
    if (chat) actions.push({ id: 'discuss', label: 'Start a chat about this', tone: 'secondary' });
    if (can.feedback) actions.push({ id: 'promote', label: 'Turn into a goal', tone: 'secondary' });
  } else {
    actions.push({ id: 'done', label: isDone(item) ? 'Mark active' : 'Mark done', tone: 'primary' });
    if (chat) actions.push({ id: 'discuss', label: 'Discuss', tone: 'secondary' });
  }
  if (can.feedback && item.read !== undefined) actions.push({ id: 'read', label: item.read ? 'Mark as unread' : 'Mark as read', tone: 'quiet' });
  actions.push({ id: 'copy', label: 'Copy', tone: 'quiet' });
  actions.push({ id: 'dismiss', label: dismissWords(item.kind).label, tone: item.kind === 'goal' ? 'danger' : 'quiet' });
  return Object.freeze(actions.map(action => Object.freeze(action)));
}

// List groups: goals by category (when the plugin sorts them) then Done; ideas
// by the agent's own section headings. Feed posts stay newest first.
export function boardGroups(items: readonly WorkspaceBoardItem[], features: WorkspaceBoardFeatures | undefined):
  readonly Readonly<{ title: string | null; items: readonly WorkspaceBoardItem[] }>[] {
  if (!items.length) return [];
  const kind = items[0]?.kind;
  const groups = new Map<string | null, WorkspaceBoardItem[]>();
  const add = (title: string | null, item: WorkspaceBoardItem) => { groups.set(title, [...(groups.get(title) ?? []), item]); };
  if (kind === 'goal') {
    const active = items.filter(item => !isDone(item));
    if (features?.goalCategories) {
      for (const [id, title] of GOAL_CATEGORIES) for (const item of active) if ((GOAL_CATEGORIES.some(([known]) => known === item.category) ? item.category : 'other') === id) add(title, item);
    } else for (const item of active) add('Tracking', item);
    for (const item of items) if (isDone(item)) add('Done', item);
  } else if (kind === 'idea' && items.some(item => item.section)) {
    for (const item of items) add(item.section ?? 'Other ideas', item);
  } else return [Object.freeze({ title: null, items })];
  return Object.freeze([...groups].map(([title, rows]) => Object.freeze({ title, items: Object.freeze(rows) })));
}
