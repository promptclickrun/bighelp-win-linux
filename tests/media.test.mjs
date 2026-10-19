import test from 'node:test';
import assert from 'node:assert/strict';
import { extractMedia, mediaPath, mediaRef } from '../packages/domain/media.ts';
import { decodeRpcHistory } from '../packages/contracts/history.ts';
import { EMPTY_LIVE, reduceLive } from '../packages/domain/live-turn.ts';
import { CHAT_CALLS } from '../apps/desktop/src/shared/calls/chat.ts';

test('only whole MEDIA lines with safe absolute paths become tiles', () => {
  const recorded = [];
  const result = extractMedia('Here you go:\nMEDIA:/home/a/.hermes/images/cat.png\nMEDIA:/home/a/report.pdf\nInline MEDIA:/x.png stays\nMEDIA:relative.png\nMEDIA:/a/../etc/passwd.png',
    path => { recorded.push(path); return mediaRef(path); });
  assert.equal(result.text, 'Here you go:\nInline MEDIA:/x.png stays\nMEDIA:relative.png\nMEDIA:/a/../etc/passwd.png');
  assert.deepEqual(result.media.map(item => [item.name, item.kind]), [['cat.png', 'image'], ['report.pdf', 'file']]);
  assert.deepEqual(recorded, ['/home/a/.hermes/images/cat.png', '/home/a/report.pdf']);
  assert.equal(JSON.stringify(result.media).includes('/home'), false, 'no host path in display data');
  for (const bad of ['', '/x//y.png', '/x/y.exe', '/x/\u202ey.png', 'C:/x.png'.replace('C:', 'relative')]) assert.equal(mediaPath(bad), null, bad);
  assert.equal(mediaPath('C:\\Users\\a\\pic.jpg')?.kind, 'image');
  assert.match(mediaRef('/a.png'), /^media-[0-9a-f]{8}-[0-9a-f]+$/u);
});

test('history and finished live replies carry media tiles; streaming text keeps the line until sealed', () => {
  const items = decodeRpcHistory({ count: 2, messages: [{ role: 'user', text: 'draw', row_id: 1 }, { role: 'assistant', text: 'MEDIA:/h/images/a.png', row_id: 2 }] });
  assert.deepEqual(items.at(-1).media.map(item => item.name), ['a.png']);
  assert.equal(items.at(-1).paragraphs[0], '');
  let live = reduceLive(EMPTY_LIVE, 'message.start', {}, 1);
  live = reduceLive(live, 'message.delta', { text: 'Done\nMEDIA:/h/images/b.png' }, 2);
  assert.equal(live.items[0].media, undefined);
  live = reduceLive(live, 'message.complete', { text: 'Done\nMEDIA:/h/images/b.png', status: 'complete' }, 3);
  assert.equal(live.items[0].paragraphs[0], 'Done');
  assert.deepEqual(live.items[0].media.map(item => item.kind), ['image']);
});

test('the preview call accepts only opaque references', () => {
  assert.throws(() => CHAT_CALLS['chat.media'].parse({ chatId: 'a', ref: '/etc/passwd' }));
  assert.throws(() => CHAT_CALLS['chat.media'].parse({ chatId: 'a', ref: 'media-zz' }));
  assert.deepEqual(CHAT_CALLS['chat.media'].parse({ chatId: 'a', ref: mediaRef('/x.png') }), { chatId: 'a', ref: mediaRef('/x.png') });
});
