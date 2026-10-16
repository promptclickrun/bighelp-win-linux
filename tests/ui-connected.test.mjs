import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
const result = await build({ stdin: { contents: `
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { HostConnection } from './packages/ui/components/HostConnection.tsx';
import { Composer, Conversation } from './packages/ui/components/Conversation.tsx';
import { WorkspaceFunctionPage } from './packages/ui/components/WorkspaceFunctionPage.tsx';
import { InteractiveRequests } from './packages/ui/components/InteractiveRequests.tsx';
import { ThemeProvider } from './packages/ui/theme.tsx';
import { PALETTES } from './packages/ui/tokens.ts';
export function render(component, props) { return renderToStaticMarkup(<ThemeProvider value={{theme:'light',palette:PALETTES.light,font:'sans-serif'}}>{React.createElement(component === 'host' ? HostConnection : component === 'composer' ? Composer : component === 'conversation' ? Conversation : component === 'workspace' ? WorkspaceFunctionPage : InteractiveRequests, props)}</ThemeProvider>); }
`, resolveDir: process.cwd(), loader: 'tsx' }, jsx: 'automatic', bundle: true, platform: 'node', format: 'cjs', packages: 'external', write: false });
const compiled = { exports: {} };
new Function('require', 'module', 'exports', result.outputFiles[0].text)(createRequire(import.meta.url), compiled, compiled.exports);
const { render } = compiled.exports;
const snapshot = { generation: 1, status: 'disconnected', storageAvailable: false, notice: 'Offline', prompts: [] };
const api = new Proxy({}, { get: () => () => Promise.resolve({ ok: false, message: 'unused' }) });
const idle = { state: 'idle', delaySeconds: 0 };
const hosts = (extra) => ({ saved: null, reconnect: idle, setup: null, storageIssue: null, ...extra });
test('host address step blocks connection without protected storage and gives Linux keyring steps', () => {
  const html = render('host', { api, platform: 'linux', snapshot: { ...snapshot, hosts: hosts({ storageIssue: 'keyringMissing' }) } });
  assert.match(html, /No keyring found/); assert.match(html, /GNOME Keyring or KWallet/); assert.match(html, /--password-store=gnome-libsecret/);
  assert.match(html, /Where is Hermes running\?/); assert.match(html, /value="9119"/);
  assert.match(html, /aria-disabled="true"[^>]*aria-label="Connect"|aria-label="Connect"[^>]*aria-disabled="true"/);
  assert.doesNotMatch(html, /localStorage|sessionStorage/);
  const locked = render('host', { api, platform: 'linux', snapshot: { ...snapshot, hosts: hosts({ storageIssue: 'keyringLocked' }) } });
  assert.match(locked, /Your keyring is locked/);
  assert.match(render('host', { api, platform: 'win32', snapshot }), /Secure storage isn&#x27;t available/);
});
test('sign-in step offers username and password with write-only fields and a token fallback', () => {
  const setup = { probeId: '00000000-0000-4000-8000-000000000000', thisComputer: false, plainHttp: true, version: '0.22.1', signInRequired: true,
    methods: ['password', 'token'], providers: [{ id: 'basic', name: 'Username & Password' }], replacing: false };
  const html = render('host', { api, platform: 'linux', snapshot: { ...snapshot, storageAvailable: true, hosts: hosts({ setup }) } });
  assert.match(html, /Hermes 0\.22\.1/); assert.match(html, /Not encrypted/);
  assert.match(html, /Username/); assert.match(html, /type="password"/); assert.match(html, /Use a token instead/);
  assert.doesNotMatch(html, /value="[^"]+"[^>]*type="password"|type="password"[^>]*value="[^"]+"/);
  const browserOnly = render('host', { api, platform: 'linux', snapshot: { ...snapshot, storageAvailable: true, hosts: hosts({ setup: { ...setup, methods: ['token'], providers: [] } }) } });
  assert.match(browserOnly, /signs in through a browser/); assert.match(browserOnly, /Access token/);
});
test('saved computer shows plain-word status, offline retry and management without any address', () => {
  const saved = { label: 'Studio PC', thisComputer: false, signIn: 'password', account: 'alice', plainHttp: false, version: '0.22.1' };
  const waiting = render('host', { api, platform: 'linux', snapshot: { ...snapshot, storageAvailable: true, hosts: hosts({ saved, reconnect: { state: 'waiting', delaySeconds: 30 } }) } });
  assert.match(waiting, /Offline — trying again in 30 s/); assert.match(waiting, /Try now/); assert.match(waiting, /Signed in as alice/);
  assert.match(waiting, /Hermes 0\.22\.1/); assert.match(waiting, /Forget/); assert.match(waiting, /Rename/);
  const connected = render('host', { api, platform: 'linux', snapshot: { ...snapshot, status: 'connected', storageAvailable: true, hosts: hosts({ saved }) } });
  assert.match(connected, /Connected to Studio PC/); assert.match(connected, /Disconnect/); assert.doesNotMatch(connected, /Try now/);
  const signIn = render('host', { api, platform: 'linux', snapshot: { ...snapshot, storageAvailable: true, hosts: hosts({ saved, reconnect: { state: 'signIn', delaySeconds: 0 } }) } });
  assert.match(signIn, /Sign in again/);
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
  assert.match(html, /<button type="submit" disabled=""[^>]*>Send answer/);
});

test('offline composer preserves the saved draft while rendering the input read-only', () => {
  const props = { agentName: 'Synthetic agent', draft: 'Protected saved draft', hint: 'Saved chats are read-only while offline.', canSend: false, editable: false, onDraft() {} };
  const offline = render('composer', props);
  assert.match(offline, /readOnly=""/); assert.match(offline, /Protected saved draft/);
  assert.match(offline, /aria-disabled="true"[^>]*aria-label="Send/);
  assert.doesNotMatch(render('composer', { ...props, editable: true }), /readOnly=""/);
});


test('workspace agent names are escaped in real React markup and offline pages claim no saved workspace copies', () => {
  const html = render('workspace', {page:'projects', snapshot, narrow:false, panes:{list:true,detail:true}, onOpenDetail(){},
    data:{sample:false,host:{label:'Synthetic',state:'offline'},chats:[],workflows:[],agents:[{id:'one',name:'<script>bad()</script>',summary:'',color:'blue'}]}});
  assert.match(html, /&lt;script&gt;bad\(\)&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<script>|saved on this device|agent tabs/i);
  assert.match(html, /aria-label="Agent"/);
  assert.match(html, /aria-label="Refresh projects"/);
  assert.match(html, /This page is unavailable/);
});

for(const tab of ['feed','ideas','goals','files'])test(`real Conversation markup keeps the ${tab} composer hidden and inert with one bottom tab strip`,()=>{
 const html=render('conversation',{agent:{id:'one',name:'Synthetic',color:'blue'},chat:null,host:null,tab,draft:'Protected native draft',hint:'Ready',sample:false,onDraft(){},onTab(){},board:'Inert board body'});
 assert.match(html, /<div hidden="" inert="" aria-hidden="true" style="display:none">/);
 assert.match(html, /Protected native draft/);assert.equal((html.match(/role="tablist"/g)??[]).length,1);
 assert.ok(html.indexOf('Protected native draft')<html.indexOf('role="tablist"'));
 if(tab==='files')assert.match(html,/Files on your computer appear here/);else assert.match(html,/Inert board body/);
});
