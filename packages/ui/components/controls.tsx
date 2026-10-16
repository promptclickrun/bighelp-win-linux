// Shared form and page controls. Text entry uses native inputs so IME, undo,
// selection, spellcheck settings and screen readers behave like the OS.
// No spinners or animated effects: busy states are still text.
import type { CSSProperties, JSX, KeyboardEvent, ReactNode } from 'react';
import { useEffect, useId, useRef, useState } from 'react';
import { Pressable, View } from 'react-native-web';
import type { GlyphName } from '../glyphs.ts';
import { useTheme } from '../theme.tsx';
import { MONO_STACK } from '../tokens.ts';
import { Icon, Label } from './primitives.tsx';
import type { Tone } from './primitives.tsx';

export type ButtonTone = 'primary' | 'secondary' | 'danger' | 'quiet';

export function Button(props: Readonly<{
  label: string; onPress: () => void; tone?: ButtonTone; disabled?: boolean; icon?: GlyphName;
  accessibleLabel?: string; compact?: boolean;
}>): JSX.Element {
  const { palette } = useTheme();
  const tone = props.tone ?? 'secondary';
  const colors = {
    primary: { background: palette.action, ink: palette.onAction, border: palette.action, hover: palette.action },
    secondary: { background: palette.card, ink: palette.ink, border: palette.line, hover: palette.hover },
    danger: { background: palette.danger, ink: palette.onDanger, border: palette.danger, hover: palette.danger },
    quiet: { background: 'transparent', ink: palette.action, border: 'transparent', hover: palette.hover },
  }[tone];
  const inkTone: Tone = tone === 'primary' ? 'onAction' : tone === 'danger' ? 'onDanger' : tone === 'quiet' ? 'action' : 'ink';
  return (
    <Pressable role="button" aria-label={props.accessibleLabel ?? props.label} disabled={props.disabled ?? false} onPress={props.onPress}
      style={({ hovered }) => ({
        flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, minHeight: props.compact ? 30 : 36,
        paddingHorizontal: props.compact ? 10 : 14, borderRadius: 10, borderWidth: 1, borderColor: colors.border,
        backgroundColor: hovered && !props.disabled && tone !== 'primary' && tone !== 'danger' ? colors.hover : colors.background,
        opacity: props.disabled ? 0.5 : hovered && (tone === 'primary' || tone === 'danger') ? 0.9 : 1,
        cursor: props.disabled ? 'not-allowed' : 'pointer', flexShrink: 0,
      })}>
      {props.icon ? <Icon name={props.icon} color={colors.ink} size={16} /> : null}
      <Label size={props.compact ? 13 : 14} weight="600" tone={inkTone}>{props.label}</Label>
    </Pressable>
  );
}

function inputStyle(palette: ReturnType<typeof useTheme>['palette'], font: string, error: boolean, mono = false): CSSProperties {
  return {
    font: 'inherit', fontFamily: mono ? MONO_STACK : font, fontSize: 14, lineHeight: '20px', color: palette.ink,
    backgroundColor: palette.card, border: `1px solid ${error ? palette.danger : palette.line}`, borderRadius: 10,
    padding: '8px 10px', width: '100%', boxSizing: 'border-box', minWidth: 0,
  };
}

export function FieldLabel(props: Readonly<{ label: string; hint?: string | undefined; error?: string | undefined; children: ReactNode; htmlFor?: string }>): JSX.Element {
  const { palette, font } = useTheme();
  return (
    <div style={{ display: 'grid', gap: 6, fontFamily: font }}>
      <label htmlFor={props.htmlFor} style={{ fontSize: 13, fontWeight: 600, color: palette.ink }}>{props.label}</label>
      {props.children}
      {props.error ? <div role="alert" style={{ fontSize: 12, color: palette.danger }}>{props.error}</div>
        : props.hint ? <div style={{ fontSize: 12, color: palette.muted }}>{props.hint}</div> : null}
    </div>
  );
}

export function TextField(props: Readonly<{
  label: string; value: string; onChange: (value: string) => void; maxLength: number;
  type?: 'text' | 'password' | 'url' | 'search' | 'time' | 'datetime-local'; multiline?: boolean; rows?: number; placeholder?: string;
  hint?: string | undefined; error?: string | undefined; disabled?: boolean; autoFocus?: boolean; mono?: boolean;
  required?: boolean; spellCheck?: boolean; onSubmit?: () => void;
}>): JSX.Element {
  const { palette, font } = useTheme();
  const id = useId();
  const common = {
    id, value: props.value, maxLength: props.maxLength, placeholder: props.placeholder, disabled: props.disabled,
    autoFocus: props.autoFocus, required: props.required, spellCheck: props.spellCheck ?? false, autoComplete: 'off',
    'aria-invalid': props.error ? true : undefined,
    style: inputStyle(palette, font, !!props.error, props.mono),
  } as const;
  return (
    <FieldLabel label={props.label} hint={props.hint} error={props.error} htmlFor={id}>
      {props.multiline
        ? <textarea {...common} rows={props.rows ?? 4} onChange={event => props.onChange(event.target.value)}
            style={{ ...common.style, resize: 'vertical', minHeight: 80 }} />
        : <input {...common} type={props.type ?? 'text'} onChange={event => props.onChange(event.target.value)}
            onKeyDown={event => { if (event.key === 'Enter' && props.onSubmit) { event.preventDefault(); props.onSubmit(); } }} />}
    </FieldLabel>
  );
}

export type Option<T extends string> = Readonly<{ value: T; label: string }>;
export function SelectField<T extends string>(props: Readonly<{
  label: string; value: T; options: readonly Option<T>[]; onChange: (value: T) => void; hint?: string; disabled?: boolean;
}>): JSX.Element {
  const { palette, font } = useTheme();
  const id = useId();
  return (
    <FieldLabel label={props.label} hint={props.hint} htmlFor={id}>
      <select id={id} value={props.value} disabled={props.disabled} style={inputStyle(palette, font, false)}
        onChange={event => {
          const match = props.options.find(option => option.value === event.target.value);
          if (match) props.onChange(match.value);
        }}>
        {props.options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    </FieldLabel>
  );
}

export function Toggle(props: Readonly<{ label: string; detail?: string; value: boolean; onChange: (value: boolean) => void; disabled?: boolean }>): JSX.Element {
  const { palette } = useTheme();
  return (
    <Pressable role="switch" aria-checked={props.value} aria-label={props.label} disabled={props.disabled ?? false}
      onPress={() => props.onChange(!props.value)}
      style={({ hovered }) => [{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, paddingHorizontal: 14,
        cursor: props.disabled ? 'not-allowed' : 'pointer', opacity: props.disabled ? 0.5 : 1 },
      hovered && !props.disabled ? { backgroundColor: palette.hover } : null]}>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Label weight="600">{props.label}</Label>
        {props.detail ? <Label size={12} tone="muted">{props.detail}</Label> : null}
      </View>
      <View style={{ width: 40, height: 24, borderRadius: 12, backgroundColor: props.value ? palette.action : palette.line }}>
        <View style={{ position: 'absolute', top: 3, left: props.value ? 19 : 3, width: 18, height: 18, borderRadius: 9,
          backgroundColor: props.value ? palette.onAction : '#FFFFFF', boxShadow: '0 1px 2px rgba(0,0,0,.3)' }} />
      </View>
    </Pressable>
  );
}

export function RadioList<T extends string>(props: Readonly<{
  label: string; value: T; options: readonly (Option<T> & Readonly<{ detail?: string }>)[]; onChange: (value: T) => void; disabled?: boolean;
}>): JSX.Element {
  const { palette } = useTheme();
  const id = useId();
  return (
    <View style={{ gap: 8 }}>
      <Label nativeID={id} weight="600">{props.label}</Label>
      <View role="radiogroup" aria-labelledby={id} style={{ backgroundColor: palette.card, borderWidth: 1, borderColor: palette.line,
        borderRadius: 14, overflow: 'hidden' }}>
        {props.options.map((option, index) => (
          <Pressable key={option.value} role="radio" aria-checked={props.value === option.value} aria-label={option.label}
            disabled={props.disabled ?? false} onPress={() => props.onChange(option.value)}
            style={({ hovered }) => [{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, paddingHorizontal: 14,
              cursor: 'pointer', borderTopWidth: index === 0 ? 0 : 1, borderTopColor: palette.line },
            hovered ? { backgroundColor: palette.hover } : null]}>
            <View style={{ flex: 1 }}>
              <Label weight="600">{option.label}</Label>
              {option.detail ? <Label size={12} tone="muted">{option.detail}</Label> : null}
            </View>
            {props.value === option.value ? <Icon name="check" color={palette.action} /> : null}
          </Pressable>
        ))}
      </View>
    </View>
  );
}

// A titled group of rows, as in the Settings overview.
export function Card(props: Readonly<{ title?: string; detail?: string; children: ReactNode; padded?: boolean }>): JSX.Element {
  const { palette } = useTheme();
  return (
    <View style={{ gap: 8 }}>
      {props.title ? <View style={{ gap: 2 }}>
        <Label heading={3} size={14} weight="700">{props.title}</Label>
        {props.detail ? <Label size={12} tone="muted">{props.detail}</Label> : null}
      </View> : null}
      <View style={{ backgroundColor: palette.card, borderWidth: 1, borderColor: palette.line, borderRadius: 14, overflow: 'hidden',
        ...(props.padded ? { padding: 14, gap: 12 } : {}) }}>
        {props.children}
      </View>
    </View>
  );
}

// One labeled fact or control inside a Card.
export function Row(props: Readonly<{ title: string; detail?: string | undefined; first?: boolean; children?: ReactNode; selectable?: boolean }>): JSX.Element {
  const { palette } = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, paddingHorizontal: 14,
      borderTopWidth: props.first ? 0 : 1, borderTopColor: palette.line, minHeight: 44 }}>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Label weight="600">{props.title}</Label>
        {props.detail ? <Label size={12} tone="muted" selectable={props.selectable ?? false}>{props.detail}</Label> : null}
      </View>
      {props.children}
    </View>
  );
}

export function PageBody(props: Readonly<{ children: ReactNode; width?: number }>): JSX.Element {
  return <View style={{ width: '100%', maxWidth: props.width ?? 640, alignSelf: 'center', paddingHorizontal: 20, paddingTop: 18,
    paddingBottom: 32, gap: 16 }}>{props.children}</View>;
}

export type BannerTone = 'info' | 'warn' | 'error' | 'success';
export function Banner(props: Readonly<{ tone: BannerTone; title?: string; text: string; children?: ReactNode }>): JSX.Element {
  const { palette } = useTheme();
  const colors: Readonly<Record<BannerTone, readonly [string, string]>> = {
    info: [palette.actionSoft, palette.line], warn: [palette.warnBackground, palette.warnLine],
    error: [palette.dangerSoft, palette.danger], success: [palette.successSoft, palette.successSoft],
  };
  const [background, border] = colors[props.tone];
  const tone: Tone = props.tone === 'warn' ? 'warnInk' : props.tone === 'error' ? 'danger' : props.tone === 'success' ? 'successInk' : 'ink';
  return (
    <View role="status" aria-live="polite" style={{ backgroundColor: background, borderWidth: 1, borderColor: border, borderRadius: 12,
      paddingVertical: 10, paddingHorizontal: 12, gap: 6 }}>
      {props.title ? <Label weight="700" tone={tone}>{props.title}</Label> : null}
      <Label size={13} tone={tone} selectable>{props.text}</Label>
      {props.children ? <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>{props.children}</View> : null}
    </View>
  );
}

// Modal dialog on the platform <dialog>: focus trap, Esc to close and an inert
// background come from the browser engine, not from hand-written key handling.
export function Dialog(props: Readonly<{
  open: boolean; title: string; onClose: () => void; children: ReactNode; actions?: ReactNode; width?: number;
}>): JSX.Element | null {
  const { palette, font } = useTheme();
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const dialog = ref.current; if (!dialog) return;
    if (props.open && !dialog.open) dialog.showModal();
    if (!props.open && dialog.open) dialog.close();
  }, [props.open]);
  if (!props.open) return null;
  return (
    <dialog ref={ref} aria-labelledby={titleId} onCancel={event => { event.preventDefault(); props.onClose(); }}
      style={{ border: `1px solid ${palette.line}`, borderRadius: 16, padding: 0, backgroundColor: palette.card, color: palette.ink,
        fontFamily: font, width: `min(${props.width ?? 480}px, calc(100vw - 48px))`, maxHeight: 'calc(100vh - 64px)',
        boxShadow: '0 18px 50px -12px rgba(0,0,0,.35)' }}>
      <div style={{ display: 'grid', gap: 14, padding: 20, maxHeight: 'calc(100vh - 64px)', overflow: 'auto', boxSizing: 'border-box' }}>
        <h2 id={titleId} style={{ margin: 0, fontSize: 17, fontWeight: 700 }}>{props.title}</h2>
        {props.children}
        {props.actions ? <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, flexWrap: 'wrap' }}>{props.actions}</div> : null}
      </div>
    </dialog>
  );
}

export function ConfirmDialog(props: Readonly<{
  open: boolean; title: string; body: string; confirmLabel: string; tone?: 'primary' | 'danger'; busy?: boolean;
  error?: string | undefined; onConfirm: () => void; onCancel: () => void;
}>): JSX.Element | null {
  return (
    <Dialog open={props.open} title={props.title} onClose={props.onCancel} actions={<>
      <Button label="Cancel" onPress={props.onCancel} />
      <Button label={props.busy ? 'Working…' : props.confirmLabel} tone={props.tone ?? 'primary'} disabled={props.busy ?? false} onPress={props.onConfirm} />
    </>}>
      <Label selectable>{props.body}</Label>
      {props.error ? <Banner tone="error" text={props.error} /> : null}
    </Dialog>
  );
}

export type MenuItem = Readonly<{ label: string; onPress: () => void; tone?: 'danger'; disabled?: boolean }>;
// A small popup menu for row actions. Arrow keys move, Esc and outside clicks close.
export function MenuButton(props: Readonly<{ label: string; items: readonly MenuItem[]; icon?: GlyphName }>): JSX.Element {
  const { palette, font } = useTheme();
  const [open, setOpen] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => { if (!container.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', close);
    container.current?.querySelector<HTMLButtonElement>('[role="menuitem"]:not([disabled])')?.focus();
    return () => document.removeEventListener('mousedown', close);
  }, [open]);
  const move = (event: KeyboardEvent<HTMLDivElement>) => {
    const items = [...(container.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not([disabled])') ?? [])];
    const index = items.indexOf(document.activeElement as HTMLButtonElement);
    if (event.key === 'Escape') { event.preventDefault(); setOpen(false); container.current?.querySelector<HTMLElement>('[aria-haspopup]')?.focus(); }
    if (event.key === 'ArrowDown') { event.preventDefault(); items[(index + 1) % items.length]?.focus(); }
    if (event.key === 'ArrowUp') { event.preventDefault(); items[(index - 1 + items.length) % items.length]?.focus(); }
  };
  return (
    <div ref={container} style={{ position: 'relative', display: 'inline-flex' }} onKeyDown={move}>
      <button type="button" aria-label={props.label} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(value => !value)}
        style={{ width: 30, height: 30, border: 'none', borderRadius: 8, background: open ? palette.hover : 'transparent', cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0 }}>
        <Icon name={props.icon ?? 'more'} color={palette.ink} size={18} />
      </button>
      {open ? (
        <div role="menu" aria-label={props.label} style={{ position: 'absolute', right: 0, top: 32, zIndex: 20, minWidth: 180,
          backgroundColor: palette.raised, border: `1px solid ${palette.line}`, borderRadius: 10, padding: 4,
          boxShadow: '0 10px 30px -10px rgba(0,0,0,.35)', fontFamily: font }}>
          {props.items.map(item => (
            <button key={item.label} type="button" role="menuitem" disabled={item.disabled}
              onClick={() => { setOpen(false); item.onPress(); }}
              style={{ display: 'block', width: '100%', textAlign: 'left', border: 'none', borderRadius: 7, padding: '8px 10px',
                background: 'transparent', color: item.tone === 'danger' ? palette.danger : palette.ink, fontFamily: font, fontSize: 14,
                cursor: item.disabled ? 'not-allowed' : 'pointer', opacity: item.disabled ? 0.5 : 1 }}
              onMouseEnter={event => { event.currentTarget.style.background = palette.hover; }}
              onMouseLeave={event => { event.currentTarget.style.background = 'transparent'; }}
              onFocus={event => { event.currentTarget.style.background = palette.hover; }}
              onBlur={event => { event.currentTarget.style.background = 'transparent'; }}>
              {item.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
