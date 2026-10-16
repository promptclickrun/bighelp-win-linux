import test from 'node:test';
import assert from 'node:assert/strict';
import {createCanonicalChatClient} from '../packages/hermes-client/canonical-chat.ts';
import {GatewayOperationError} from '../packages/hermes-client/gateway.ts';
import {encodeSessionOperation} from '../packages/contracts/session.ts';
import {decodeCanonicalList,decodeCanonicalProfiles,decodeCanonicalState} from '../packages/contracts/canonical-chat.ts';

const owner={hostId:'host',principalId:'principal',profileId:'agent',authGeneration:1,connectionGeneration:2};
const receipt=(id='tip')=>({session_id:`runtime:${id}`,stored_session_id:id,info:{profile_name:'agent'},running:false,open_requests:[]});
function setup(operation,state=null,sessionDetail) {
 let current=owner,saved=state;const calls=[];
 const adapters={owner,currentOwner:()=>current,readState:async()=>saved,sessionDetail,
  saveState:async value=>{saved=structuredClone(value);calls.push(['save',value.phase]);},
  operation:async op=>{calls.push(['rpc',op.kind,op]);return operation(op);}};
 return {client:createCanonicalChatClient(adapters),calls,get state(){return saved;},retire(){current=null;},retry(){return createCanonicalChatClient(adapters).resolve();}};
}
test('canonical operations have source-backed exact hidden/title shapes; ordinary creation stays separate',()=>{
 const params=kind=>JSON.parse(encodeSessionOperation('id',{kind,profile:'agent',runtimeId:'live'})).params;
 assert.deepEqual(params('canonicalSessionList'),{profile:'agent',title:'Bot Chat',include_hidden:true,limit:200});
 assert.deepEqual(params('canonicalSessionCreate'),{profile:'agent',source:'bighelp',close_on_disconnect:false,title:'Bot Chat',hidden:true,follow_profile_config:true});
 assert.deepEqual(params('canonicalSessionTitle'),{session_id:'live',title:'Bot Chat'});
 assert.deepEqual(params('sessionCreate'),{profile:'agent',source:'bighelp',close_on_disconnect:false});
});
test('profile registry root wins over latest and compaction tip is supplied by exact resume',async()=>{
 const f=setup(op=>op.kind==='profilesList'?{profiles:[{name:'agent',last_session:{id:'latest'},canonical_session:{id:'hidden-root',resolved_id:'tip',title:'Child title'}}]}:receipt());
 const resolved=await f.client.resolve();assert.equal(resolved.root,'hidden-root');assert.equal(resolved.receipt.storedSessionId,'tip');
 assert.deepEqual(f.calls.filter(c=>c[0]==='rpc').map(c=>c[1]),['profilesList','sessionResume']);
 assert.equal(f.calls.at(-1)[2].storedSessionId,'hidden-root');
});
test('missing profile projection uses exact-title hidden registry without ordinary session selection',async()=>{
 const f=setup(op=>op.kind==='profilesList'?{profiles:[{name:'agent'}]}:op.kind==='canonicalSessionList'?{sessions:[{id:'root',resolved_id:'tip',title:'Bot Chat',hidden:true}]}:receipt());
 assert.equal((await f.client.resolve()).root,'root');
 assert.equal(f.calls.some(c=>c[1]==='sessionCreate'),false);
});
test('duplicate/malformed rows, missing profile, unsupported title lookup and failed resume never create fallback',async()=>{
 for(const kind of ['duplicate','wrong-title','missing-profile','unsupported','resume']) {
  const f=setup(op=>{
   if(op.kind==='profilesList')return{profiles:kind==='missing-profile'?[]:[{name:'agent'}]};
   if(op.kind==='canonicalSessionList'){
    if(kind==='unsupported')throw new GatewayOperationError(-32601);
    return {sessions:kind==='duplicate'?[{id:'a',title:'Bot Chat'},{id:'b',title:'Bot Chat'}]:[{id:'root',title:kind==='wrong-title'?'Other':'Bot Chat'}]};
   }
   throw new GatewayOperationError(4007);
  });
  await assert.rejects(f.client.resolve());assert.equal(f.calls.some(c=>c[1]==='canonicalSessionCreate'||c[1]==='sessionCreate'),false);
 }
});
test('known missing canonical identity fails closed across retry',async()=>{
 const f=setup(op=>op.kind==='profilesList'?{profiles:[{name:'agent'}]}:{sessions:[]},{version:1,root:'known',phase:'complete',createdStoredId:null});
 await assert.rejects(f.client.resolve(),/canonical-missing/);await assert.rejects(f.retry(),/canonical-missing/);
 assert.equal(f.calls.some(c=>c[1]==='canonicalSessionCreate'),false);
});
test('first canonical creation persists each mutation barrier and verifies registry before publication',async()=>{
 let lists=0;
 const f=setup(op=>{
  if(op.kind==='profilesList')return{profiles:[{name:'agent'}]};
  if(op.kind==='canonicalSessionList')return{sessions:++lists<=2?[]:[{id:'created',resolved_id:'created',title:'Bot Chat'}]};
  if(op.kind==='canonicalSessionCreate')return{...receipt('created'),message_count:0,messages:[]};
  if(op.kind==='canonicalSessionTitle')return{pending:false,title:'Bot Chat'};
  return receipt('created');
 });
 assert.equal((await f.client.resolve()).receipt.storedSessionId,'created');
 assert.deepEqual(f.calls.map(c=>c[1]),['profilesList','canonicalSessionList','canonicalSessionList','createRequested','canonicalSessionCreate','created','titleRequested','canonicalSessionTitle','awaitingRegistry','canonicalSessionList','complete','sessionResume']);
});
test('a canonical registered between discovery and creation is resumed without minting an empty duplicate',async()=>{
 let lists=0;
 const f=setup(op=>{
  if(op.kind==='profilesList')return{profiles:[{name:'agent'}]};
  if(op.kind==='canonicalSessionList')return{sessions:++lists===1?[]:[{id:'concurrent-winner',title:'Bot Chat'}]};
  assert.equal(op.kind,'sessionResume');assert.equal(op.storedSessionId,'concurrent-winner');return receipt('concurrent-winner');
 });
 assert.equal((await f.client.resolve()).root,'concurrent-winner');
 assert.equal(f.calls.some(c=>c[1]==='canonicalSessionCreate'),false);
});
test('uncertain create/title is never replayed after reconstruction; safe discovery can settle it',async()=>{
 for(const failed of ['canonicalSessionCreate','canonicalSessionTitle']) {
  let discovered=false;
  const f=setup(op=>{
   if(op.kind==='profilesList')return{profiles:[{name:'agent'}]};
   if(op.kind==='canonicalSessionList')return{sessions:discovered?[{id:'created',title:'Bot Chat'}]:[]};
   if(op.kind===failed)throw Error('outcome-unknown');
   return {...receipt('created'),message_count:0,messages:[]};
  });
  await assert.rejects(f.client.resolve());await assert.rejects(f.retry(),/creation-unconfirmed/);
  assert.equal(f.calls.filter(c=>c[1]===failed).length,1);
  discovered=true;assert.equal((await f.retry()).root,'created');
 }
});
test('title conflict resolves the exact registry winner without another create or unrelated chat',async()=>{
 let lists=0;
 const f=setup(op=>{
  if(op.kind==='profilesList')return{profiles:[{name:'agent'}]};
  if(op.kind==='canonicalSessionList')return{sessions:++lists<=2?[]:[{id:'winner',title:'Bot Chat'}]};
  if(op.kind==='canonicalSessionTitle')throw new GatewayOperationError(4022);
  return {...receipt(op.kind==='canonicalSessionCreate'?'ours':'winner'),message_count:0,messages:[]};
 });
 assert.equal((await f.client.resolve()).root,'winner');assert.equal(f.calls.filter(c=>c[1]==='canonicalSessionCreate').length,1);
});
test('stale discovery cannot resume/create/persist a new identity',async()=>{
 let finish;const f=setup(()=>new Promise(resolve=>{finish=resolve;}));
 const pending=f.client.resolve();while(!finish)await new Promise(resolve=>setImmediate(resolve));
 f.retire();finish({profiles:[{name:'agent',canonical_session:{id:'old'}}]});
 await assert.rejects(pending,/owner-changed/);assert.equal(f.calls.length,1);assert.equal(f.state,null);
});
test('title conflict fallback resumes only Bot Chat by title and cleans only our acknowledged empty creation',async()=>{
 for(const missing of [false,true]) {
  const f=setup(op=>{
   if(op.kind==='profilesList')return{profiles:[{name:'agent'}]};
   if(op.kind==='canonicalSessionList')return{sessions:[]};
   if(op.kind==='canonicalSessionTitle')throw new GatewayOperationError(4022);
   if(op.kind==='sessionResume') {assert.equal(op.storedSessionId,'Bot Chat');if(missing)throw new GatewayOperationError(4007);return receipt('holder');}
   if(op.kind==='canonicalSessionDiscard'){assert.equal(op.storedSessionId,'ours');return{deleted:'ours'};}
   return{...receipt('ours'),messages:[],message_count:0};
  });
  if(missing){await assert.rejects(f.client.resolve(),/title-taken/);await assert.rejects(f.retry(),/title-taken/);}
  else assert.equal((await f.client.resolve()).root,'holder');
  assert.equal(f.calls.filter(c=>c[1]==='canonicalSessionCreate').length,1);
  assert.equal(f.calls.filter(c=>c[1]==='canonicalSessionDiscard').length,1);
 }
});
test('storage failure before dispatch cannot create; acknowledged created phase can resume exact identity',async()=>{
 const adapters={owner,currentOwner:()=>owner,readState:async()=>null,saveState:async()=>{throw Error('Disk full');},
  operation:async op=>op.kind==='profilesList'?{profiles:[{name:'agent'}]}:op.kind==='canonicalSessionList'?{sessions:[]}:assert.fail('No mutation authorized')};
 await assert.rejects(createCanonicalChatClient(adapters).resolve(),/Disk full/);
 let lists=0;const f=setup(op=>{
  if(op.kind==='profilesList')return{profiles:[{name:'agent'}]};
  if(op.kind==='canonicalSessionList')return{sessions:++lists<=2?[]:[{id:'created',title:'Bot Chat'}]};
  if(op.kind==='canonicalSessionTitle')return{pending:false,title:'Bot Chat'};
  assert.equal(op.storedSessionId,'created');return receipt('created');
 },{version:1,root:null,phase:'created',createdStoredId:'created'});
 assert.equal((await f.client.resolve()).root,'created');assert.equal(f.calls.some(c=>c[1]==='canonicalSessionCreate'),false);
});
test('canonical codecs bound state and reject authority gadgets',()=>{
 assert.throws(()=>decodeCanonicalState({version:1,root:null,phase:'created',createdStoredId:null}));
 assert.throws(()=>decodeCanonicalList({sessions:[{id:'x',profile:'other',title:'Bot Chat'}]},'agent'));
 assert.throws(()=>decodeCanonicalProfiles({profiles:[{name:'agent',canonical_session:{id:''}}]},'agent'));
});
test('confirmed retirement can create a fresh canonical; unavailable or malformed exact detail cannot',async()=>{
 const known={version:1,root:'retired-root',phase:'complete',createdStoredId:null};
 for(const detail of [{id:'retired-root',profile:'agent',title:'Bot Chat',archived:true},{id:'retired-root',profile:'agent',title:'Renamed',archived:false}]) {
  let lists=0;
  const f=setup(op=>{
   if(op.kind==='profilesList')return{profiles:[{name:'agent'}]};
   if(op.kind==='canonicalSessionList')return{sessions:++lists<=2?[]:[{id:'fresh',title:'Bot Chat'}]};
   if(op.kind==='canonicalSessionTitle')return{pending:false,title:'Bot Chat'};
   return {...receipt('fresh'),message_count:0,messages:[]};
  },known,async id=>{assert.equal(id,'retired-root');return detail;});
  assert.equal((await f.client.resolve()).root,'fresh');assert.equal(f.calls.filter(c=>c[1]==='canonicalSessionCreate').length,1);
 }
 for(const detail of [{id:'other',profile:'agent',title:'Renamed'}, {id:'retired-root',profile:'other',title:'Renamed'},
  {id:'retired-root',profile:'agent',archived:true},{id:'retired-root',profile:'agent',title:'Bot Chat',archived:'true'},
  {id:'retired-root',profile:'agent',title:'Bot Chat',archived:false},null]) {
  const f=setup(op=>op.kind==='profilesList'?{profiles:[{name:'agent'}]}:{sessions:[]},known,async()=>{if(detail===null)throw Error('Unavailable');return detail;});
  await assert.rejects(f.client.resolve(),/canonical-missing/);assert.equal(f.calls.some(c=>c[1]==='canonicalSessionCreate'),false);
 }
});
test('cancellation during retirement detail cannot replace or forget the remembered root',async()=>{
 let release;const known={version:1,root:'root',phase:'complete',createdStoredId:null};
 const f=setup(op=>op.kind==='profilesList'?{profiles:[{name:'agent'}]}:{sessions:[]},known,()=>new Promise(resolve=>{release=resolve;}));
 const pending=f.client.resolve();while(!release)await new Promise(resolve=>setImmediate(resolve));
 f.retire();release({id:'root',profile:'agent',title:'Renamed',archived:false});
 await assert.rejects(pending,/owner-changed/);assert.deepEqual(f.state,known);
 assert.equal(f.calls.some(c=>c[0]==='save'||c[1]==='canonicalSessionCreate'),false);
});
