import test from 'node:test';
import assert from 'node:assert/strict';
import {parseInteractivePrompt,encodeInteractiveAnswer} from '../packages/contracts/prompts.ts';
test('approval retains only offered decisions and exact result',()=>{
 const p=parseInteractivePrompt('approval',{session_id:'live',request_id:'req',choices:['future','once','once','deny'],metadata:{}},'live');
 assert.deepEqual(p.choices,['once','deny']); assert.deepEqual(encodeInteractiveAnswer(p,'once'),{choice:'once',all:false});
 assert.throws(()=>encodeInteractiveAnswer(p,'always'));
 assert.throws(()=>parseInteractivePrompt('approval',{session_id:'other',request_id:'r',choices:['once']},'live'));
 assert.throws(()=>parseInteractivePrompt('unknown',{},'live'));
});
test('clarify single accepts null optional keys and typed Other',()=>{
 const p=parseInteractivePrompt('clarify',{session_id:'live',question:'Pick',questions:null,choices:['A'],multi_select:true,answers:null},'live');
 assert.deepEqual(encodeInteractiveAnswer(p,'Other words'),{answer:'Other words'});
 assert.deepEqual(encodeInteractiveAnswer(p,'["A","Other"]'),{answer:'["A","Other"]'});
 for(const answer of ['', '["A","A"]','["X","Y"]']) assert.throws(()=>encodeInteractiveAnswer(p,answer));
});
test('batch locked answers remain immutable, exact and complete',()=>{
 const p=parseInteractivePrompt('clarify',{session_id:'live',questions:[{qid:'a',question:'A'},{qid:'b',question:'B'}],answers:{a:'fixed'},extra:1},'live');
 assert.ok(Object.isFrozen(p.questions));
 assert.deepEqual({...encodeInteractiveAnswer(p,{a:'fixed',b:'new'}).answers},{a:'fixed',b:'new'});
 for(const answer of [{a:'changed',b:'new'},{b:'new'},{a:'fixed',b:'new',c:'extra'}]) assert.throws(()=>encodeInteractiveAnswer(p,answer));
 assert.throws(()=>parseInteractivePrompt('clarify',{session_id:'live',question:'A',questions:[]},'live'));
 assert.throws(()=>parseInteractivePrompt('clarify',{session_id:'live',questions:[{qid:'a',question:'A'}],answers:{z:'wrong'}},'live'));
});
