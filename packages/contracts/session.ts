import { boundedString, decodeRpcFrame, encodeBoundedJson, jsonObject, RpcProtocolError, rpcId, RPC_LIMITS } from './rpc.ts';
import type { JsonObject } from './rpc.ts';
import { catalogAgent, decodeProfileRoster } from './agents.ts';
import type { CatalogAgent } from './agents.ts';
const fail = (): never => { throw new RpcProtocolError(); };
export function contractText(value: unknown, max = 512, empty = false): string {
 const text = boundedString(value,max); if ((!empty && !text) || text.includes('\0')) return fail(); return text;
}
export function coordinate(value: unknown): string { const text=contractText(value); if(text.trim()!==text||/[\u0000-\u001f\u007f-\u009f]/.test(text))return fail();return text; }
export function contractObject(value: unknown): Record<string, unknown> { if (!jsonObject(value)) return fail(); return value; }
function bounded(value: unknown) { encodeBoundedJson(value,RPC_LIMITS.inboundBytes); return contractObject(value); }
export type DesktopRpcOperation = Readonly<
 {kind:'profilesList'} | {kind:'sessionList'|'sessionCreate'|'projectsList'|'canonicalSessionList'|'canonicalSessionCreate';profile:string} |
 {kind:'canonicalSessionTitle';runtimeId:string} |
 {kind:'canonicalSessionDiscard';profile:string;storedSessionId:string} |
 {kind:'sessionResume';profile:string;storedSessionId:string} |
 {kind:'sessionHistory'|'sessionInterrupt';profile:string;runtimeId:string}>;
export function encodeSessionOperation(id:string, operation:DesktopRpcOperation):string {
 rpcId(id); if(!id) return fail(); const op=contractObject(operation); let method:string; let params:Record<string,unknown>;
 switch(op.kind) {
 case 'profilesList':method='profiles.list';params={include_sessions:false};break;
 case 'projectsList':method='projects.list';params={profile:coordinate(op.profile)};break;
 case 'sessionList':method='session.list';params={profile:coordinate(op.profile),limit:200};break;
 case 'canonicalSessionList':method='session.list';params={profile:coordinate(op.profile),title:'Bot Chat',include_hidden:true,limit:200};break;
 case 'canonicalSessionCreate':method='session.create';params={profile:coordinate(op.profile),source:'bighelp',close_on_disconnect:false,title:'Bot Chat',hidden:true,follow_profile_config:true};break;
 case 'canonicalSessionTitle':method='session.title';params={session_id:coordinate(op.runtimeId),title:'Bot Chat'};break;
 case 'canonicalSessionDiscard':method='session.delete';params={session_id:coordinate(op.storedSessionId),profile:coordinate(op.profile)};break;
 case 'sessionCreate':method='session.create';params={profile:coordinate(op.profile),source:'bighelp',close_on_disconnect:false};break;
 case 'sessionResume':method='session.resume';params={session_id:coordinate(op.storedSessionId),profile:coordinate(op.profile),source:'bighelp',close_on_disconnect:false,defer_history:true,omit_messages:true};break;
 case 'sessionHistory':case 'sessionInterrupt':method=op.kind==='sessionHistory'?'session.history':'session.interrupt';params={session_id:coordinate(op.runtimeId),profile:coordinate(op.profile)};break;
 default:return fail();
 }
 return encodeBoundedJson({jsonrpc:'2.0',id,method,params},RPC_LIMITS.outboundBytes);
}
function rows(value:unknown,max:number):readonly unknown[] { if(!Array.isArray(value)||value.length>max) return fail();return value; }
function display(value:unknown,fallback='',max=65536):string { return typeof value==='string'?contractText(value,max,true)||fallback:fallback; }
function unique<T extends {id:string}>(items:T[]):readonly Readonly<T>[] { if(new Set(items.map(x=>x.id)).size!==items.length) return fail();return Object.freeze(items.map(x=>Object.freeze(x))); }
// Shown name: ui_meta["hermes-bots"].title, then display_name, then the ID (packages/contracts/agents.ts).
export function decodeProfiles(value:unknown):readonly CatalogAgent[] {
 return Object.freeze(decodeProfileRoster(value).map(catalogAgent));
}
export function decodeSessionList(value:unknown,profile:string):readonly Readonly<{id:string;profile:string;title:string;preview:string}>[] {
 coordinate(profile);const obj=bounded(value);return unique(rows(obj.sessions,200).map(value=>{const row=contractObject(value);coordinate(row.id);if(row.profile!==undefined&&row.profile!==profile)return fail();return {id:coordinate(row.resolved_id??row.id),profile,title:display(row.title,'Untitled chat'),preview:display(row.preview)};}));
}
export type OpenServerRequest = Readonly<{id:string;method:string;params:JsonObject}>;
// Hermes snapshots omit jsonrpc; validate the entire snapshot before dispatch.
export function decodeOpenRequests(value:unknown,runtimeId:string):readonly OpenServerRequest[] {
 coordinate(runtimeId);
 const wire=encodeBoundedJson(value,RPC_LIMITS.inboundBytes);
 const copied:unknown=JSON.parse(wire);
 const requests=rows(copied,64).map(value=>{
  const row=contractObject(value);
  if(Object.keys(row).sort().join(',')!=='id,method,params')return fail();
  const frame=decodeRpcFrame(encodeBoundedJson({jsonrpc:'2.0',...row},RPC_LIMITS.inboundBytes))[0];
  if(!frame||frame.kind!=='request'||frame.params.session_id!==runtimeId)return fail();
  return Object.freeze({id:frame.id,method:frame.method,params:frame.params});
 });
 if(new Set(requests.map(request=>request.id)).size!==requests.length)return fail();
 return Object.freeze(requests);
}
export function decodeSessionReceipt(value:unknown,profile:string):Readonly<{runtimeId:string;storedSessionId:string;running:boolean;openRequests:readonly OpenServerRequest[]}> {
 coordinate(profile);const row=bounded(value);const info=contractObject(row.info);if(info.profile_name!==undefined&&info.profile_name!==profile)return fail();
 const aliases=['stored_session_id','session_key','resumed'].filter(key=>Object.hasOwn(row,key)).map(key=>coordinate(row[key]));
 if(!aliases.length||new Set(aliases).size!==1||(row.running!==undefined&&typeof row.running!=='boolean'))return fail();
 return Object.freeze({runtimeId:coordinate(row.session_id),storedSessionId:aliases[0]!,running:row.running===true,openRequests:decodeOpenRequests(row.open_requests===undefined?[]:row.open_requests,coordinate(row.session_id))});
}
export function decodeSessionHistory(value:unknown):readonly Readonly<{id:string;role:string;text:string}>[] {
 const obj=bounded(value);if(Object.keys(obj).sort().join(',')!=='count,messages')return fail();const messages=rows(obj.messages,10000);
 if(!Number.isSafeInteger(obj.count)||obj.count!==messages.length)return fail();
 const all=unique(messages.map((value,index)=>{const row=contractObject(value);const role=contractText(row.role,64);let id=`position:${index}`;
 if(row.row_id!==undefined){if(typeof row.row_id!=='number'||!Number.isSafeInteger(row.row_id)||row.row_id<0)return fail();id=`row:${row.row_id}`;}
 return {id,role,text:display(row.text,'',1024*1024)};}));
 return Object.freeze(all.filter(row=>(row.role==='user'||row.role==='assistant')&&row.text.length>0));
}
