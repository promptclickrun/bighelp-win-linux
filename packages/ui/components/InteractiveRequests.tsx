// Approvals and questions from the agent. Each answers exactly one request;
// nothing is approved automatically. Answers are validated again in main.
import { useState } from 'react';
import type { JSX, ReactNode } from 'react';
import { View } from 'react-native-web';
import type { ApprovalChoice, InteractivePrompt, InteractiveQuestion } from '../../contracts/prompts.ts';
import { useTheme } from '../theme.tsx';
import { MONO_STACK } from '../tokens.ts';
import { Button, TextField } from './controls.tsx';
import { Icon, Label } from './primitives.tsx';

const CHOICES: Readonly<Record<ApprovalChoice, readonly [label: string, tone: 'primary' | 'secondary' | 'quiet']>> = Object.freeze({
  once: ['Allow once', 'primary'], session: ['Allow for this chat', 'secondary'], always: ['Always allow', 'secondary'], deny: ['Deny', 'quiet'],
});

function Frame(props: Readonly<{ title: string; icon: 'shield' | 'question'; children: ReactNode }>): JSX.Element {
  const { palette } = useTheme();
  return (
    <View role="group" aria-label={props.title} style={{ borderWidth: 1, borderColor: palette.warnLine, backgroundColor: palette.card, borderRadius: 14,
      padding: 12, gap: 10, boxShadow: '0 6px 18px -10px rgba(60,40,30,.3)' }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Icon name={props.icon} color={palette.warnInk} size={18} />
        <Label weight="700">{props.title}</Label>
      </View>
      {props.children}
    </View>
  );
}

function Approval(props: Readonly<{ prompt: Extract<InteractivePrompt, { kind: 'approval' }>; agentName: string; disabled: boolean; onAnswer: (answer: unknown) => void }>): JSX.Element {
  const { palette } = useTheme();
  const prompt = props.prompt;
  return (
    <Frame title={`${props.agentName} needs your OK`} icon="shield">
      <Label selectable>{prompt.description ?? (prompt.toolName ? `It wants to use ${prompt.toolName}.` : 'It wants to do something that needs your permission.')}</Label>
      {prompt.command ? (
        <pre style={{ margin: 0, padding: 8, maxHeight: 160, overflow: 'auto', borderRadius: 8, backgroundColor: palette.code, border: `1px solid ${palette.line}`,
          fontFamily: MONO_STACK, fontSize: 12, lineHeight: '17px', color: palette.ink, whiteSpace: 'pre-wrap', wordBreak: 'break-word', userSelect: 'text' }}>
          {prompt.command}</pre>
      ) : null}
      <Label size={12} tone="muted">This runs on the computer where Hermes is installed.</Label>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {prompt.choices.map(choice => {
          const [label, tone] = CHOICES[choice];
          return <Button key={choice} label={label} tone={choice === 'deny' ? 'danger' : tone} compact disabled={props.disabled} onPress={() => props.onAnswer(choice)} />;
        })}
      </View>
    </Frame>
  );
}

function Question(props: Readonly<{ question: InteractiveQuestion; value: string; onChange: (value: string) => void; disabled: boolean }>): JSX.Element {
  const { palette, font } = useTheme();
  const q = props.question;
  if (q.lockedAnswer !== undefined) return <View style={{ gap: 4 }}><Label weight="600">{q.question}</Label><Label tone="muted">{q.lockedAnswer}</Label></View>;
  let selected: string[] = [];
  if (q.multiSelect) { try { const parsed: unknown = JSON.parse(props.value || '[]'); if (Array.isArray(parsed)) selected = parsed.filter((v): v is string => typeof v === 'string'); } catch { /* typed answer */ } }
  return (
    <fieldset disabled={props.disabled} style={{ border: 'none', margin: 0, padding: 0, display: 'grid', gap: 6, fontFamily: font, color: palette.ink }}>
      <legend style={{ fontWeight: 600, fontSize: 14, padding: 0, marginBottom: 4, whiteSpace: 'pre-wrap' }}>{q.question}</legend>
      {q.choices.map(choice => (
        <label key={choice} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 14, cursor: 'pointer' }}>
          <input type={q.multiSelect ? 'checkbox' : 'radio'} name={q.id} style={{ marginTop: 3 }}
            checked={q.multiSelect ? selected.includes(choice) : props.value === choice}
            onChange={event => props.onChange(q.multiSelect
              ? JSON.stringify(event.target.checked ? [...selected, choice] : selected.filter(v => v !== choice)) : choice)} />
          <span style={{ whiteSpace: 'pre-wrap' }}>{choice}</span>
        </label>
      ))}
      <TextField label={q.choices.length ? 'Or type your own answer' : 'Your answer'} value={q.multiSelect || q.choices.includes(props.value) ? '' : props.value}
        onChange={props.onChange} maxLength={10000} disabled={props.disabled} />
    </fieldset>
  );
}

function Clarify(props: Readonly<{ prompt: Extract<InteractivePrompt, { kind: 'clarify' }>; agentName: string; disabled: boolean; onAnswer: (answer: unknown) => void }>): JSX.Element {
  const { palette } = useTheme();
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const prompt = props.prompt;
  const value = (q: InteractiveQuestion) => q.lockedAnswer ?? answers[q.id] ?? '';
  const ready = prompt.questions.every(q => value(q).trim() && value(q) !== '[]');
  return (
    <Frame title={`${props.agentName} has a question`} icon="question">
      <form style={{ display: 'grid', gap: 12 }} onSubmit={event => {
        event.preventDefault();
        if (!ready) return;
        const result = Object.fromEntries(prompt.questions.map(q => [q.id, value(q)]));
        props.onAnswer(prompt.isBatch ? result : result[prompt.questions[0]!.id]);
      }}>
        {prompt.questions.map(q => <Question key={q.id} question={q} value={value(q)} disabled={props.disabled}
          onChange={next => setAnswers(previous => ({ ...previous, [q.id]: next }))} />)}
        <div>
          <button type="submit" disabled={props.disabled || !ready} style={{ font: 'inherit', fontWeight: 600, fontSize: 13, minHeight: 30,
            padding: '0 12px', borderRadius: 10, border: `1px solid ${palette.action}`, backgroundColor: palette.action, color: palette.onAction,
            cursor: props.disabled || !ready ? 'not-allowed' : 'pointer', opacity: props.disabled || !ready ? 0.5 : 1 }}>Send answer</button>
        </div>
      </form>
    </Frame>
  );
}

export function InteractiveRequests(props: Readonly<{ prompts: readonly Readonly<{ id: string; prompt: InteractivePrompt }>[]; disabled: boolean;
  agentName?: string; onAnswer: (id: string, answer: unknown) => void }>): JSX.Element | null {
  if (!props.prompts.length) return null;
  const name = props.agentName ?? 'Your agent';
  return (
    <View style={{ width: '100%', maxWidth: 820, alignSelf: 'center', paddingHorizontal: 20, paddingTop: 6, gap: 8, maxHeight: 360, overflow: 'auto' }}>
      {props.prompts.map(item => item.prompt.kind === 'approval'
        ? <Approval key={item.id} prompt={item.prompt} agentName={name} disabled={props.disabled} onAnswer={answer => props.onAnswer(item.id, answer)} />
        : <Clarify key={item.id} prompt={item.prompt} agentName={name} disabled={props.disabled} onAnswer={answer => props.onAnswer(item.id, answer)} />)}
    </View>
  );
}
