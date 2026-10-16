import test from 'node:test';
import assert from 'node:assert/strict';
import { createDesktopService } from '../apps/desktop/src/main/desktop-service.ts';

const host={label:'Synthetic recovery computer',endpoint:'https://recovery.invalid',authentication:'dashboard',token:'synthetic-recovery-token',allowPrivateHttp:false};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
async function until(check){for(let i=0;i<100;i++){if(check())return;await tick();}assert.fail('Condition did not settle');}
function fixture(){
 const values=new Map(),calls=[];let callbacks,failCache=false,failConnect=false,principal='one';
 const repository={async read(key){return structuredClone(values.get(key)??null);},async write(key,revision,value){
  if(failCache&&(key.startsWith('display-cache:')||key==='desktop:cacheOwner'))throw Error('Synthetic cache failure');
  assert.equal(values.get(key)?.revision??null,revision);const next={revision:(revision??0)+1,value:structuredClone(value)};values.set(key,next);calls.push(['write',key,value]);return next;
 }};
 const gateway={exclusiveSubmit:true,close(){},async requestHttp(op){return{body:op.kind==='identity'?{provider:'synthetic',user_id:principal}:{ok:true,auth_required:true}};},
 async operation(op){calls.push(['operation',op.kind]);if(op.kind==='profilesList')return{profiles:[{name:'agent',display_name:'Agent'}]};
 if(op.kind==='sessionList')return{sessions:[{id:'saved',profile:'agent',title:'Saved chat'},{id:'second',profile:'agent',title:'Second chat'}]};
 if(op.kind==='sessionResume'||op.kind==='sessionCreate')return{session_id:`runtime-${op.storedSessionId??'saved'}`,stored_session_id:op.storedSessionId??'saved',info:{profile_name:'agent'},running:false};
 if(op.kind==='sessionHistory')return{count:1,messages:[{role:'user',text:'Authoritative saved words',row_id:1}]};return{};},
 async submitText(request){calls.push(['submit']);return{jsonrpc:'2.0',id:request.id,result:{status:'streaming'}};}};
 function service(reject=false){return createDesktopService({repository,connect:async options=>{calls.push(['connect']);callbacks=options;if(reject||failConnect)throw Error('Synthetic offline');return gateway;},onChange(){}});}
 return{values,calls,repository,gateway,service,get callbacks(){return callbacks;},set failConnect(value){failConnect=value;},set failCache(value){failCache=value;},set principal(value){principal=value;}};
}
async function prime(f,configuration=host){const service=f.service();assert.equal((await service.handle({kind:'connect',host:configuration})).ok,true);
 assert.equal((await service.handle({kind:'openChat',generation:service.snapshot().generation,chatId:'saved'})).ok,true);
 await until(()=>[...f.values].some(([key,v])=>key.startsWith('display-cache:')&&v.value.data.sessions.some(s=>s.transcript.length)));
 await until(()=>f.values.has('desktop:cacheOwner'));return service;}
async function select(service,id='saved'){return service.handle({kind:'openChat',generation:service.snapshot().generation,chatId:id});}

test('cold relaunch with rejected transport restores exact saved chats read-only and never resends',async()=>{
 const f=fixture(),live=await prime(f);live.dispose();const restored=f.service(true);await restored.initialize();
 let s=restored.snapshot();assert.equal(s.status,'disconnected');assert.equal(s.data.host?.state,'offline');assert.equal(s.data.chats.length,2);
 assert.equal((await select(restored)).ok,true);s=restored.snapshot();assert.equal(s.selectedChatId,'saved');assert.equal(s.canSend,false);assert.equal(s.running,false);assert.deepEqual(s.prompts,[]);assert.equal(s.workspace,null);
 assert.equal(s.data.chats[0].transcript[0].paragraphs[0],'Authoritative saved words');
 for(const action of [{kind:'send',chatId:'saved',text:'Do not send'},{kind:'interrupt',chatId:'saved'},{kind:'draft',chatId:'saved',text:'Do not edit'},{kind:'canonicalChat',profile:'agent',requestId:'offline'},{kind:'newChat',profile:'agent'},{kind:'workspace',profile:'agent',page:'projects'},{kind:'answer',promptId:'absent',answer:'deny'}])assert.equal((await restored.handle({...action,generation:s.generation})).ok,false);
 assert.equal(f.calls.some(c=>c[0]==='submit'),false);assert.equal(JSON.stringify(s).includes(host.token),false);assert.equal(JSON.stringify(s).includes(host.endpoint),false);restored.dispose();
});
test('explicit disconnect permits cached selection after restart while making zero automatic connections',async()=>{
 const f=fixture(),live=await prime(f);await live.handle({kind:'disconnect'});live.dispose();const connects=f.calls.filter(c=>c[0]==='connect').length;
 const restored=f.service();await restored.initialize();assert.equal(f.calls.filter(c=>c[0]==='connect').length,connects);assert.equal((await select(restored)).ok,true);assert.equal(restored.snapshot().canSend,false);restored.dispose();
});
test('changed credential or endpoint cannot infer an offline principal from an old pointer',async()=>{
 for(const changed of [{token:'other-synthetic-token'},{endpoint:'https://other.invalid'},{authentication:'provider'}]){
  const f=fixture(),live=await prime(f);await live.handle({kind:'disconnect'});live.dispose();const saved=f.values.get('desktop:host');f.values.set('desktop:host',{...saved,value:{...saved.value,...changed}});
  const restored=f.service();await restored.initialize();assert.equal(restored.snapshot().data.host,null);assert.equal((await select(restored)).ok,false);restored.dispose();
 }
});
test('network loss publishes only authoritative history, never optimistic rows, streams, prompts or running state',async()=>{
 const f=fixture(),live=await prime(f);let s=live.snapshot();await live.handle({kind:'send',generation:s.generation,chatId:'saved',text:'Unconfirmed optimistic words'});
 f.callbacks.onEvent({kind:'event',params:{session_id:'runtime-saved',type:'message.delta',payload:{text:'Live response words'}}});f.callbacks.onClosed();s=live.snapshot();
 assert.equal(s.running,false);assert.equal(s.canSend,false);assert.equal(JSON.stringify(s.data).includes('optimistic'),false);assert.equal(JSON.stringify(s.data).includes('Live response'),false);assert.equal(s.data.chats[0].transcript[0].paragraphs[0],'Authoritative saved words');assert.equal((await select(live,'second')).ok,true);live.dispose();
});
test('cache write failure cannot turn accepted send into unknown or break journal barriers',async()=>{
 const f=fixture();f.failCache=true;const live=f.service();assert.equal((await live.handle({kind:'connect',host})).ok,true);assert.equal((await select(live)).ok,true);
 const s=live.snapshot();assert.equal((await live.handle({kind:'send',generation:s.generation,chatId:'saved',text:'Synthetic accepted'})).ok,true);
 const phases=f.calls.filter(c=>c[0]==='write'&&c[1].startsWith('journal:')).map(c=>c[2].intents.at(-1).phase);assert.deepEqual(phases,['prepared','dispatched','accepted']);assert.equal(live.snapshot().running,true);live.dispose();
});

test('missing, corrupt and newer cache records are nonfatal and never overwritten',async()=>{
 for(const kind of ['missing','corrupt','newer']){
  const f=fixture(),live=await prime(f);await live.handle({kind:'disconnect'});live.dispose();
  const [key,record]=[...f.values].find(([key])=>key.startsWith('display-cache:'));
  if(kind==='missing')f.values.delete(key);else f.values.set(key,{...record,value:kind==='newer'?{...record.value,version:99}:{bad:'cache'}});
  const preserved=structuredClone(f.values.get(key));const restored=f.service();await restored.initialize();assert.equal(restored.snapshot().data.host,null);
  assert.equal((await restored.handle({kind:'connect',host})).ok,true);assert.equal((await select(restored)).ok,true);assert.equal(restored.snapshot().canSend,true);
  await tick();await tick();if(kind!=='missing')assert.deepEqual(f.values.get(key),preserved);restored.dispose();
 }
});
test('unsupported cache-owner pointers are preserved without affecting live chat',async()=>{
 for(const value of [{version:99},{version:1,unexpected:'corrupt'}]){
  const f=fixture(),live=await prime(f);await live.handle({kind:'disconnect'});live.dispose();f.values.set('desktop:cacheOwner',{revision:50,value});
  const restored=f.service();await restored.initialize();assert.equal(restored.snapshot().data.host,null);assert.equal((await restored.handle({kind:'connect',host})).ok,true);assert.equal((await select(restored)).ok,true);
  await tick();assert.deepEqual(f.values.get('desktop:cacheOwner'),{revision:50,value});restored.dispose();
 }
});
test('delayed old cache load cannot replace a newly connected host or its selection',async()=>{
 const f=fixture(),live=await prime(f);await live.handle({kind:'disconnect'});live.dispose();const read=f.repository.read;let release;
 f.repository.read=key=>key.startsWith('display-cache:')?new Promise(resolve=>{release=()=>resolve(structuredClone(f.values.get(key)));}):read(key);
 const restored=f.service();const startup=restored.initialize();await until(()=>release);
 f.repository.read=read;assert.equal((await restored.handle({kind:'connect',host:{...host,endpoint:'https://new-recovery.invalid',label:'New synthetic host'}})).ok,true);assert.equal((await select(restored,'second')).ok,true);
 release();await startup;const s=restored.snapshot();assert.equal(s.status,'connected');assert.equal(s.data.host.label,'New synthetic host');assert.equal(s.selectedChatId,'second');assert.equal(s.canSend,true);restored.dispose();
});
test('delayed initialization cannot clear a newer offline selection or auto-connect afterward',async()=>{
 const f=fixture(),live=await prime(f);await live.handle({kind:'disconnect'});live.dispose();const restored=f.service();await restored.initialize();
 const read=f.repository.read;let release;f.repository.read=key=>key.startsWith('display-cache:')?new Promise(resolve=>{release=()=>resolve(structuredClone(f.values.get(key)));}):read(key);
 const startup=restored.initialize();await until(()=>release);assert.equal((await select(restored,'second')).ok,true);release();await startup;assert.equal(restored.snapshot().selectedChatId,'second');assert.equal(f.calls.filter(c=>c[0]==='connect').length,1);restored.dispose();
});
test('provider principal replacement retires prior histories under the same credential fingerprint',async()=>{
 const f=fixture(),configuration={...host,authentication:'provider'},live=await prime(f,configuration);
 f.principal='two';const operation=f.gateway.operation;f.gateway.operation=op=>op.kind==='sessionList'?Promise.resolve({sessions:[]}):operation(op);
 assert.equal((await live.handle({kind:'connect',host:configuration})).ok,true);assert.deepEqual(live.snapshot().data.chats,[]);assert.equal(live.snapshot().selectedChatId,null);
 await until(()=>f.calls.filter(c=>c[0]==='write'&&c[1]==='desktop:cacheOwner').length===2);f.callbacks.onClosed();assert.deepEqual(live.snapshot().data.chats,[]);live.dispose();
 const restored=f.service(true);await restored.initialize();assert.equal(restored.snapshot().data.chats.length,0);assert.equal((await select(restored)).ok,false);restored.dispose();
});
test('a held cache write cannot delay or reorder send journals and cannot replace newer same-scope cache data',async()=>{
 const f=fixture(),live=await prime(f);const write=f.repository.write;let release;
 f.repository.write=async(key,revision,value)=>{
  if(key.startsWith('display-cache:')&&!release)await new Promise(resolve=>{release=resolve;});return write(key,revision,value);
 };
 await live.handle({kind:'refresh'});await until(()=>release);const s=live.snapshot();assert.equal((await live.handle({kind:'send',generation:s.generation,chatId:'saved',text:'Unblocked send'})).ok,true);
 const phases=f.calls.filter(c=>c[0]==='write'&&c[1].startsWith('journal:')).map(c=>c[2].intents.at(-1).phase);assert.deepEqual(phases,['prepared','dispatched','accepted']);
 assert.equal((await live.handle({kind:'connect',host})).ok,true);f.gateway.operation=(original=>op=>op.kind==='sessionHistory'?Promise.resolve({count:1,messages:[{row_id:2,role:'assistant',text:'New authoritative words'}]}):original(op))(f.gateway.operation);
 assert.equal((await select(live)).ok,true);release();
 await until(()=>[...f.values].some(([key,record])=>key.startsWith('display-cache:')&&JSON.stringify(record.value).includes('New authoritative words')));
 assert.equal(JSON.stringify([...f.values].find(([key])=>key.startsWith('display-cache:'))[1]).includes('Unblocked send'),false);live.dispose();
});
test('a stale pending cache write and owner update cannot rebind a later saved configuration',async()=>{
 const f=fixture(),live=await prime(f);const write=f.repository.write;let release;
 f.repository.write=async(key,revision,value)=>{if(key==='desktop:cacheOwner'&&!release)await new Promise(resolve=>{release=resolve;});return write(key,revision,value);};
 assert.equal((await live.handle({kind:'connect',host})).ok,true);await until(()=>release);
 const next={...host,endpoint:'https://new-pointer.invalid',token:'new-synthetic-token',label:'New pointer host'};
 assert.equal((await live.handle({kind:'connect',host:next})).ok,true);assert.equal((await select(live)).ok,true);release();
 await until(()=>f.calls.filter(c=>c[0]==='write'&&c[1]==='desktop:cacheOwner').length===3);
 await live.handle({kind:'disconnect'});live.dispose();const connects=f.calls.filter(c=>c[0]==='connect').length,restored=f.service();await restored.initialize();assert.equal(restored.snapshot().data.host?.label,next.label);assert.equal(f.calls.filter(c=>c[0]==='connect').length,connects);restored.dispose();
});
test('cached selection reads saved drafts without changing them or replaying uncertain journals',async()=>{
 const f=fixture(),live=await prime(f);let s=live.snapshot();await live.handle({kind:'draft',generation:s.generation,chatId:'saved',text:'Protected unsent draft'});f.gateway.submitText=async()=>{f.calls.push(['submit']);throw Error('Lost receipt');};
 await live.handle({kind:'send',generation:s.generation,chatId:'saved',text:'Unknown send'});await live.handle({kind:'disconnect'});live.dispose();const before=[...f.values].filter(([key])=>key.startsWith('draft:')||key.startsWith('journal:'));
 const restored=f.service();await restored.initialize();assert.equal((await select(restored)).ok,true);s=restored.snapshot();assert.equal(s.drafts.saved,'Protected unsent draft');assert.equal(s.canSend,false);assert.equal(JSON.stringify(s.data).includes('Unknown send'),false);assert.deepEqual([...f.values].filter(([key])=>key.startsWith('draft:')||key.startsWith('journal:')),before);assert.equal(f.calls.filter(c=>c[0]==='submit').length,1);restored.dispose();
});

test('clean shutdown drains newly observed authoritative history before repository reconstruction',async()=>{
 const f=fixture(),live=f.service();await live.handle({kind:'connect',host});await select(live);await live.shutdown();
 const restored=f.service(true);await restored.initialize();assert.equal((await select(restored)).ok,true);assert.equal(restored.snapshot().data.chats[0].transcript[0].paragraphs[0],'Authoritative saved words');restored.dispose();
});
test('clean shutdown has a bounded cache deadline and rejects further live actions',async()=>{
 const f=fixture(),live=await prime(f);const write=f.repository.write;let release;
 f.repository.write=async(key,revision,value)=>{if(key.startsWith('display-cache:')&&!release)await new Promise(resolve=>{release=resolve;});return write(key,revision,value);};
 await live.handle({kind:'refresh'});await until(()=>release);const closing=live.shutdown();assert.equal((await live.handle({kind:'connect',host})).ok,false);await closing;release();await tick();assert.equal(live.snapshot().canSend,false);assert.equal(live.snapshot().status,'disconnected');
});
test('an older authoritative history response cannot publish or persist over a new selection',async()=>{
 const f=fixture(),live=await prime(f),operation=f.gateway.operation;let release;
 f.gateway.operation=op=>op.kind==='sessionHistory'&&op.runtimeId==='runtime-saved'?new Promise(resolve=>{release=resolve;}):operation(op);
 const first=select(live);await until(()=>release);assert.equal((await select(live,'second')).ok,true);release({count:1,messages:[{role:'user',text:'Stale retired history',row_id:99}]});await first;await live.shutdown();
 assert.equal(JSON.stringify([...f.values].filter(([key])=>key.startsWith('display-cache:'))).includes('Stale retired history'),false);
});

test('shutdown retires callbacks, initialization and a connection still awaiting verified identity',async()=>{
 const f=fixture(),live=await prime(f),request=f.gateway.requestHttp;let release;
 f.gateway.requestHttp=()=>new Promise(resolve=>{release=resolve;});const connecting=live.handle({kind:'connect',host});await until(()=>release);
 const before=f.calls.length;const closed=live.shutdown();f.callbacks.onEvent({kind:'event',params:{session_id:'runtime-saved',type:'session.info',payload:{running:false}}});
 assert.deepEqual(await f.callbacks.onRequest({kind:'request',id:'late',method:'approval',params:{session_id:'runtime-saved'}},new AbortController().signal),{error:{code:-32000,message:'Session unavailable'}});
 await live.initialize();release({body:{ok:true,auth_required:true}});assert.equal((await connecting).ok,false);await closed;assert.equal(f.calls.length,before);assert.equal(live.snapshot().canSend,false);assert.deepEqual(live.snapshot().prompts,[]);f.gateway.requestHttp=request;
});

test('failed reconnect cannot replace newer in-memory authoritative history with an older disk cache',async()=>{
 const f=fixture(),live=await prime(f),write=f.repository.write;let release;
 f.repository.write=async(key,revision,value)=>{if(key.startsWith('display-cache:')&&!release)await new Promise(resolve=>{release=resolve;});return write(key,revision,value);};
 const operation=f.gateway.operation;f.gateway.operation=op=>op.kind==='sessionHistory'?Promise.resolve({count:1,messages:[{row_id:2,role:'assistant',text:'Latest authoritative history'}]}):operation(op);
 await select(live);await until(()=>release);f.callbacks.onClosed();f.failConnect=true;
 assert.equal((await live.handle({kind:'connect',host})).ok,false);assert.equal(live.snapshot().data.chats[0].transcript[0].paragraphs[0],'Latest authoritative history');release();live.dispose();
});
