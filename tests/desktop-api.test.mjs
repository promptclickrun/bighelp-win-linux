import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDesktopAction } from '../apps/desktop/src/shared/desktop-api.ts';

test('desktop boundary rejects arbitrary routes, methods, secrets reads and unknown fields', () => {
  for (const value of [null, [], {kind:'fetch',url:'https://example.invalid'}, {kind:'snapshot',token:true},
    {kind:'send',generation:1,chatId:'a',text:'hello',method:'shell.exec'}, {kind:'readToken'}]) {
    assert.throws(() => parseDesktopAction(value));
  }
});
test('desktop boundary copies host inputs and preserves exact message text', () => {
  const host = {label:'Test computer',endpoint:'https://example.invalid',authentication:'dashboard',token:'synthetic',allowPrivateHttp:false};
  const result = parseDesktopAction({kind:'connect',host});
  host.token = 'changed';
  assert.equal(result.host.token,'synthetic');
  assert.deepEqual(parseDesktopAction({kind:'send',generation:3,chatId:'chat',text:' hello\n世界 '}),
    {kind:'send',generation:3,chatId:'chat',text:' hello\n世界 '});
});
test('desktop boundary requires generation and bounds user input', () => {
  for (const generation of [-1, NaN, '1', Infinity, 1.2]) assert.throws(() => parseDesktopAction({kind:'openChat',generation,chatId:'a'}));
  for (const text of ['\ud800', 'x'.repeat(262145), 'a\0b']) assert.throws(() => parseDesktopAction({kind:'send',generation:1,chatId:'a',text}));
  // Empty text is allowed at the boundary only for file-only sends; main refuses it otherwise.
  assert.equal(parseDesktopAction({kind:'send',generation:1,chatId:'a',text:' '}).text, ' ');
  assert.equal(parseDesktopAction({kind:'draft',generation:1,chatId:'a',text:''}).text,'');
});
test('desktop prompt answer rejects object gadgets and unbounded answer maps', () => {
  for (const answer of [null, ['yes'], {q:{nested:'yes'}}, {q:'x'.repeat(10001)}]) {
    assert.throws(() => parseDesktopAction({kind:'answer',generation:1,promptId:'p',answer}));
  }
  assert.deepEqual(parseDesktopAction({kind:'answer',generation:1,promptId:'p',answer:{q:'yes'}}).answer,{q:'yes'});
});
test('workspace reads accept only named pages and bounded ranges',()=>{
 const action={kind:'workspace',generation:1,profile:'agent',page:'usage',days:30};
 assert.deepEqual(parseDesktopAction(action),action);
 for(const value of [{...action,page:'native/run'},{...action,days:1000},{...action,url:'/api/secrets'}])assert.throws(()=>parseDesktopAction(value));
});
test('canonical entry and local cancellation are finite and request-bound',()=>{
 const action={kind:'canonicalChat',generation:2,profile:'agent',requestId:'navigation-1'};
 assert.deepEqual(parseDesktopAction(action),action);
 assert.deepEqual(parseDesktopAction({kind:'cancelNavigation',generation:2,requestId:'navigation-1'}),{kind:'cancelNavigation',generation:2,requestId:'navigation-1'});
 for(const value of [{...action,url:'/api/sessions'},{...action,requestId:''},{kind:'cancelNavigation',generation:2,requestId:'x',stop:true},
  {kind:'cancelNavigation',requestId:'x'},{kind:'cancelNavigation',generation:-1,requestId:'x'}])assert.throws(()=>parseDesktopAction(value));
});
