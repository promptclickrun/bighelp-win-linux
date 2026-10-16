import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
const result = await build({ stdin: { contents: `
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { HostConnection } from './packages/ui/components/HostConnection.tsx';
import { Composer } from './packages/ui/components/Conversation.tsx';
import { InteractiveRequests } from './packages/ui/components/InteractiveRequests.tsx';
import { ThemeProvider } from './packages/ui/theme.tsx';
import { PALETTES } from './packages/ui/tokens.ts';
export function render(component, props) { return renderToStaticMarkup(<ThemeProvider value={{theme:'light',palette:PALETTES.light,font:'sans-serif'}}>{React.createElement(component === 'host' ? HostConnection : component === 'composer' ? Composer : InteractiveRequests, props)}</ThemeProvider>); }
`, resolveDir: process.cwd(), loader: 'tsx' }, jsx: 'automatic', bundle: true, platform: 'node', format: 'cjs', packages: 'external', write: false });
const compiled = { exports: {} };
new Function('require', 'module', 'exports', result.outputFiles[0].text)(createRequire(import.meta.url), compiled, compiled.exports);
const { render } = compiled.exports;
const snapshot = { generation: 1, status: 'disconnected', storageAvailable: false, notice: 'Offline', prompts: [] };
test('host form uses a write-only password field and blocks connection without protected storage', () => {
  const html = render('host', { snapshot, error: '', onConnect() {}, onDisconnect() {}, onRefresh() {} });
  assert.match(html, /type="password"/);
  assert.match(html, /Protected storage is unavailable/);
  assert.match(html, /<button disabled="" type="submit">Connect/);
  assert.doesNotMatch(html, /localStorage|sessionStorage/);
});
test('approval renders only offered decisions and escapes executable-looking host text', () => {
  const html = render('requests', { disabled: false, onAnswer() {}, prompts: [{id: '1', prompt: {kind:'approval', choices:['once','deny'], command:'<script>bad()</script>'}}] });
  assert.match(html, /Allow once/); assert.match(html, /Deny/);
  assert.doesNotMatch(html, /Always allow|Allow this session|<script>/);
  assert.match(html, /&lt;script&gt;/);
});
test('clarification retains locked answers and requires an explicit answer submission', () => {
  const html = render('requests', { disabled: false, onAnswer() {}, prompts: [{id:'2',prompt:{kind:'clarify',isBatch:true,questions:[{id:'a',question:'Locked',choices:[],multiSelect:false,lockedAnswer:'Already answered'},{id:'b',question:'Choose',choices:['One','Two'],multiSelect:false}]}}] });
  assert.match(html, /Already answered/); assert.match(html, /type="radio"/);
  assert.match(html, /<button type="submit" disabled="">Send answer/);
});

test('offline composer preserves the saved draft while rendering the input read-only', () => {
  const props = { agentName: 'Synthetic agent', draft: 'Protected saved draft', hint: 'Saved chats are read-only while offline.', canSend: false, editable: false, onDraft() {} };
  const offline = render('composer', props);
  assert.match(offline, /readOnly=""/); assert.match(offline, /Protected saved draft/);
  assert.match(offline, /aria-disabled="true"[^>]*aria-label="Send/);
  assert.doesNotMatch(render('composer', { ...props, editable: true }), /readOnly=""/);
});
