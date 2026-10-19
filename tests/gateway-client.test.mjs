import test from 'node:test';
import assert from 'node:assert/strict';
import {connectGateway,GatewayOperationError} from '../packages/hermes-client/gateway.ts';
const configuration={endpoint:'https://fixture.invalid',authentication:{kind:'dashboard',token:'synthetic'}};
const event=(type,payload)=>JSON.stringify({jsonrpc:'2.0',method:'event',params:{type,...(payload?{payload}: {})}});
async function fixture(early=true,onRequest=async()=>({error:{code:-32601,message:'Unsupported'}})) {
 let frame,closed,closeCount=0;const sent=[];
 const gateway=await connectGateway({configuration,isCurrent:()=>true,onRequest,onEvent:()=>{},onClosed:()=>{},
 socket:async(_plan,_signal,receive,onClosed)=>{frame=receive;closed=onClosed;
  if(early)receive(event('gateway.ready'));else queueMicrotask(()=>receive(event('gateway.ready')));
  return {close(){closeCount++;},send(text){const message=JSON.parse(text);sent.push(message);
   if(message.method)queueMicrotask(()=>receive(JSON.stringify({jsonrpc:'2.0',id:message.id,result:message.method==='gateway.capabilities'?{per_session_exclusive_submit:true}:{ok:true}})));
  }};
 }});
 return {gateway,sent,frame,closed,get closeCount(){return closeCount;}};
}
test('ready before/after socket resolution negotiates before finite session operations',async()=>{
 for(const early of [true,false]){const f=await fixture(early);try{
 assert.equal(f.gateway.exclusiveSubmit,true);
 assert.deepEqual(f.sent.map(x=>x.method),['client.capabilities','gateway.capabilities']);
 await f.gateway.operation({kind:'sessionCreate',profile:'default'});
 assert.deepEqual(f.sent.at(-1).params,{profile:'default',source:'bighelp',close_on_disconnect:false});
 await assert.rejects(f.gateway.operation({kind:'arbitrary'}));
 }finally{f.gateway.close();}}
});
test('server cancellation matches ID and method and suppresses late response',async()=>{
 let signal,resolve;const f=await fixture(true,async(_request,cancel)=>{signal=cancel;return await new Promise(r=>resolve=r);});
 f.frame(JSON.stringify({jsonrpc:'2.0',id:'server',method:'approval',params:{}}));
 f.frame(event('request.cancel',{id:'server',method:'clarify',reason:'cancel'}));assert.equal(signal.aborted,false);
 f.frame(event('request.cancel',{id:'server',method:'approval',reason:'cancel'}));assert.equal(signal.aborted,true);
 resolve({result:{choice:'deny'}});await new Promise(r=>setImmediate(r));assert.equal(f.sent.some(x=>x.id==='server'),false);f.gateway.close();
});
test('invalid frame retires gateway and late callbacks cannot send',async()=>{
 const f=await fixture();f.frame('{"jsonrpc":"2.0","id":"x","result":1,"result":2}');
 await assert.rejects(f.gateway.operation({kind:'profilesList'}));const count=f.sent.length;f.frame(event('gateway.ready'));assert.equal(f.sent.length,count);assert.ok(f.closeCount>0);
});
test('lost mutation acknowledgement stays unknown and no replay occurs',async()=>{
 let frame,closed;const sent=[];
 const gateway=await connectGateway({configuration,isCurrent:()=>true,onRequest:async()=>({result:{}}),onEvent:()=>{},onClosed:()=>{},
 socket:async(_p,_s,receive,onClosed)=>{frame=receive;closed=onClosed;receive(event('gateway.ready'));return {close(){},send(text){const m=JSON.parse(text);sent.push(m);
 if(['client.capabilities','gateway.capabilities'].includes(m.method))queueMicrotask(()=>receive(JSON.stringify({jsonrpc:'2.0',id:m.id,result:m.method==='gateway.capabilities'?{per_session_exclusive_submit:true}:{}})));
 }};}});
 const request=gateway.operation({kind:'sessionCreate',profile:'default'});closed();await assert.rejects(request,/outcome-unknown/);
 const count=sent.length;frame(event('gateway.ready'));assert.equal(sent.length,count);
});
test('generation fence retires late events and server requests',async()=>{
 let current=true,frame;let calls=0;
 const gateway=await connectGateway({configuration,isCurrent:()=>current,onRequest:async()=>{calls++;return {result:{}};},onEvent:()=>{},onClosed:()=>{},
 socket:async(_p,_s,receive)=>{frame=receive;receive(event('gateway.ready'));return {close(){},send(text){const m=JSON.parse(text);queueMicrotask(()=>receive(JSON.stringify({jsonrpc:'2.0',id:m.id,result:m.method==='gateway.capabilities'?{per_session_exclusive_submit:true}:{}})));}};}});
 current=false;frame(JSON.stringify({jsonrpc:'2.0',id:'late',method:'approval',params:{}}));assert.equal(calls,0);await assert.rejects(gateway.operation({kind:'profilesList'}));
});
test('fresh connection restores unanswered approval and clarify through live lifecycle once',async()=>{
 const restored=[{id:'approval-replay',method:'approval',params:{session_id:'live',request_id:'decision',choices:['deny']}},{id:'clarify-replay',method:'clarify',params:{session_id:'live',question:'Which?'}}];
 const handlers=[];const f=await fixture(true,async(request,signal)=>{handlers.push({request,signal});return await new Promise(()=>{});});
 try{
 f.gateway.restoreRequests(restored,'live');assert.deepEqual(handlers.map(x=>x.request.method),['approval','clarify']);
 f.gateway.restoreRequests(restored,'live');assert.equal(handlers.length,2);
 f.frame(JSON.stringify({jsonrpc:'2.0',...restored[0]}));assert.equal(handlers.length,2);
 f.frame(event('request.cancel',{id:'approval-replay',method:'clarify',reason:'withdraw'}));assert.equal(handlers[0].signal.aborted,false);
 f.frame(event('request.cancel',{id:'approval-replay',method:'approval',reason:'withdraw'}));assert.equal(handlers[0].signal.aborted,true);
 f.gateway.restoreRequests(restored,'live');assert.equal(handlers.length,2);
 }finally{f.gateway.close();}assert.equal(handlers[1].signal.aborted,true);
});
test('recovery rejects whole malformed snapshot before dispatch and stale gateway cannot restore',async()=>{
 let calls=0;const f=await fixture(true,async()=>{calls++;return {result:{}};});
 const valid={id:'valid',method:'approval',params:{session_id:'live'}};
 try{
 for(const wrong of [{id:'result',result:{}},{id:'notification',method:'event',params:{session_id:'live',type:'tool.started'}},{...valid,id:'wrong',params:{session_id:'other'}},{...valid,jsonrpc:'2.0'}])assert.throws(()=>f.gateway.restoreRequests([valid,wrong],'live'),/Invalid or oversized Hermes RPC frame/);
 assert.throws(()=>f.gateway.restoreRequests([valid,valid],'live'));assert.equal(calls,0);
 }finally{f.gateway.close();}
 assert.throws(()=>f.gateway.restoreRequests([valid],'live'),/Gateway unavailable/);assert.equal(calls,0);
});
test('canonical mutation errors preserve finite codes and lost acknowledgements stay unknown',async()=>{
 for(const kind of ['canonicalSessionCreate','canonicalSessionTitle','canonicalSessionDiscard']) {
  let closed,respond=true;
  const gateway=await connectGateway({configuration,isCurrent:()=>true,onRequest:async()=>({result:{}}),onEvent(){},onClosed(){},
   socket:async(_plan,_signal,receive,onClosed)=>{closed=onClosed;receive(event('gateway.ready'));return{close(){},send(text){
    const m=JSON.parse(text);
    if(['client.capabilities','gateway.capabilities'].includes(m.method))queueMicrotask(()=>receive(JSON.stringify({jsonrpc:'2.0',id:m.id,result:m.method==='gateway.capabilities'?{per_session_exclusive_submit:true}:{}})));
    else if(respond)queueMicrotask(()=>receive(JSON.stringify({jsonrpc:'2.0',id:m.id,error:{code:4022,message:'Private host detail'}})));
   }};}});
  const op={kind,profile:'agent',runtimeId:'runtime',storedSessionId:'created'};
  await assert.rejects(gateway.operation(op),error=>error instanceof GatewayOperationError&&error.code===4022&&!error.message.includes('Private'));
  respond=false;const pending=gateway.operation(op);closed();await assert.rejects(pending,/outcome-unknown/);
 }
});

const textRequest=id=>({jsonrpc:'2.0',id,method:'prompt.submit',params:{profile:'default',session_id:'live',text:'Synthetic request',queued:true}});
async function outgoingFixture() {
 let frame,closed,lifetime,autoReply=true,closeCount=0,notificationCount=0;const sent=[];
 const gateway=await connectGateway({configuration,isCurrent:()=>true,onRequest:async()=>({result:{}}),onEvent(){},onClosed(){notificationCount++;},
  socket:async(_plan,signal,receive,onClosed)=>{
   frame=receive;closed=onClosed;lifetime=signal;receive(event('gateway.ready'));
   return {close(){closeCount++;onClosed();},send(text){
    const message=JSON.parse(text);sent.push(message);
    if(autoReply)queueMicrotask(()=>receive(JSON.stringify({jsonrpc:'2.0',id:message.id,result:message.method==='gateway.capabilities'?{per_session_exclusive_submit:true}:message.method==='prompt.submit'?{status:'streaming'}:{}})));
   }};
  }});
 return {gateway,sent,frame,closed,lifetime,pause(){autoReply=false;},get closeCount(){return closeCount;},get notificationCount(){return notificationCount;}};
}
test('outgoing history exhaustion retires exactly at the negotiated budget without dispatch or replay',async()=>{
 const f=await outgoingFixture();const rejected=textRequest('durable-undispatched');
 try{
  assert.equal(f.sent.length,2); // Both negotiation IDs consume the same lifetime budget.
  for(let i=0;i<4094;i++)await f.gateway.operation({kind:'profilesList'});
  assert.equal(f.sent.length,4096);assert.equal(f.notificationCount,0);assert.equal(f.lifetime.aborted,false);
  await assert.rejects(f.gateway.submitText(rejected),/^Error: Gateway unavailable$/);
  assert.equal(f.sent.length,4096);assert.equal(f.sent.some(message=>message.id===rejected.id),false);
  assert.equal(f.closeCount,1);assert.equal(f.notificationCount,1);assert.equal(f.lifetime.aborted,true);
  f.closed();f.gateway.close();f.frame(event('gateway.ready'));
  await assert.rejects(f.gateway.operation({kind:'profilesList'}));
  assert.equal(f.sent.length,4096);assert.equal(f.closeCount,1);assert.equal(f.notificationCount,1);
  const fresh=await outgoingFixture();
  try{
   assert.deepEqual(fresh.sent.map(message=>message.method),['client.capabilities','gateway.capabilities']);
   const request=textRequest('durable-fresh');const receipt=await fresh.gateway.submitText(request);
   assert.deepEqual(fresh.sent.at(-1),request);assert.equal(receipt.id,request.id);assert.equal(receipt.result.status,'streaming');
   for(let i=0;i<4093;i++)await fresh.gateway.operation({kind:'profilesList'});
   assert.equal(fresh.sent.length,4096);assert.equal(fresh.notificationCount,0);
   await assert.rejects(fresh.gateway.operation({kind:'profilesList'}),/^Error: Gateway unavailable$/);
   assert.equal(fresh.sent.length,4096);assert.equal(fresh.notificationCount,1);
  }finally{fresh.gateway.close();}
 }finally{f.gateway.close();}
});
test('outgoing history exhaustion settles pending reads and mutations through closure once',async()=>{
 const f=await outgoingFixture();
 try{
  for(let i=0;i<4092;i++)await f.gateway.operation({kind:'profilesList'});
  f.pause();
  const read=assert.rejects(f.gateway.operation({kind:'profilesList'}),/^Error: transport-unavailable$/);
  const mutation=assert.rejects(f.gateway.submitText(textRequest('durable-pending')),/^Error: outcome-unknown$/);
  assert.equal(f.sent.length,4096);
  await assert.rejects(f.gateway.operation({kind:'profilesList'}),/^Error: Gateway unavailable$/);
  assert.equal(f.notificationCount,1);assert.equal(f.closeCount,1);
  await Promise.all([read,mutation]);
  f.frame(JSON.stringify({jsonrpc:'2.0',id:'durable-pending',result:{status:'streaming'}}));f.closed();
  assert.equal(f.sent.length,4096);assert.equal(f.notificationCount,1);
 }finally{f.gateway.close();}
});
test('outgoing duplicate IDs remain rejected after settlement without retiring a usable socket',async()=>{
 const f=await outgoingFixture();const request=textRequest('durable-once');
 try{
  await f.gateway.submitText(request);const count=f.sent.length;
  await assert.rejects(f.gateway.submitText(request),/^Error: Gateway unavailable$/);
  assert.equal(f.sent.length,count);assert.equal(f.notificationCount,0);assert.equal(f.lifetime.aborted,false);
  await f.gateway.operation({kind:'profilesList'});assert.equal(f.sent.length,count+1);
 }finally{f.gateway.close();}
});
test('pending capacity rejection preserves a usable socket and does not consume request IDs',async()=>{
 const f=await outgoingFixture();
 try{
  f.pause();
  const pending=Array.from({length:64},(_,i)=>{
   const request=textRequest(`durable-capacity-${i}`);
   return {request,receipt:f.gateway.submitText(request)};
  });
  const request=textRequest('durable-capacity-rejected');
  await assert.rejects(f.gateway.submitText(request),/^Error: Gateway unavailable$/);
  assert.equal(f.sent.length,66);assert.equal(f.notificationCount,0);assert.equal(f.lifetime.aborted,false);
  const duplicate=assert.rejects(f.gateway.submitText(pending[0].request),/^Error: Gateway unavailable$/);
  for(const entry of pending)f.frame(JSON.stringify({jsonrpc:'2.0',id:entry.request.id,result:{status:'streaming'}}));
  await Promise.all([duplicate,...pending.map(entry=>entry.receipt)]);
  const accepted=f.gateway.submitText(request);assert.deepEqual(f.sent.at(-1),request);
  f.frame(JSON.stringify({jsonrpc:'2.0',id:request.id,result:{status:'streaming'}}));await accepted;
  assert.equal(f.notificationCount,0);assert.equal(f.sent.length,67);
 }finally{f.gateway.close();}
});
