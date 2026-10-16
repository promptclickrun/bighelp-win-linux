// Per-chat controls in the conversation header: model and reasoning for this
// chat only. Changes apply through Hermes and are read back, never assumed.
import type { JSX } from 'react';
import { useMemo, useState } from 'react';
import { View } from 'react-native-web';
import { REASONING_LEVELS } from '../../../apps/desktop/src/shared/calls/chat.ts';
import { useCall, useQuery } from '../host.tsx';
import { useTheme } from '../theme.tsx';
import { Banner, Button, Dialog, SelectField, TextField } from './controls.tsx';
import { IconButton, Label } from './primitives.tsx';

const REASONING_LABELS: Readonly<Record<typeof REASONING_LEVELS[number], string>> = Object.freeze({
  none: 'Off', minimal: 'Minimal', low: 'Low', medium: 'Medium', high: 'High', xhigh: 'Extra high', max: 'Max',
});

export function ModelButton(props: Readonly<{ chatId: string; running: boolean; current: Readonly<{ name: string; provider: string; reasoning: string }> | null }>): JSX.Element {
  const [open, setOpen] = useState(false);
  return <>
    <IconButton icon="agents" label={props.current ? `Model: ${props.current.name}. Change for this chat` : 'Model and reasoning for this chat'} onPress={() => setOpen(true)} />
    {open ? <ModelDialog chatId={props.chatId} running={props.running} current={props.current} onClose={() => setOpen(false)} /> : null}
  </>;
}

function ModelDialog(props: Readonly<{ chatId: string; running: boolean; current: Readonly<{ name: string; provider: string; reasoning: string }> | null; onClose: () => void }>): JSX.Element {
  const { palette, font } = useTheme();
  const call = useCall();
  const models = useQuery('chat.models', { chatId: props.chatId });
  const [search, setSearch] = useState('');
  const [choice, setChoice] = useState<Readonly<{ provider: string; model: string }> | null>(null);
  const [level, setLevel] = useState<typeof REASONING_LEVELS[number] | ''>('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<Readonly<{ tone: 'error' | 'success' | 'warn'; text: string }> | null>(null);
  const [confirm, setConfirm] = useState('');
  const current = models.value?.current ?? (props.current ? { model: props.current.name, provider: props.current.provider } : null);
  const selected = choice ?? current;
  const rows = useMemo(() => {
    const query = search.trim().toLowerCase();
    return (models.value?.providers ?? []).map(provider => ({ ...provider,
      models: provider.models.filter(model => !query || model.toLowerCase().includes(query) || provider.name.toLowerCase().includes(query)).slice(0, 80) }))
      .filter(provider => provider.models.length);
  }, [models.value, search]);
  const supportsReasoning = !!selected && !!models.value?.providers.find(provider => provider.slug === selected.provider)?.reasoning.includes(selected.model);
  const changed = !!choice && (!current || choice.model !== current.model || choice.provider !== current.provider);
  const apply = async (confirmExpensive: boolean) => {
    setBusy(true); setMessage(null);
    try {
      if (changed && choice) {
        const result = await call('chat.setModel', { chatId: props.chatId, model: choice.model, provider: choice.provider, confirmExpensive });
        if (!result.ok) { setMessage({ tone: 'error', text: result.message }); return; }
        if (result.value.status === 'confirm') { setConfirm(result.value.message); return; }
        setConfirm('');
        setMessage({ tone: 'success', text: result.value.status === 'deferred' ? 'Saved. The new model starts with the next reply.' : 'This chat now uses the new model.' });
      }
      if (level && supportsReasoning) {
        const result = await call('chat.setReasoning', { chatId: props.chatId, level });
        if (!result.ok) { setMessage({ tone: 'error', text: result.message }); return; }
        setMessage({ tone: 'success', text: `Reasoning is now ${REASONING_LABELS[level]}.` });
      }
      models.reload();
    } finally { setBusy(false); }
  };
  return (
    <Dialog open title="Model for this chat" onClose={props.onClose} width={560} actions={<>
      <Button label="Close" onPress={props.onClose} />
      {confirm ? <Button label={busy ? 'Working…' : 'Use it anyway'} tone="danger" disabled={busy} onPress={() => { void apply(true); }} />
        : <Button label={busy ? 'Applying…' : 'Apply to this chat'} tone="primary" disabled={busy || props.running || (!changed && !level)} onPress={() => { void apply(false); }} />}
    </>}>
      <Label size={13} tone="muted">{current ? `Now using ${current.model}${current.provider ? ` (${current.provider})` : ''}. Changes affect only this chat.` : 'Changes affect only this chat.'}</Label>
      {props.running ? <Banner tone="warn" text="The model stays fixed until this reply finishes." /> : null}
      {confirm ? <Banner tone="warn" title="This model may cost more" text={confirm} /> : null}
      {message ? <Banner tone={message.tone} text={message.text} /> : null}
      {models.status === 'failed' ? <Banner tone="error" text={models.message} /> : null}
      {models.status === 'loading' && !models.value ? <Label tone="muted">Loading models from your computer…</Label> : null}
      {models.value ? <>
        <TextField label="Find a model" type="search" value={search} onChange={setSearch} maxLength={120} />
        <div role="radiogroup" aria-label="Models" style={{ maxHeight: 280, overflowY: 'auto', border: `1px solid ${palette.line}`, borderRadius: 10, fontFamily: font }}>
          {rows.length ? rows.map(provider => (
            <div key={provider.slug}>
              <div style={{ padding: '8px 12px 4px', fontSize: 12, fontWeight: 700, color: palette.muted }}>{provider.name}</div>
              {provider.models.map(model => {
                const checked = selected?.model === model && selected.provider === provider.slug;
                return (
                  <label key={model} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px', cursor: 'pointer', fontSize: 14,
                    color: palette.ink, background: checked ? palette.actionSoft : 'transparent' }}>
                    <input type="radio" name="model" checked={checked} onChange={() => { setChoice({ provider: provider.slug, model }); setConfirm(''); }} />
                    <span style={{ overflowWrap: 'anywhere' }}>{model}</span>
                  </label>
                );
              })}
            </div>
          )) : <div style={{ padding: 12, color: palette.muted, fontSize: 13 }}>No models match.</div>}
        </div>
        {supportsReasoning ? (
          <SelectField label="Reasoning" value={level || 'keep'} onChange={value => setLevel(value === 'keep' ? '' : value)}
            options={[{ value: 'keep', label: props.current?.reasoning ? `Keep (${props.current.reasoning})` : 'Keep current' },
              ...REASONING_LEVELS.map(value => ({ value, label: REASONING_LABELS[value] }))]} />
        ) : <View><Label size={12} tone="muted">This model has no reasoning levels to choose.</Label></View>}
      </> : null}
    </Dialog>
  );
}
