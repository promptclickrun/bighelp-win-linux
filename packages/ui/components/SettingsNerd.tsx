// Nerd Mode Settings pages: read-only technical facts about the connected
// computer. No secrets, addresses or tokens; no install, enable or restart actions.
import type { JSX } from 'react';
import { useState } from 'react';
import { View } from 'react-native-web';
import type { AgentView } from '../view-model.ts';
import { useHost, useQuery } from '../host.tsx';
import { Button, Card, PageBody, Row, TextField } from './controls.tsx';
import { Label, Tag } from './primitives.tsx';
import { AgentField, Lines, Note, Offline, QueryProblem, useAgentChoice, useConnection } from './SettingsPages.tsx';

const yesNo = (value: boolean | null, yes: string, no: string) => value === null ? 'Unknown' : value ? yes : no;

export function SystemPage(): JSX.Element {
  const host = useHost();
  const { preview, connected, hostLabel } = useConnection();
  const about = useQuery('host.about', connected ? {} : null);
  const info = about.value;
  const snapshot = host?.snapshot;
  return (
    <PageBody>
      <Card title="Connection">
        <Lines>
          <Row title="Status" detail={snapshot ? { connected: 'Connected', connecting: 'Connecting', disconnected: 'Not connected' }[snapshot.status] : 'Sample preview'} />
          <Row title="Computer" detail={connected ? hostLabel : 'None'} />
          <Row title="Connection lease" detail={snapshot ? `Lease ${snapshot.connection} · selection ${snapshot.generation}` : 'None'} selectable />
          <Row title="Secure storage" detail={snapshot ? (snapshot.storageAvailable ? 'Available' : 'Unavailable') : 'Unknown'} />
        </Lines>
      </Card>
      {!connected ? <Offline preview={preview} what="Hermes details" /> : <>
        <QueryProblem query={about} what="these details" />
        {info ? <>
          <Card title="Hermes">
            <Lines>
              <Row title="Version" detail={info.version ?? 'Unknown'} selectable />
              <Row title="Release date" detail={info.releaseDate ?? 'Unknown'} selectable />
              <Row title="Messaging gateway" detail={yesNo(info.gatewayRunning, 'Running', 'Stopped')} />
              <Row title="Active sessions" detail={info.activeSessions === null ? 'Unknown' : String(info.activeSessions)} />
            </Lines>
          </Card>
          <Card title="bighelp plugin">
            <Lines>
              <Row title="Version" detail={info.plugin.installed ? (info.plugin.version ?? 'Unknown') : 'Not installed'} selectable />
              {info.plugin.installed ? <View style={{ padding: 14, gap: 8 }}>
                <Label weight="600">{`Features (${info.plugin.features.length})`}</Label>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                  {info.plugin.features.map(feature => <Tag key={feature}>{feature}</Tag>)}
                </View>
              </View> : null}
            </Lines>
          </Card>
        </> : about.status === 'loading' ? <Label tone="muted">Loading…</Label> : null}
        <View style={{ flexDirection: 'row' }}><Button label="Reload" icon="refresh" compact onPress={about.reload} /></View>
      </>}
      <Note>Read-only. Update and restart Hermes on that computer.</Note>
    </PageBody>
  );
}

export function HermesToolsPage(props: Readonly<{ agents: readonly AgentView[] }>): JSX.Element {
  const { preview, connected, hostLabel } = useConnection();
  const [profile, setProfile] = useAgentChoice(props.agents);
  const [search, setSearch] = useState('');
  const input = connected && profile ? { profile } : null;
  const toolsets = useQuery('settings.toolsets', input);
  const skills = useQuery('settings.skills', input);
  const words = search.trim().toLowerCase();
  const matches = (...texts: readonly string[]) => !words || texts.some(text => text.toLowerCase().includes(words));
  const sets = (toolsets.value?.toolsets ?? []).filter(set => matches(set.name, set.label, set.description, ...set.tools));
  const found = (skills.value?.skills ?? []).filter(skill => matches(skill.name, skill.description, skill.category));
  return (
    <PageBody>
      {!connected ? <Offline preview={preview} what="its tools" /> : <>
        <AgentField agents={props.agents} value={profile} onChange={setProfile} />
        <TextField label="Find a tool" type="search" value={search} onChange={setSearch} maxLength={200} />
        <Card title={toolsets.value ? `Toolsets (${sets.length})` : 'Toolsets'}
          detail="Groups of tools an agent can call. Changes apply to new chats.">
          {toolsets.value ? <Lines>
            {sets.length ? sets.map(set => (
              <Row key={set.name} title={set.label} detail={[set.description, set.tools.join(', ')].filter(Boolean).join(' — ')} selectable>
                <Tag>{set.enabled ? (set.available ? 'On' : 'Needs setup') : 'Off'}</Tag>
              </Row>)) : <Row title="Nothing matches" />}
          </Lines> : <View style={{ padding: 14 }}>
            {toolsets.status === 'failed' ? <QueryProblem query={toolsets} what="its toolsets" /> : <Label tone="muted">Loading…</Label>}
          </View>}
        </Card>
        <Card title={skills.value ? `Skills (${found.length})` : 'Skills'} detail="Skills that are turned on. Agents read them when a task needs one.">
          {skills.value ? <Lines>
            {found.length ? found.map(skill => (
              <Row key={skill.name} title={skill.name} selectable
                detail={[skill.category, skill.description].filter(Boolean).join(' · ')} />)) : <Row title="Nothing matches" />}
          </Lines> : <View style={{ padding: 14 }}>
            {skills.status === 'failed' ? <QueryProblem query={skills} what="its skills" /> : <Label tone="muted">Loading…</Label>}
          </View>}
        </Card>
      </>}
      <Note>{`Read-only. Turn tools and skills on or off in Hermes on ${hostLabel}.`}</Note>
    </PageBody>
  );
}
