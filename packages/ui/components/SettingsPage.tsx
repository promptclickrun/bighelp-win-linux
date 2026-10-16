// One open Settings page. Kept apart from the overview (Settings.tsx), which the
// context list imports, so only this page brings in host access.
import type { JSX, ReactNode } from 'react';
import { useState } from 'react';
import { ScrollView, View } from 'react-native-web';
import type { Appearance, SettingsSection } from '../../domain/shell.ts';
import { DEFAULT_PREFERENCES } from '../../../apps/desktop/src/shared/preferences.ts';
import type { Preferences } from '../../../apps/desktop/src/shared/preferences.ts';
import type { ShellInfo } from '../../../apps/desktop/src/shared/shell-info.ts';
import { HostProvider } from '../host.tsx';
import type { HostValue } from '../host.tsx';
import type { HostView } from '../view-model.ts';
import { Notice, PageHead } from './primitives.tsx';
import { SECTION_INFO } from './Settings.tsx';
import { HermesToolsPage, SystemPage } from './SettingsNerd.tsx';
import { AppearancePage, AssistantsPage, ChatPage, HelpPage, NotificationsPage, PermissionsPage, YouPage } from './SettingsPages.tsx';

// desktop is the connected app's finite API and current snapshot; the sample
// preview has none, so its choices live in memory and host parts say so.
export function SettingsPage(props: Readonly<{ section: SettingsSection; appearance: Appearance; host: HostView | null;
  hostContent?: ReactNode; onAppearance: (value: Appearance) => void; onBack: () => void;
  desktop?: HostValue | undefined; shell?: ShellInfo | undefined }>): JSX.Element {
  const [preview, setPreview] = useState<Preferences>(DEFAULT_PREFERENCES);
  const desktop = props.desktop;
  const preferences = desktop?.snapshot.preferences ?? preview;
  const agents = desktop?.snapshot.data.agents ?? [];
  // Main validates and stores each change; a refused change shows the app's error line.
  const change = (changes: Partial<Preferences>): Promise<boolean> => {
    if (desktop) return desktop.act(desktop.api.preferences(changes));
    setPreview(current => Object.freeze({ ...current, ...changes }));
    return Promise.resolve(true);
  };
  const title = SECTION_INFO[props.section][1];
  let body: JSX.Element;
  switch (props.section) {
    case 'you': body = <YouPage preferences={preferences} onChange={change} />; break;
    case 'assistants': body = <AssistantsPage agents={agents} />; break;
    case 'appearance':
      body = <AppearancePage value={props.appearance} onChange={props.onAppearance} preferences={preferences} onPreferences={change} />;
      break;
    case 'chat': body = <ChatPage preferences={preferences} onChange={change} />; break;
    case 'notifications': body = <NotificationsPage preferences={preferences} onChange={change} />; break;
    case 'permissions': body = <PermissionsPage agents={agents} />; break;
    case 'help': body = <HelpPage shell={props.shell} />; break;
    case 'system': body = <SystemPage />; break;
    case 'hermesTools': body = <HermesToolsPage agents={agents} />; break;
    case 'hosts':
      body = props.hostContent ? <>{props.hostContent}</> : <Notice title={props.host ? props.host.label : 'No computer connected'}
        body={props.host ? 'This is sample data, not a real computer.' : 'Adding a computer comes with sign-in, the next build step.'} />;
      break;
  }
  return (
    <HostProvider value={desktop ?? null}>
      <View style={{ flex: 1, minWidth: 0 }}>
        <PageHead title={title} onBack={props.onBack} backLabel="Back to Settings" />
        <ScrollView style={{ flex: 1 }}>{body}</ScrollView>
      </View>
    </HostProvider>
  );
}
