// Rename, archive and delete for one chat: a menu plus its dialogs. Main reads
// Hermes' mutation snapshot and sends the fenced change; this file only asks.
import type { JSX } from 'react';
import { useState } from 'react';
import { CHAT_TITLE_MAX } from '../../../apps/desktop/src/shared/calls/chats.ts';
import type { CallFailure } from '../../../apps/desktop/src/shared/call.ts';
import { useCall, useQuery } from '../host.tsx';
import type { ChatView } from '../view-model.ts';
import { Banner, Button, ConfirmDialog, Dialog, MenuButton, TextField } from './controls.tsx';

type Pending = Readonly<{ kind: 'rename' | 'archive' | 'delete'; chat: ChatView }>;

// What the host lets this window change. Unsupported actions get no menu item.
export function useChatCapabilities(): Readonly<{ search: boolean; manage: boolean }> {
  const capabilities = useQuery('chats.capabilities', {});
  return { search: capabilities.value?.search === true, manage: capabilities.value?.manage === true };
}

// Needs a HostProvider above it (ChatList provides one).
export function ChatActions(props: Readonly<{ chat: ChatView; hostLabel: string; label?: string }>): JSX.Element {
  const call = useCall();
  const [pending, setPending] = useState<Pending | null>(null);
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const open = (kind: Pending['kind']) => { setPending({ kind, chat: props.chat }); setTitle(props.chat.title); setError(''); setBusy(false); };
  const close = () => { if (!busy) setPending(null); };
  const finish = (result: Readonly<{ ok: true }> | CallFailure) => {
    setBusy(false);
    if (result.ok) setPending(null);
    else setError(result.message);
  };
  const run = async () => {
    if (!pending || busy) return;
    const target = { profile: pending.chat.agentId, chatId: pending.chat.id };
    if (pending.kind === 'rename') {
      const cleaned = title.replace(/\s+/gu, ' ').trim();
      if (!cleaned) { setError('Enter a name for this chat.'); return; }
      if (cleaned.length > CHAT_TITLE_MAX) { setError(`Use a name up to ${CHAT_TITLE_MAX} characters.`); return; }
      if (cleaned === pending.chat.title) { setPending(null); return; }
      setBusy(true); setError('');
      finish(await call('chats.rename', { ...target, title: cleaned }));
      return;
    }
    setBusy(true); setError('');
    finish(await call(pending.kind === 'archive' ? 'chats.archive' : 'chats.delete', target));
  };
  const name = pending?.chat.title ?? props.chat.title;
  return (
    <>
      <MenuButton label={props.label ?? `More for ${props.chat.title}`} items={[
        { label: 'Rename…', onPress: () => open('rename') },
        { label: 'Archive…', onPress: () => open('archive') },
        { label: 'Delete…', tone: 'danger', onPress: () => open('delete') },
      ]} />
      <Dialog open={pending?.kind === 'rename'} title="Rename chat" onClose={close} actions={<>
        <Button label="Cancel" onPress={close} disabled={busy} />
        <Button label={busy ? 'Saving…' : 'Save'} tone="primary" disabled={busy || !title.trim()} onPress={() => { void run(); }} />
      </>}>
        <TextField label="Chat name" value={title} onChange={setTitle} maxLength={CHAT_TITLE_MAX} autoFocus required
          hint={`Up to ${CHAT_TITLE_MAX} characters. The new name is saved on ${props.hostLabel}.`} disabled={busy}
          onSubmit={() => { void run(); }} />
        {error ? <Banner tone="error" text={error} /> : null}
      </Dialog>
      <ConfirmDialog open={pending?.kind === 'archive'} title="Archive this chat?" confirmLabel="Archive" busy={busy}
        body={`“${name}” leaves your chat list. Its history stays saved on ${props.hostLabel}.`}
        error={error || undefined} onConfirm={() => { void run(); }} onCancel={close} />
      <ConfirmDialog open={pending?.kind === 'delete'} title="Delete this chat?" confirmLabel="Delete" tone="danger" busy={busy}
        body={`Deletes “${name}” and its history from ${props.hostLabel}. This can't be undone.`}
        error={error || undefined} onConfirm={() => { void run(); }} onCancel={close} />
    </>
  );
}
