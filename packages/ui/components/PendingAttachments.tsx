import type { JSX } from 'react';
import { View } from 'react-native-web';
import { useTheme } from '../theme.tsx';
import { Icon, IconButton, Label } from './primitives.tsx';

// Files waiting to go with the next message. Names and sizes only.
export function PendingAttachments(props: Readonly<{ files: readonly Readonly<{ id: string; name: string; size: number; kind: 'image' | 'file' }>[];
  onRemove?: ((id: string) => void) | undefined }>): JSX.Element | null {
  const { palette } = useTheme();
  if (!props.files.length) return null;
  const size = (bytes: number) => bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return (
    <View role="list" aria-label="Files to send" style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 6, paddingHorizontal: 6 }}>
      {props.files.map(file => (
        <View key={file.id} role="listitem" style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 4, paddingLeft: 10, paddingRight: 4,
          borderRadius: 10, borderWidth: 1, borderColor: palette.line, backgroundColor: palette.card, maxWidth: 260 }}>
          <Icon name={file.kind === 'image' ? 'palette' : 'attach'} color={palette.muted} size={14} />
          <View style={{ flexShrink: 1, minWidth: 0 }}><Label size={12} oneLine>{file.name}</Label></View>
          <Label size={11} tone="muted">{size(file.size)}</Label>
          {props.onRemove ? <IconButton icon="close" label={`Remove ${file.name}`} onPress={() => props.onRemove?.(file.id)} /> : null}
        </View>
      ))}
    </View>
  );
}
