import test from 'node:test';
import assert from 'node:assert/strict';
import { createDesktopService } from '../apps/desktop/src/main/desktop-service.ts';

const host={label:'Synthetic computer',endpoint:'https://test.invalid',authentication:'dashboard',token:'synthetic-private-token',allowPrivateHttp:false};
function setup({failWrite=false}={}) {
 const values=new Map(),calls=[]; let callbacks;
 const repository={async read(key){return values.get(key)??null;},async write(key,revision,value){
  if(failWrite)throw Error('Disk unavailable'); assert.equal(values.get(key)?.revision??null,revision);
  const next={revision:(revision??0)+1,value:structuredClone(value)};values.set(key,next);calls.push(['write',key,value?.intents?.at(-1)?.phase]);return next;
 }};
 const gateway={exclusiveSubmit:true,close(){calls.push(['close']);},async requestHttp(){return{body:{ok:true,auth_required:false}};},
 async operation(op){calls.push(['operation',op.kind]);if(op.kind==='profilesList')return{profiles:[{name:'agent',display_name:'Test Agent'}]};
 if(op.kind==='sessionList')return{sessions:[]};if(op.kind==='sessionCreate'||op.kind==='sessionResume')return{session_id:'runtime',stored_session_id:'stored',info:{profile_name:'agent'},running:false};
 if(op.kind==='sessionHistory')return{count:0,messages:[]};return{};},
 async submitText(request){calls.push(['submit',request]);return{jsonrpc:'2.0',id:request.id,result:{status:'streaming'}};}};
 const service=createDesktopService({repository,connect:async options=>{callbacks=options;return gateway;},onChange(){}});
 return{service,calls,values,repository,gateway,get callbacks(){return callbacks;}};
}
async function opened(f){await f.service.handle({kind:'connect',host});await f.service.handle({kind:'newChat',generation:f.service.snapshot().generation,profile:'agent'});return f.service.snapshot();}
test('desktop service keeps host credentials out of snapshots and creates an ordinary session',async()=>{
 const f=setup();const state=await opened(f);assert.equal(state.status,'connected');assert.equal(state.selectedChatId,'stored');assert.equal(state.canSend,true);
 assert.equal(JSON.stringify(state).includes(host.token),false);assert.equal(JSON.stringify(state).includes(host.endpoint),false);
});
test('desktop service durably records both barriers before dispatch and never resends on reconnect',async()=>{
 const f=setup();const s=await opened(f);await f.service.handle({kind:'send',generation:s.generation,chatId:'stored',text:'Hello'});
 const relevant=f.calls.filter(c=>c[0]==='submit'||c[2]);assert.deepEqual(relevant.map(c=>c[0]==='submit'?'submit':c[2]),['prepared','dispatched','submit','accepted']);
 await f.service.handle({kind:'disconnect'});await f.service.handle({kind:'connect',host});assert.equal(f.calls.filter(c=>c[0]==='submit').length,1);
});
test('desktop service refuses stale sends, storage failures, and concurrent sends',async()=>{
 const f=setup();const s=await opened(f);assert.equal((await f.service.handle({kind:'send',generation:s.generation-1,chatId:'stored',text:'Hi'})).ok,false);
 const send={kind:'send',generation:s.generation,chatId:'stored',text:'Hi'};
 await Promise.all([f.service.handle(send),f.service.handle(send)]);assert.equal(f.calls.filter(c=>c[0]==='submit').length,1);
 const broken=setup({failWrite:true});assert.equal((await broken.service.handle({kind:'connect',host})).ok,false);assert.equal(broken.calls.some(c=>c[0]==='submit'),false);
});
test('desktop service ignores another runtime and does not finish a turn on message.complete',async()=>{
 const f=setup();await opened(f);f.callbacks.onEvent({kind:'event',params:{type:'message.delta',session_id:'other',payload:{text:'wrong'}}});
 assert.equal(JSON.stringify(f.service.snapshot()).includes('wrong'),false);
 f.callbacks.onEvent({kind:'event',params:{type:'message.start',session_id:'runtime',payload:{}}});
 f.callbacks.onEvent({kind:'event',params:{type:'message.delta',session_id:'runtime',payload:{text:'Hello'}}});
 f.callbacks.onEvent({kind:'event',params:{type:'message.complete',session_id:'runtime',payload:{text:'Hello'}}});
 assert.equal(f.service.snapshot().running,true);
});
test('desktop service requires explicit prompt answers and retires them on disconnect',async()=>{
 const f=setup();await opened(f);const controller=new AbortController();
 const answer=f.callbacks.onRequest({kind:'request',id:'rpc-approval',method:'approval',params:{session_id:'runtime',request_id:'decision',choices:['once','deny'],command:'synthetic'}},controller.signal);
 const s=f.service.snapshot();assert.equal(s.prompts.length,1);
 assert.equal((await f.service.handle({kind:'answer',generation:s.generation,promptId:'rpc-approval',answer:'always'})).ok,false);
 await f.service.handle({kind:'answer',generation:s.generation,promptId:'rpc-approval',answer:'deny'});
 assert.deepEqual(await answer,{result:{choice:'deny',all:false}});
});
test('a turn ending before the submit receipt does not leave the composer stuck running',async()=>{
 const f=setup();const s=await opened(f);
 f.gateway.submitText=async request=>{
  f.callbacks.onEvent({kind:'event',params:{type:'message.start',session_id:'runtime',payload:{}}});
  f.callbacks.onEvent({kind:'event',params:{type:'session.info',session_id:'runtime',payload:{running:false}}});
  return {jsonrpc:'2.0',id:request.id,result:{status:'streaming'}};
 };
 await f.service.handle({kind:'send',generation:s.generation,chatId:'stored',text:'Hello'});
 assert.equal(f.service.snapshot().running,false);
 assert.equal(f.service.snapshot().canSend,true);
});
test('relaunch restores the saved host without exposing or replaying credentials and sends',async()=>{
 const f=setup();await opened(f);await f.service.initialize();
 assert.equal(f.service.snapshot().status,'connected');
 assert.equal(JSON.stringify(f.service.snapshot()).includes(host.token),false);
 assert.equal(f.calls.some(c=>c[0]==='submit'),false);
 await f.service.handle({kind:'disconnect'});await f.service.initialize();
 assert.equal(f.service.snapshot().status,'disconnected');
});
test('failed receipt persistence keeps an already dispatched send fenced',async()=>{
 const f=setup();const s=await opened(f);
 // Simulate a disk that fails immediately after transport acceptance.
 f.gateway.submitText=async request=>{f.values.set=()=>{throw Error('Disk full');};return{jsonrpc:'2.0',id:request.id,result:{status:'streaming'}};};
 const result=await f.service.handle({kind:'send',generation:s.generation,chatId:'stored',text:'Hello'});
 assert.equal(result.ok,false);assert.equal(f.service.snapshot().canSend,false);
});
test('older history responses cannot erase newer completed turns',async()=>{
 const f=setup();await opened(f);const replies=[];
 f.gateway.operation=async op=>{assert.equal(op.kind,'sessionHistory');return new Promise(resolve=>replies.push(resolve));};
 const idle={kind:'event',params:{type:'session.info',session_id:'runtime',payload:{running:false}}};
 f.callbacks.onEvent(idle);f.callbacks.onEvent(idle);
 replies[1]({count:1,messages:[{row_id:2,role:'assistant',text:'Newest reply'}]});await new Promise(resolve=>setImmediate(resolve));
 replies[0]({count:0,messages:[]});await new Promise(resolve=>setImmediate(resolve));
 assert.match(JSON.stringify(f.service.snapshot().data.chats),/Newest reply/);
});
test('newer durable typing survives completion of an earlier send',async()=>{
 const f=setup();const s=await opened(f);
 await f.service.handle({kind:'draft',generation:s.generation,chatId:'stored',text:'First message'});
 let finish;f.gateway.submitText=request=>new Promise(resolve=>{finish=()=>resolve({jsonrpc:'2.0',id:request.id,result:{status:'streaming'}});});
 const sending=f.service.handle({kind:'send',generation:s.generation,chatId:'stored',text:'First message'});
 while(!finish)await new Promise(resolve=>setImmediate(resolve));
 await f.service.handle({kind:'draft',generation:s.generation,chatId:'stored',text:'Next message'});
 finish();assert.equal((await sending).ok,true);
 assert.equal(f.service.snapshot().drafts.stored,'Next message');
 assert.ok([...f.values.values()].some(entry=>entry.value==='Next message'));
});
test('a delayed startup read cannot reconnect after explicit disconnect',async()=>{
 const f=setup();await opened(f);const original=f.repository.read;
 let release;f.repository.read=key=>key==='desktop:autoConnect'?new Promise(resolve=>{release=()=>resolve({revision:1,value:true});}):original(key);
 const restoring=f.service.initialize();await f.service.handle({kind:'disconnect'});release();await restoring;
 assert.equal(f.service.snapshot().status,'disconnected');
});
test('unrelated metadata does not invalidate the only required history response',async()=>{
 const f=setup();await opened(f);let reply;
 f.gateway.operation=()=>new Promise(resolve=>{reply=resolve;});
 f.callbacks.onEvent({kind:'event',params:{type:'session.info',session_id:'runtime',payload:{running:false}}});
 f.callbacks.onEvent({kind:'event',params:{type:'message.reaction',session_id:'runtime',payload:{}}});
 reply({count:0,messages:[]});await new Promise(resolve=>setImmediate(resolve));
 assert.equal(f.service.snapshot().canSend,true);
});
test('an accepted send is retired only after its terminal event and saved history',async()=>{
 const f=setup();const s=await opened(f);
 await f.service.handle({kind:'send',generation:s.generation,chatId:'stored',text:'Hello'});
 assert.ok([...f.values.values()].some(entry=>entry.value?.intents?.some(intent=>intent.phase==='accepted')));
 f.callbacks.onEvent({kind:'event',params:{type:'message.complete',session_id:'runtime',payload:{text:'Hello'}}});
 assert.ok([...f.values.values()].some(entry=>entry.value?.intents?.some(intent=>intent.phase==='accepted')));
 f.callbacks.onEvent({kind:'event',params:{type:'session.info',session_id:'runtime',payload:{running:false}}});
 await new Promise(resolve=>setImmediate(resolve));
 assert.ok([...f.values.values()].some(entry=>entry.value?.intents?.some(intent=>intent.phase==='complete')));
 await f.service.handle({kind:'openChat',generation:f.service.snapshot().generation,chatId:'stored'});
 assert.equal(f.service.snapshot().notice,'');
});
test('an initial transport failure returns to disconnected state',async()=>{
 const service=createDesktopService({repository:setup().repository,connect:async()=>{throw Error('Connection refused');},onChange(){}});
 assert.equal((await service.handle({kind:'connect',host})).ok,false);
 assert.equal(service.snapshot().status,'disconnected');
});
test('a delayed old receipt cannot erase a newer send journal after reconnect',async()=>{
 const f=setup();const s=await opened(f);let finish;
 f.gateway.submitText=request=>new Promise(resolve=>{finish=()=>resolve({jsonrpc:'2.0',id:request.id,result:{status:'streaming'}});});
 const first=f.service.handle({kind:'send',generation:s.generation,chatId:'stored',text:'First'});
 while(!finish)await new Promise(resolve=>setImmediate(resolve));
 await f.service.handle({kind:'disconnect'});await opened(f);
 f.gateway.submitText=async request=>({jsonrpc:'2.0',id:request.id,result:{status:'streaming'}});
 await f.service.handle({kind:'send',generation:f.service.snapshot().generation,chatId:'stored',text:'Second'});
 finish();await first;
 const records=[...f.values.values()].flatMap(entry=>entry.value?.intents??[entry.value]);
 assert.ok(records.some(record=>record.request?.params.text==='First'&&record.phase==='unknown'));
 assert.ok(records.some(record=>record.request?.params.text==='Second'&&record.phase==='accepted'));
});
test('workspace publication retains only validated display data and retires stale reads',async()=>{
 const f=setup();await opened(f);const generation=f.service.snapshot().generation;
 const project={id:'project',name:'Example',archived:false,folders:[],secret:'discarded',url:'https://ignored.invalid'};
 f.gateway.operation=async op=>{assert.equal(op.kind,'projectsList');return{projects:[project],active_id:null};};
 await f.service.handle({kind:'workspace',generation,profile:'agent',page:'projects',days:30});
 assert.equal(f.service.snapshot().workspace.status,'loaded');
 assert.equal(JSON.stringify(f.service.snapshot()).includes('discarded'),false);
 let release;f.gateway.requestHttp=()=>new Promise(resolve=>{release=resolve;});
 const pending=f.service.handle({kind:'workspace',generation,profile:'agent',page:'usage',days:30});
 await f.service.handle({kind:'disconnect'});
 release({status:200,body:{daily:[],totals:{total_sessions:0}}});await pending;
 assert.equal(f.service.snapshot().workspace,null);
});
test('agent entry resolves a hidden canonical root while ordinary New chat stays isolated',async()=>{
 const f=setup();await f.service.handle({kind:'connect',host});const original=f.gateway.operation;const operations=[];
 f.gateway.operation=async op=>{
  operations.push(op);
  if(op.kind==='profilesList')return{profiles:[{name:'agent',canonical_session:{id:'hidden-root',resolved_id:'tip'}}]};
  if(op.kind==='sessionResume')return{session_id:'canonical-runtime',stored_session_id:'tip',info:{profile_name:'agent'},running:false};
  return original(op);
 };
 assert.equal((await f.service.handle({kind:'canonicalChat',generation:f.service.snapshot().generation,profile:'agent',requestId:'entry'})).ok,true);
 assert.equal(f.service.snapshot().selectedChatId,'tip');assert.equal(f.service.snapshot().data.chats[0].title,'Bot Chat');
 assert.equal(operations.find(op=>op.kind==='sessionResume').storedSessionId,'hidden-root');
 await f.service.handle({kind:'newChat',generation:f.service.snapshot().generation,profile:'agent'});
 assert.equal(f.service.snapshot().selectedChatId,'stored');assert.equal(operations.filter(op=>op.kind==='sessionCreate').length,1);
 assert.equal(operations.some(op=>op.kind==='canonicalSessionCreate'),false);
});
test('leaving before incremented generation publication cancels only that canonical navigation',async()=>{
 const f=setup();await f.service.handle({kind:'connect',host});const initiating=f.service.snapshot().generation;
 let release;f.gateway.operation=()=>new Promise(resolve=>{release=resolve;});
 const pending=f.service.handle({kind:'canonicalChat',generation:initiating,profile:'agent',requestId:'leaving'});
 while(!release)await new Promise(resolve=>setImmediate(resolve));
 await f.service.handle({kind:'cancelNavigation',generation:initiating,requestId:'leaving'});
 release({profiles:[{name:'agent',canonical_session:{id:'wrong-after-leaving'}}]});await pending;
 assert.equal(f.service.snapshot().selectedChatId,null);assert.equal(f.service.snapshot().canSend,false);
 assert.equal([...f.values.keys()].some(key=>key.startsWith('canonical:')),false);
});
test('overlapping agent entries fence old completion and delayed old cancellation',async()=>{
 const f=setup();await f.service.handle({kind:'connect',host});const initiating=f.service.snapshot().generation;
 let releaseFirst,releaseSecond,profiles=0;const operations=[];
 f.gateway.operation=async op=>{
  operations.push(op);
  if(op.kind==='profilesList')return new Promise(resolve=>{if(++profiles===1)releaseFirst=resolve;else releaseSecond=resolve;});
  if(op.kind==='sessionResume')return{session_id:'live-current',stored_session_id:'current-tip',info:{profile_name:'agent'},running:false};
  if(op.kind==='sessionHistory')return{count:0,messages:[]};throw Error('Unexpected operation');
 };
 const first=f.service.handle({kind:'canonicalChat',generation:initiating,profile:'agent',requestId:'first'});
 while(!releaseFirst)await new Promise(resolve=>setImmediate(resolve));
 assert.equal((await f.service.handle({kind:'canonicalChat',generation:initiating,profile:'agent',requestId:'first'})).ok,false);
 assert.equal(profiles,1);
 // A newer-generation request that cannot enter must not erase old tombstones.
 assert.equal((await f.service.handle({kind:'canonicalChat',generation:f.service.snapshot().generation,profile:'missing-agent',requestId:'invalid'})).ok,false);
 assert.equal((await f.service.handle({kind:'canonicalChat',generation:initiating,profile:'agent',requestId:'first'})).ok,false);
 assert.equal(profiles,1);
 const second=f.service.handle({kind:'canonicalChat',generation:initiating,profile:'agent',requestId:'second'});
 while(!releaseSecond)await new Promise(resolve=>setImmediate(resolve));
 assert.equal((await f.service.handle({kind:'canonicalChat',generation:initiating,profile:'agent',requestId:'first'})).ok,false);
 assert.equal(profiles,2);
 await f.service.handle({kind:'cancelNavigation',generation:initiating,requestId:'first'});
 releaseSecond({profiles:[{name:'agent',canonical_session:{id:'current-root',resolved_id:'current-tip'}}]});await second;
 releaseFirst({profiles:[{name:'agent',canonical_session:{id:'old-root'}}]});await first;
 assert.equal(f.service.snapshot().selectedChatId,'current-tip');
 assert.deepEqual(operations.filter(op=>op.kind==='sessionResume').map(op=>op.storedSessionId),['current-root']);
 assert.equal([...f.values.values()].find(entry=>entry.value?.root)?.value.root,'current-root');
 // Leaving a settled chat does not discard its runtime/send lease.
 await f.service.handle({kind:'cancelNavigation',generation:initiating,requestId:'second'});
 assert.equal(f.service.snapshot().canSend,true);
});
test('late create receipt cannot overwrite canonical recovery state or authorize another create',async()=>{
 const f=setup();await f.service.handle({kind:'connect',host});let finish;let creates=0;
 f.gateway.operation=async op=>{
  if(op.kind==='profilesList')return{profiles:[{name:'agent'}]};
  if(op.kind==='canonicalSessionList'||op.kind==='sessionList')return{sessions:[]};
  if(op.kind==='canonicalSessionCreate'){creates++;return new Promise(resolve=>{finish=resolve;});}
  assert.fail('Unexpected operation');
 };
 const initiating=f.service.snapshot().generation;
 const first=f.service.handle({kind:'canonicalChat',generation:initiating,profile:'agent',requestId:'old-create'});
 while(!finish)await new Promise(resolve=>setImmediate(resolve));
 await f.service.handle({kind:'cancelNavigation',generation:initiating,requestId:'old-create'});
 assert.equal((await f.service.handle({kind:'canonicalChat',generation:f.service.snapshot().generation,profile:'agent',requestId:'retry-create'})).ok,false);
 finish({session_id:'old-runtime',stored_session_id:'old-created',info:{profile_name:'agent'},message_count:0,messages:[]});await first;
 assert.equal(creates,1);assert.equal(f.service.snapshot().selectedChatId,null);
 assert.equal([...f.values.values()].find(entry=>entry.value?.phase)?.value.phase,'createRequested');
 // A different authenticated authority receives a separate encrypted state key.
 await f.service.handle({kind:'connect',host:{...host,token:'different-synthetic-authority'}});
 const otherGeneration=f.service.snapshot().generation;
 const next=f.service.handle({kind:'canonicalChat',generation:otherGeneration,profile:'agent',requestId:'other-authority'});
 while(creates!==2)await new Promise(resolve=>setImmediate(resolve));
 await f.service.handle({kind:'cancelNavigation',generation:otherGeneration,requestId:'other-authority'});
 finish({session_id:'other-runtime',stored_session_id:'other-created',info:{profile_name:'agent'},message_count:0,messages:[]});await next;
 assert.equal([...f.values.keys()].filter(key=>key.startsWith('canonical:')).length,2);
});
test('canonical entry remains usable beyond 4096 settled navigations and after reconnect',async()=>{
 const f=setup();await f.service.handle({kind:'connect',host});const original=f.gateway.operation;
 f.gateway.operation=op=>op.kind==='profilesList'?Promise.resolve({profiles:[{name:'agent',canonical_session:{id:'root'}}]}):original(op);
 for(let index=0;index<4100;index++) {
  const result=await f.service.handle({kind:'canonicalChat',generation:f.service.snapshot().generation,profile:'agent',requestId:`entry-${index}`});
  assert.equal(result.ok,true,`settled navigation ${index}`);
 }
 await f.service.handle({kind:'disconnect'});await f.service.handle({kind:'connect',host});
 assert.equal((await f.service.handle({kind:'canonicalChat',generation:f.service.snapshot().generation,profile:'agent',requestId:'entry-0'})).ok,true);
});
test('settled request IDs can be reused while old-generation entry and cancellation stay retired',async()=>{
 const f=setup();await f.service.handle({kind:'connect',host});const original=f.gateway.operation;
 let release,delayed=false,profiles=0;
 f.gateway.operation=op=>{
  if(op.kind!=='profilesList')return original(op);
  profiles++;const result={profiles:[{name:'agent',canonical_session:{id:'root'}}]};
  return delayed?new Promise(resolve=>{release=()=>resolve(result);}):Promise.resolve(result);
 };
 const firstGeneration=f.service.snapshot().generation;
 const first={kind:'canonicalChat',generation:firstGeneration,profile:'agent',requestId:'shared-id'};
 assert.equal((await f.service.handle(first)).ok,true);
 const secondGeneration=f.service.snapshot().generation;delayed=true;
 const second={...first,generation:secondGeneration};const pending=f.service.handle(second);
 while(!release)await new Promise(resolve=>setImmediate(resolve));
 const activeGeneration=f.service.snapshot().generation;
 assert.equal((await f.service.handle(second)).ok,false); // same active identity
 assert.equal((await f.service.handle(first)).ok,false); // old initiating generation
 await f.service.handle({kind:'cancelNavigation',generation:firstGeneration,requestId:'shared-id'});
 assert.equal(f.service.snapshot().generation,activeGeneration);assert.equal(profiles,2);
 release();assert.equal((await pending).ok,true);assert.equal(f.service.snapshot().canSend,true);
 // Reusing the ID after reconnect is also safe against the earlier cancellation.
 delayed=false;await f.service.handle({kind:'disconnect'});await f.service.handle({kind:'connect',host});
 delayed=true;release=undefined;const thirdGeneration=f.service.snapshot().generation;
 const third=f.service.handle({...first,generation:thirdGeneration});
 while(!release)await new Promise(resolve=>setImmediate(resolve));
 const thirdActive=f.service.snapshot().generation;
 await f.service.handle({kind:'cancelNavigation',generation:secondGeneration,requestId:'shared-id'});
 assert.equal(f.service.snapshot().generation,thirdActive);
 release();assert.equal((await third).ok,true);assert.equal(f.service.snapshot().canSend,true);
});
test('ordinary and saved-chat supersession retire the older canonical generation without admitting its replay',async()=>{
 for(const kind of ['newChat','openChat']) {
  const f=setup();await opened(f);const original=f.gateway.operation;let oldRelease,nextRelease;
  f.gateway.operation=op=>{
   if(op.kind==='profilesList')return new Promise(resolve=>{oldRelease=()=>resolve({profiles:[{name:'agent',canonical_session:{id:'old-root'}}]});});
   if(op.kind===(kind==='newChat'?'sessionCreate':'sessionResume'))return new Promise(resolve=>{nextRelease=()=>resolve({session_id:'new-runtime',stored_session_id:'new-stored',info:{profile_name:'agent'},running:false});});
   return original(op);
  };
  const initiating=f.service.snapshot().generation;
  const old={kind:'canonicalChat',generation:initiating,profile:'agent',requestId:'old-id'};
  const first=f.service.handle(old);while(!oldRelease)await new Promise(resolve=>setImmediate(resolve));
  const second=f.service.handle(kind==='newChat'?{kind,generation:initiating,profile:'agent'}:{kind,generation:initiating,chatId:'stored'});
  while(!nextRelease)await new Promise(resolve=>setImmediate(resolve));
  const current=f.service.snapshot().generation;
  assert.equal((await f.service.handle(old)).ok,false);
  await f.service.handle({kind:'cancelNavigation',generation:initiating,requestId:'old-id'});
  assert.equal(f.service.snapshot().generation,current);
  nextRelease();assert.equal((await second).ok,true);oldRelease();await first;
  assert.equal(f.service.snapshot().selectedChatId,'new-stored');assert.equal(f.service.snapshot().canSend,true);
 }
});
