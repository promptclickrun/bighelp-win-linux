import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createChatDisplayRecovery } from '../apps/desktop/src/main/chat-display-recovery.ts';
import { displayCacheKey } from '../packages/platform/display-cache.ts';
const hash=value=>createHash('sha256').update(value).digest('hex');
const host={label:'Synthetic bounded recovery',endpoint:'https://bounded.invalid',authentication:'dashboard',token:'synthetic-bounded-token',allowPrivateHttp:false};
const scope={hostId:hash(host.endpoint),principalId:`dashboard:${hash(host.token)}`};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
async function until(check){for(let n=0;n<100;n++){if(check())return;await tick();}assert.fail('Condition did not settle');}
function fixture(){
 const values=new Map(),writes=[];let held=null,release;
 const repository={async read(key){return structuredClone(values.get(key)??null);},async write(key,revision,value){
  if(held===key){held=null;await new Promise(resolve=>{release=resolve;});}
  assert.equal(values.get(key)?.revision??null,revision);const record={revision:(revision??0)+1,value:structuredClone(value)};values.set(key,record);writes.push({key,value:record.value});return record;
 }};
 const recovery=createChatDisplayRecovery(repository);
 return{values,writes,repository,recovery,hold(key){held=key;},get release(){return release;}};
}
function chat(id='saved',suffix='0',rows=4,textLength=60000){return{id,agentId:'agent',title:`Chat ${id}`,preview:`Latest ${suffix}`,transcript:Array.from({length:rows},(_,i)=>({kind:'message',id:`row-${i}`,direction:'in',paragraphs:[`${suffix}:${i}:`+'x'.repeat(textLength)]}))};}
function view(chats){return{sample:false,host:{label:host.label,state:'connected'},agents:[{id:'agent',name:'Agent',summary:'',color:'#123456'}],chats,workflows:[]};}

test('slow writer coalesces one hundred valid full-history updates into the latest bounded projection',async()=>{
 const f=fixture(),owner=f.recovery.activate(host,scope,()=>true);owner.catalog(view([chat()]));await f.recovery.drain();
 const baseline=f.writes.length;f.hold(displayCacheKey(scope));owner.history(chat('saved','initial'));await until(()=>f.release);
 for(let index=0;index<100;index++)owner.history(chat('saved',`latest-${index}`));
 assert.ok(Buffer.byteLength(JSON.stringify(owner.data))<1024*1024);f.release();await f.recovery.drain();
 assert.equal(f.writes.length-baseline,2,'one admitted cache write plus one coalesced latest write');
 const persisted=f.values.get(displayCacheKey(scope)).value.data;assert.equal(persisted.sessions[0].preview,'Latest latest-99');assert.deepEqual(persisted,owner.data);
});

test('retained projection applies aggregate byte and row bounds before any storage completion',async()=>{
 const f=fixture(),owner=f.recovery.activate(host,scope,()=>true);
 const chats=Array.from({length:8},(_,i)=>chat(`saved-${i}`,`${i}`,512,3000));owner.catalog(view(chats));
 for(const item of chats)owner.history(item);
 const state=owner.data;assert.ok(Buffer.byteLength(JSON.stringify(state))<1024*1024);assert.ok(state.sessions.reduce((n,row)=>n+row.transcript.length,0)<=4096);assert.ok(state.sessions.every(row=>row.transcript.length<=512));
 await f.recovery.drain();assert.deepEqual(f.values.get(displayCacheKey(scope)).value.data,state);
});

test('rotating catalogs prune removed histories instead of retaining or resurrecting them',async()=>{
 const f=fixture(),owner=f.recovery.activate(host,scope,()=>true);
 for(let index=0;index<100;index++){
  const item=chat(`saved-${index}`,`${index}`);owner.catalog(view([item]));owner.history(item);await f.recovery.drain();
  assert.equal(owner.data.sessions.length,1);assert.ok(Buffer.byteLength(JSON.stringify(owner.data))<1024*1024);
 }
 owner.catalog(view([chat('saved-0')]));assert.deepEqual(owner.data.sessions[0].transcript,[],'a removed history is no longer retained in a hidden map');await f.recovery.drain();
 assert.deepEqual(f.values.get(displayCacheKey(scope)).value.data.sessions[0].transcript,[]);
});

test('held writes retain only the current scope and retire old pending projections and handles',async()=>{
 const f=fixture();let generation=0;const old=[];
 const first=f.recovery.activate(host,scope,()=>generation===0);first.catalog(view([chat()]));await f.recovery.drain();f.hold(displayCacheKey(scope));first.history(chat());await until(()=>f.release);
 const baseline=f.writes.length;let latest;
 for(let index=1;index<=100;index++){
  generation=index;const nextScope={...scope,hostId:hash(`synthetic-host-${index}`)};
  const owner=f.recovery.activate({...host,endpoint:`https://bounded-${index}.invalid`},nextScope,()=>generation===index);
  owner.catalog(view([chat(`scope-${index}`)]));owner.history(chat(`scope-${index}`));old.push(owner);latest={owner,scope:nextScope};
 }
 for(const owner of [first,...old.slice(0,-1)]){owner.history(chat('must-not-survive'));assert.equal(owner.data.sessions.length,0,'retired handles release their projection');}
 f.release();await f.recovery.drain();assert.equal(f.writes.filter(row=>row.key.startsWith('display-cache:')).length,3,'initial, admitted old, latest scope only');
 assert.equal(f.writes.length-baseline,3,'admitted old cache plus latest owner/cache writes');assert.ok(f.values.has(displayCacheKey(latest.scope)));assert.equal(latest.owner.data.sessions[0].storedSessionId,'scope-100');
});

test('latest authoritative projection survives a delayed cache read without resurrecting removed sessions',async()=>{
 const f=fixture(),seed=f.recovery.activate(host,scope,()=>true);seed.catalog(view([chat('removed')]));seed.history(chat('removed','old'));await f.recovery.drain();
 const read=f.repository.read;let release;f.repository.read=key=>key===displayCacheKey(scope)?new Promise(resolve=>{release=()=>resolve(structuredClone(f.values.get(key)));}):read(key);
 const owner=f.recovery.activate(host,scope,()=>true);owner.catalog(view([chat('removed')]));await until(()=>release);
 owner.catalog(view([chat('current')]));owner.history(chat('current','new'));f.repository.read=read;release();await f.recovery.drain();
 assert.equal(owner.data.sessions.length,1);assert.equal(owner.data.sessions[0].storedSessionId,'current');assert.equal(owner.data.sessions[0].preview,'Latest new');assert.deepEqual(f.values.get(displayCacheKey(scope)).value.data,owner.data);
 owner.catalog(view([chat('removed')]));assert.equal(owner.data.sessions[0].transcript.length,0);await f.recovery.drain();
});

test('coalesced stale-CAS failure stops its writer without retrying over an external winner',async()=>{
 const f=fixture(),owner=f.recovery.activate(host,scope,()=>true);owner.catalog(view([chat()]));await f.recovery.drain();
 const key=displayCacheKey(scope),write=f.repository.write;let release,attempts=0;
 f.repository.write=async(k,revision,value)=>{if(k===key){attempts++;await new Promise(resolve=>{release=resolve;});throw Error('Synthetic stale CAS');}return write(k,revision,value);};
 owner.history(chat('saved','admitted'));await until(()=>release);for(let index=0;index<100;index++)owner.history(chat('saved',`pending-${index}`));
 const winner={...f.values.get(key),revision:99};f.values.set(key,winner);release();await f.recovery.drain();assert.equal(attempts,1);assert.deepEqual(f.values.get(key),winner);
 owner.history(chat('saved','local-after-failure'));await f.recovery.drain();assert.equal(attempts,1);assert.equal(owner.data.sessions[0].preview,'Latest local-after-failure');
});

test('invalid history input never enters retained state or throws into live consumers',async()=>{
 const f=fixture(),owner=f.recovery.activate(host,scope,()=>true);owner.catalog(view([chat()]));owner.history(chat('saved','valid'));await f.recovery.drain();const previous=owner.data;
 const invalid=chat('saved','unsafe');invalid.transcript[0].delivery='unknown';assert.doesNotThrow(()=>owner.history(invalid));assert.equal(owner.data,previous);
 owner.catalog({...view([chat()]),chats:Array.from({length:257},(_,index)=>chat(`too-many-${index}`))});assert.equal(owner.data,previous);await f.recovery.drain();assert.deepEqual(f.values.get(displayCacheKey(scope)).value.data,previous);
});
