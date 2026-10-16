// Synthetic sample content, the same made-up people and agents as mock D.
// Development preview only (--fixture-preview); never shown in a packaged build.
// No real accounts, hosts or messages. Statuses make no claim about results.
import type { ViewData, ChatView, TranscriptItem } from './view-model.ts';

const planning: readonly TranscriptItem[] = Object.freeze([
  Object.freeze({ kind: 'day', id: 'd1', label: 'Today' }),
  Object.freeze({ kind: 'message', id: 'm1', direction: 'out',
    paragraphs: Object.freeze(["Can you turn my notes from Tuesday's planning call into a short checklist?"]) }),
  Object.freeze({ kind: 'tool', id: 't1', label: 'Read a file', detail: 'notes/planning-call.md' }),
  Object.freeze({ kind: 'message', id: 'm2', direction: 'in',
    paragraphs: Object.freeze(["Here's what your notes ask for:", 'Want any of these in Goals? Nothing is tracked until you say so.']),
    bullets: Object.freeze(['Confirm the venue for the 24th', 'Send the draft agenda to Sam', 'Book a projector']) }),
  Object.freeze({ kind: 'message', id: 'm3', direction: 'out', delivery: 'unknown',
    paragraphs: Object.freeze(['Yes, add the first two.']) }),
]);

function chat(id: string, agentId: string, title: string, preview: string, transcript?: readonly TranscriptItem[]): ChatView {
  return Object.freeze({ id, agentId, title, preview, transcript: transcript ?? Object.freeze([
    Object.freeze({ kind: 'day', id: `${id}-d`, label: 'Earlier' }),
    Object.freeze({ kind: 'message', id: `${id}-m`, direction: 'in', paragraphs: Object.freeze([preview]) }),
  ]) });
}

export const SAMPLE_DATA: ViewData = Object.freeze({
  sample: true,
  host: Object.freeze({ label: 'Sample computer', state: 'connected' }),
  agents: Object.freeze([
    Object.freeze({ id: 'juniper', name: 'Juniper', summary: 'Everyday help', color: '#2BA59A' }),
    Object.freeze({ id: 'otto', name: 'Otto', summary: 'Research and errands', color: '#4A7BEA' }),
    Object.freeze({ id: 'marigold', name: 'Marigold', summary: 'Home and groceries', color: '#E39A2D' }),
  ]),
  chats: Object.freeze([
    chat('c1', 'juniper', 'Planning call checklist', 'Yes, add the first two.', planning),
    chat('c2', 'otto', 'Projector options', 'Two rentals are near the venue.'),
    chat('c3', 'marigold', 'Weekly groceries', 'List saved to Files.'),
    chat('c4', 'juniper', 'Draft agenda for the 24th', "Here's a shorter version."),
    chat('c5', 'otto', 'Trip ideas', 'You asked for three, not five.'),
  ]),
  workflows: Object.freeze([
    Object.freeze({ id: 'w1', title: 'Weekly grocery list', status: 'Runs when you ask' }),
    Object.freeze({ id: 'w2', title: 'Meeting notes to checklist', status: 'Runs when you ask' }),
    Object.freeze({ id: 'w3', title: 'Trip packing list', status: 'Paused' }),
  ]),
});
