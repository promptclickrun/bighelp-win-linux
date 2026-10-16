import { useState } from 'react';
import type { JSX } from 'react';
import type { InteractivePrompt } from '../../contracts/prompts.ts';
import { View } from 'react-native-web';
import { Label } from './primitives.tsx';

function Request(props: Readonly<{ prompt: InteractivePrompt; onAnswer: (answer: unknown) => void; disabled: boolean }>): JSX.Element {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const prompt = props.prompt;
  if (prompt.kind === 'approval') return <View style={{ padding: 12, gap: 8 }}>
    <Label weight="600">Permission requested</Label>
    <Label selectable>{prompt.description ?? prompt.toolName ?? 'Hermes needs your permission.'}</Label>
    {prompt.command ? <Label selectable mono>{prompt.command}</Label> : null}
    <View style={{ flexDirection: 'row', gap: 8 }}>{prompt.choices.map(choice => <button key={choice} disabled={props.disabled} onClick={() => props.onAnswer(choice)}>{({once: 'Allow once', session: 'Allow this session', always: 'Always allow', deny: 'Deny'})[choice]}</button>)}</View>
  </View>;
  const value = (id: string, locked?: string) => locked ?? answers[id] ?? '';
  return <form style={{ padding: 12, display: 'grid', gap: 8 }} onSubmit={event => {
    event.preventDefault();
    const result = Object.fromEntries(prompt.questions.map(q => [q.id, value(q.id, q.lockedAnswer)]));
    props.onAnswer(prompt.isBatch ? result : result[prompt.questions[0]!.id]);
  }}>
    {prompt.questions.map(q => <fieldset key={q.id} disabled={props.disabled || q.lockedAnswer !== undefined}>
      <legend>{q.question}</legend>
      {q.lockedAnswer !== undefined ? <p>{q.lockedAnswer}</p> : <>
        {q.choices.map(choice => <label key={choice} style={{ display: 'block' }}><input type={q.multiSelect ? 'checkbox' : 'radio'} name={q.id} checked={q.multiSelect ? (() => { try { return (JSON.parse(answers[q.id] ?? '[]') as string[]).includes(choice); } catch { return false; } })() : answers[q.id] === choice} onChange={event => setAnswers(previous => {
          if (!q.multiSelect) return { ...previous, [q.id]: choice };
          let selected: string[] = []; try { const parsed: unknown = JSON.parse(previous[q.id] ?? '[]'); if (Array.isArray(parsed)) selected = parsed.filter((v): v is string => typeof v === 'string'); } catch { /* typed answer */ }
          return { ...previous, [q.id]: JSON.stringify(event.target.checked ? [...selected, choice] : selected.filter(v => v !== choice)) };
        })} />{choice}</label>)}
        <label>Your answer <input maxLength={10000} value={answers[q.id] ?? ''} onChange={event => setAnswers(previous => ({ ...previous, [q.id]: event.target.value }))} /></label>
      </>}
    </fieldset>)}
    <button type="submit" disabled={props.disabled || prompt.questions.some(q => !value(q.id, q.lockedAnswer).trim() || value(q.id, q.lockedAnswer) === '[]')}>Send answer</button>
  </form>;
}
export function InteractiveRequests(props: Readonly<{ prompts: readonly Readonly<{ id: string; prompt: InteractivePrompt }>[]; disabled: boolean; onAnswer: (id: string, answer: unknown) => void }>): JSX.Element {
  return <View style={{ maxHeight: 280, overflow: 'scroll' }}>{props.prompts.map(item => <Request key={item.id} prompt={item.prompt} disabled={props.disabled} onAnswer={answer => props.onAnswer(item.id, answer)} />)}</View>;
}
