// A write-only field for a password, master password or one-time code. The value
// lives only in the native input: never in React state, props, snapshots or
// storage. takeSecret() reads it once for the call that sends it and empties the
// field at the same moment; leaving the page empties it too.
import type { JSX, RefObject } from 'react';
import { useEffect, useId, useRef } from 'react';
import { useTheme } from '../theme.tsx';
import { FieldLabel } from './controls.tsx';

export type SecretRef = RefObject<HTMLInputElement | null>;
export function useSecretRef(): SecretRef { return useRef<HTMLInputElement | null>(null); }

// The typed value, removed from the field. Callers pass it straight to one call.
export function takeSecret(ref: SecretRef): string {
  const input = ref.current;
  if (!input) return '';
  const value = input.value;
  input.value = '';
  return value;
}
export function clearSecret(ref: SecretRef): void { if (ref.current) ref.current.value = ''; }

export function SecretField(props: Readonly<{
  label: string; secretRef: SecretRef; maxLength: number; onFilled: (filled: boolean) => void;
  hint?: string | undefined; error?: string | undefined; disabled?: boolean; autoFocus?: boolean;
  // A one-time code is shown as typed; everything else is masked.
  visible?: boolean; autoComplete?: 'off' | 'username'; onSubmit?: () => void;
}>): JSX.Element {
  const { palette, font } = useTheme();
  const id = useId();
  const local = props.secretRef;
  useEffect(() => () => clearSecret(local), [local]);
  return (
    <FieldLabel label={props.label} hint={props.hint} error={props.error} htmlFor={id}>
      <input id={id} ref={props.secretRef} type={props.visible ? 'text' : 'password'} maxLength={props.maxLength}
        autoComplete={props.autoComplete ?? (props.visible ? 'one-time-code' : 'new-password')} autoCapitalize="off" autoCorrect="off" spellCheck={false}
        disabled={props.disabled} autoFocus={props.autoFocus} aria-invalid={props.error ? true : undefined}
        onInput={event => props.onFilled(event.currentTarget.value.length > 0)}
        onKeyDown={event => { if (event.key === 'Enter' && props.onSubmit) { event.preventDefault(); props.onSubmit(); } }}
        style={{ font: 'inherit', fontFamily: font, fontSize: 14, lineHeight: '20px', color: palette.ink, backgroundColor: palette.card,
          border: `1px solid ${props.error ? palette.danger : palette.line}`, borderRadius: 10, padding: '8px 10px', width: '100%',
          boxSizing: 'border-box', minWidth: 0 }} />
    </FieldLabel>
  );
}
