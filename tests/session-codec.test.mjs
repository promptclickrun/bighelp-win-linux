import test from 'node:test';
import assert from 'node:assert/strict';
import {encodeSessionOperation,decodeProfiles,decodeSessionList,decodeSessionReceipt,decodeSessionHistory} from '../packages/contracts/session.ts';
test('finite source-backed session requests',()=>{
 assert.deepEqual(JSON.parse(encodeSessionOperation('1',{kind:'projectsList',profile:'p'})),{jsonrpc:'2.0',id:'1',method:'projects.list',params:{profile:'p'}});
 assert.deepEqual(JSON.parse(encodeSessionOperation('1',{kind:'sessionResume',profile:'p',storedSessionId:'saved'})).params,{session_id:'saved',profile:'p',source:'bighelp',close_on_disconnect:false,defer_history:true,omit_messages:true});
 assert.throws(()=>encodeSessionOperation('1',{kind:'arbitrary'}));
 assert.throws(()=>encodeSessionOperation('1',{kind:'sessionList',profile:''}));
});
test('catalog identities and receipt aliases are bounded and unique',()=>{
 assert.deepEqual(decodeProfiles({profiles:[{name:'p',display_name:'P',new_field:true}]}),[{id:'p',name:'P',summary:''}]);
 assert.equal(decodeSessionList({sessions:[{id:'old',resolved_id:'new'}]},'p')[0].id,'new');
 assert.throws(()=>decodeProfiles({profiles:[{name:'p'},{name:'p'}]}));
 assert.deepEqual(decodeSessionReceipt({session_id:'live',info:{profile_name:'p'},stored_session_id:'saved',running:true},'p'),{runtimeId:'live',storedSessionId:'saved',running:true,openRequests:[]});
 for(const value of [{session_id:'live',info:{},resumed:'a',session_key:'b'},{session_id:'live',info:{profile_name:'other'},resumed:'a'},{session_id:'live',resumed:'a'},{session_id:'live',info:{},resumed:'a',running:'yes'}]) assert.throws(()=>decodeSessionReceipt(value,'p'));
});
test('RPC history uses role/text and count, never REST content',()=>{
 assert.deepEqual(decodeSessionHistory({count:3,messages:[{role:'user',text:'hi',row_id:1},{role:'assistant',text:'hello'},{role:'tool',context:'inert'}]}),[{id:'row:1',role:'user',text:'hi'},{id:'position:1',role:'assistant',text:'hello'}]);
 assert.throws(()=>decodeSessionHistory({count:2,messages:[]}));
 assert.throws(()=>decodeSessionHistory({count:0,messages:[],data:[]}));
 assert.throws(()=>decodeSessionHistory({count:2,messages:[{role:'user',row_id:1},{role:'assistant',row_id:1}]}));
});
test('resume receipt validates entire open request snapshot and runtime before publication',()=>{
 const request={id:'approval-1',method:'approval',params:{session_id:'live',request_id:'decision',choices:['deny']}};
 const receipt=requests=>({session_id:'live',info:{},session_key:'stored',open_requests:requests});
 assert.deepEqual(JSON.parse(JSON.stringify(decodeSessionReceipt(receipt([request]),'default').openRequests)),[request]);
 for(const requests of [null,{},[request,request],[{...request,params:{session_id:'wrong'}}],[{...request,jsonrpc:'2.0'}],[{id:'reply',result:true}],[{id:'event',method:'event',params:{session_id:'live',type:'approval'}}],Array.from({length:65},(_,i)=>({...request,id:String(i)}))])assert.throws(()=>decodeSessionReceipt(receipt(requests),'default'),/Invalid or oversized Hermes RPC frame/);
});
