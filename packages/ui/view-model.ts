// Safe, display-only view data. No credentials, no host addresses, no callbacks.
// In this slice nothing is fetched: the real app starts EMPTY, and sample data
// appears only in a development run with --fixture-preview.

export type Delivery = 'pending' | 'unknown';
export type TranscriptItem =
  | Readonly<{ kind: 'day'; id: string; label: string }>
  | Readonly<{ kind: 'message'; id: string; direction: 'in' | 'out'; paragraphs: readonly string[];
      bullets?: readonly string[]; delivery?: Delivery }>
  | Readonly<{ kind: 'tool'; id: string; label: string; detail: string }>;

export type AgentView = Readonly<{ id: string; name: string; summary: string; color: string }>;
export type ChatView = Readonly<{
  id: string; agentId: string; title: string; preview: string; transcript: readonly TranscriptItem[];
}>;
export type HostView = Readonly<{ label: string; state: 'connected' | 'offline' }>;
export type WorkflowView = Readonly<{ id: string; title: string; status: string }>;

export type ViewData = Readonly<{
  sample: boolean;
  host: HostView | null;
  agents: readonly AgentView[];
  chats: readonly ChatView[];
  workflows: readonly WorkflowView[];
}>;

export const EMPTY_DATA: ViewData = Object.freeze({
  sample: false, host: null, agents: Object.freeze([]), chats: Object.freeze([]), workflows: Object.freeze([]),
});

// No transport exists yet, so Send is never enabled. The draft still works.
export function composerStatus(data: ViewData): Readonly<{ canSend: false; hint: string }> {
  return Object.freeze({
    canSend: false,
    hint: data.sample ? 'Sample data. Nothing is sent.' : 'Send waits until a computer is connected.',
  });
}

export function chatById(data: ViewData, id: string | null): ChatView | null {
  return data.chats.find(chat => chat.id === id) ?? null;
}
export function agentById(data: ViewData, id: string | null): AgentView | null {
  return data.agents.find(agent => agent.id === id) ?? null;
}
