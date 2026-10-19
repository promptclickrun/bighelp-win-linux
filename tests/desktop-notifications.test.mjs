import test from 'node:test';
import assert from 'node:assert/strict';
import { NOTIFICATION_DEDUPE_MS, cleanText, createNotificationGate, notificationContent } from '../apps/desktop/src/main/notification-policy.ts';
import { DEFAULT_PREFERENCES } from '../apps/desktop/src/shared/preferences.ts';

const alert = (kind, overrides = {}) => ({ kind, chatId: 'chat-a', agentName: 'Studio Agent', text: 'Run the tests in the build folder?', ...overrides });
const context = (overrides = {}) => ({
  preferences: DEFAULT_PREFERENCES, windowFocused: false, selectedChatId: null, platform: 'win32', now: 1_000_000, ...overrides,
});

test('approvals and questions follow notifyAttention (default on); replies and failures follow notifyReplies (default off)', () => {
  const gate = createNotificationGate();
  assert.equal(gate.decide(alert('approval'), context()).show, true);
  assert.equal(gate.decide(alert('question'), context()).show, true);
  assert.deepEqual(gate.decide(alert('reply'), context()), { show: false, reason: 'off' });
  assert.deepEqual(gate.decide(alert('failed'), context()), { show: false, reason: 'off' });
  const replies = { ...DEFAULT_PREFERENCES, notifyReplies: true, notifyAttention: false };
  assert.equal(gate.decide(alert('reply'), context({ preferences: replies })).show, true);
  assert.equal(gate.decide(alert('failed'), context({ preferences: replies })).show, true);
  assert.deepEqual(gate.decide(alert('approval', { text: 'other' }), context({ preferences: replies })), { show: false, reason: 'off' });
});

test('an alert for the chat on screen in the focused window is skipped; otherwise it shows', () => {
  const gate = createNotificationGate();
  assert.deepEqual(gate.decide(alert('approval'), context({ windowFocused: true, selectedChatId: 'chat-a' })), { show: false, reason: 'onScreen' });
  assert.equal(gate.decide(alert('approval'), context({ windowFocused: true, selectedChatId: 'chat-b' })).show, true);
  assert.equal(gate.decide(alert('question'), context({ windowFocused: false, selectedChatId: 'chat-a' })).show, true);
  assert.equal(gate.decide(alert('approval', { chatId: 'chat-c' }), context({ windowFocused: true, selectedChatId: null })).show, true);
});

test('identical alerts within a few seconds show once', () => {
  const gate = createNotificationGate();
  const now = 5_000_000;
  assert.equal(gate.decide(alert('approval'), context({ now })).show, true);
  assert.deepEqual(gate.decide(alert('approval'), context({ now: now + 1000 })), { show: false, reason: 'duplicate' });
  assert.equal(gate.decide(alert('approval', { text: 'A different request' }), context({ now: now + 1000 })).show, true);
  assert.equal(gate.decide(alert('approval', { chatId: 'chat-b' }), context({ now: now + 1000 })).show, true);
  assert.equal(gate.decide(alert('approval'), context({ now: now + NOTIFICATION_DEDUPE_MS })).show, true);
  // A suppressed alert is not remembered: it can still show once the chat is off screen.
  const second = createNotificationGate();
  assert.equal(second.decide(alert('question'), context({ windowFocused: true, selectedChatId: 'chat-a', now })).show, false);
  assert.equal(second.decide(alert('question'), context({ now: now + 10 })).show, true);
});

test('the dedupe ledger stays bounded', () => {
  const gate = createNotificationGate(60_000);
  for (let index = 0; index < 500; index++) assert.equal(gate.decide(alert('approval', { text: `request ${index}` }), context({ now: 1 + index })).show, true);
  // The oldest entries were dropped, so the very first alert can show again.
  assert.equal(gate.decide(alert('approval', { text: 'request 0' }), context({ now: 600 })).show, true);
  assert.deepEqual(gate.decide(alert('approval', { text: 'request 499' }), context({ now: 600 })), { show: false, reason: 'duplicate' });
});

test('without previews the body is generic and contains no message text', () => {
  assert.deepEqual(notificationContent(alert('approval'), false, 'win32'), { title: 'bighelp', body: 'Studio Agent needs your OK' });
  assert.deepEqual(notificationContent(alert('question'), false, 'win32'), { title: 'bighelp', body: 'Studio Agent has a question' });
  assert.deepEqual(notificationContent(alert('reply'), false, 'win32'), { title: 'bighelp', body: 'Studio Agent replied' });
  assert.deepEqual(notificationContent(alert('failed'), false, 'win32'), { title: 'bighelp', body: 'Studio Agent ran into a problem' });
  assert.deepEqual(notificationContent(alert('reply', { agentName: '  \u202E ' }), false, 'win32'), { title: 'bighelp', body: 'Your agent replied' });
  const decision = createNotificationGate().decide(alert('approval'), context());
  assert.equal(JSON.stringify(decision).includes('Run the tests'), false);
});

test('with previews the body is the cleaned text, at most 200 characters', () => {
  assert.deepEqual(notificationContent(alert('approval'), true, 'win32'), { title: 'Studio Agent needs your OK', body: 'Run the tests in the build folder?' });
  const long = notificationContent(alert('reply', { text: `${'word '.repeat(80)}end` }), true, 'win32');
  assert.ok(Array.from(long.body).length <= 200);
  assert.ok(long.body.endsWith('…'));
  assert.deepEqual(notificationContent(alert('question', { text: ' \n ' }), true, 'win32'), { title: 'Studio Agent has a question', body: 'Open the chat to answer.' });
  assert.equal(notificationContent(alert('approval', { text: '' }), true, 'win32').body, 'Review this request before responding.');
  const preview = { ...DEFAULT_PREFERENCES, notificationPreview: true };
  assert.equal(createNotificationGate().decide(alert('approval'), context({ preferences: preview })).content.body, 'Run the tests in the build folder?');
});

test('host text is inert: controls, direction overrides and Linux markup are neutralised', () => {
  assert.equal(cleanText('a\u0000b\u0007c\u202Ed\u200Be\r\nf', 50), 'a b c d e f');
  assert.equal(cleanText('\ud800 broken', 50), '\uFFFD broken');
  assert.equal(Array.from(cleanText('😀'.repeat(300), 200)).length, 200, 'never splits a surrogate pair');
  const linux = notificationContent(alert('approval', { text: '<a href="https://example.invalid">open</a> & <img src=x>' }), true, 'linux');
  assert.equal(linux.body, '&lt;a href="https://example.invalid"&gt;open&lt;/a&gt; &amp; &lt;img src=x&gt;');
  assert.equal(notificationContent(alert('approval', { agentName: 'A & B' }), false, 'linux').body, 'A &amp; B needs your OK');
  assert.equal(notificationContent(alert('approval', { text: '<b>x</b>' }), true, 'win32').body, '<b>x</b>');
});

test('malformed alerts never reach the OS', () => {
  const gate = createNotificationGate();
  for (const value of [null, {}, alert('shell'), alert('approval', { chatId: 7 }), alert('approval', { text: null })]) {
    assert.deepEqual(gate.decide(value, context()), { show: false, reason: 'invalid' });
  }
});
