import test from 'node:test';
import assert from 'node:assert/strict';
import {connectGateway} from '../packages/hermes-client/gateway.ts';
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
