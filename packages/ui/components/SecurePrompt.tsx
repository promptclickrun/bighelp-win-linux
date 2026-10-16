// A password, one-time code or secret the agent's computer asks for during a
// chat. Typed into write-only fields, read once for the single answer, then the
// fields are emptied. Skip declines. Nothing typed is kept, shown or added to chat.
import { useState } from 'react';
import type { JSX } from 'react';
import { View } from 'react-native-web';
import type { SecurePrompt } from '../../contracts/secure-prompts.ts';
import { SECURE_LIMITS } from '../../contracts/secure-prompts.ts';
import { useTheme } from '../theme.tsx';
import { MONO_STACK } from '../tokens.ts';
import { Button } from './controls.tsx';
import { Icon, Label } from './primitives.tsx';
import { SecretField, clearSecret, takeSecret, useSecretRef } from './SecretField.tsx';

function words(prompt: SecurePrompt, agent: string): Readonly<{ title: string; detail: string; field: string; note: string }> {
  const kept = "bighelp doesn't keep it or add it to the chat.";
  switch (prompt.method) {
    case 'vault.code': return { title: `${agent} needs a sign-in code`, field: 'Code',
      detail: `${prompt.site ?? 'The site'} is asking for a one-time code. ${prompt.hint ?? 'Enter the code it sent to your phone, email or app.'}`,
      note: `Hermes types it into the waiting page on your computer. Your agent never sees it, and ${kept}` };
    case 'vault.save_login': return { title: `Save a login for ${prompt.site ? hostOf(prompt.site) : 'this site'}`, field: 'Password',
      detail: `${agent} is on the sign-in page of ${prompt.site ?? 'a site'} and needs a login to continue.`,
      note: `Saved in the vault on your computer for this site only, then filled into the page. Your agent never sees the password, and ${kept}` };
    case 'vault.unlock_prompt': return { title: `Unlock ${prompt.manager ?? 'your password manager'}`, field: 'Master password',
      detail: `${agent} wants to use logins saved in ${prompt.manager ?? 'your password manager'}.`,
      note: `Unlocks it on your computer for this chat only. ${kept}` };
    case 'sudo': return { title: `${agent} needs your computer password`, field: 'Password',
      detail: 'Hermes passes it to sudo for the waiting command on your computer.', note: kept };
    case 'secret': return { title: `${agent} needs a secret value`, field: 'Value',
      detail: prompt.prompt ?? 'Enter it only if you want Hermes to keep it on your computer.',
      note: `Saved privately on your computer as ${prompt.envVar ?? 'a setting'}. Your agent can use it but never sees what you type, and ${kept}` };
  }
}
function hostOf(origin: string): string { try { return new URL(origin).host; } catch { return origin; } }

export function SecureRequest(props: Readonly<{ prompt: SecurePrompt; agentName: string; disabled: boolean; onAnswer: (answer: unknown) => void }>): JSX.Element {
  const { palette } = useTheme();
  const prompt = props.prompt;
  const text = words(prompt, props.agentName);
  const secret = useSecretRef(), identifier = useSecretRef();
  const [filled, setFilled] = useState(false);
  const [named, setNamed] = useState(false);
  const [error, setError] = useState('');
  const login = prompt.method === 'vault.save_login';
  const code = prompt.method === 'vault.code';
  const send = () => {
    if (props.disabled) return;
    if (login) {
      if (!named || !filled) { setError('Enter the email or username and the password.'); return; }
      const answer = { identifier: takeSecret(identifier), password: takeSecret(secret) };
      setFilled(false); setNamed(false); setError('');
      props.onAnswer(answer);
      return;
    }
    if (!filled) { setError(code ? 'Enter the code the site sent you.' : 'Enter a value, or choose Skip.'); return; }
    const value = takeSecret(secret); setFilled(false);
    if (code && !/^[A-Za-z0-9]{1,64}$/u.test(value.replace(/[\s-]+/gu, ''))) { setError('Enter the code the site sent you.'); return; }
    setError('');
    props.onAnswer(value);
  };
  const skip = () => { clearSecret(secret); clearSecret(identifier); setFilled(false); setNamed(false); props.onAnswer(''); };
  return (
    <View role="group" aria-label={text.title} style={{ borderWidth: 1, borderColor: palette.warnLine, backgroundColor: palette.card, borderRadius: 14,
      padding: 12, gap: 10, boxShadow: '0 6px 18px -10px rgba(60,40,30,.3)' }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Icon name="lock" color={palette.warnInk} size={18} />
        <Label weight="700">{text.title}</Label>
      </View>
      <Label selectable>{text.detail}</Label>
      {prompt.method === 'sudo' && prompt.command ? (
        <pre style={{ margin: 0, padding: 8, maxHeight: 120, overflow: 'auto', borderRadius: 8, backgroundColor: palette.code, border: `1px solid ${palette.line}`,
          fontFamily: MONO_STACK, fontSize: 12, lineHeight: '17px', color: palette.ink, whiteSpace: 'pre-wrap', wordBreak: 'break-word', userSelect: 'text' }}>
          {prompt.command}</pre>
      ) : null}
      {login ? <SecretField label="Email or username" secretRef={identifier} visible autoComplete="username" maxLength={SECURE_LIMITS.identifier} onFilled={setNamed}
        disabled={props.disabled} autoFocus /> : null}
      <SecretField label={text.field} secretRef={secret} visible={code} maxLength={code ? SECURE_LIMITS.code : login ? SECURE_LIMITS.password : SECURE_LIMITS.value}
        onFilled={setFilled} disabled={props.disabled} autoFocus={!login} error={error || undefined} onSubmit={send} />
      <Label size={12} tone="muted">{text.note}</Label>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        <Button label={login ? 'Save and sign in' : 'Send'} tone="primary" compact disabled={props.disabled} onPress={send} />
        <Button label="Skip" tone="quiet" compact disabled={props.disabled} onPress={skip} />
      </View>
    </View>
  );
}
