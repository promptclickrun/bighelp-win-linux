import {encodeBoundedJson,RPC_LIMITS,RpcProtocolError} from './rpc.ts';
import {contractObject,contractText} from './session.ts';
import {encodeSecureAnswer,isSecureMethod,parseSecurePrompt,secureAlertText} from './secure-prompts.ts';
import type {SecurePrompt} from './secure-prompts.ts';
const fail=():never=>{throw new RpcProtocolError();};
export type ApprovalChoice='once'|'session'|'always'|'deny';
export type InteractiveQuestion=Readonly<{id:string;question:string;choices:readonly string[];multiSelect:boolean;lockedAnswer?:string}>;
export type InteractivePrompt=Readonly<{kind:'approval';runtimeId:string;requestId:string;choices:readonly ApprovalChoice[];command?:string;description?:string;toolName?:string}>|Readonly<{kind:'clarify';runtimeId:string;isBatch:boolean;questions:readonly InteractiveQuestion[]}>|SecurePrompt;
const parsed=new WeakSet<object>();
function optional(value:unknown,max:number):string|undefined{return value===undefined?undefined:contractText(value,max,true);}
function question(value:unknown,id:string,lockedAnswer?:string):InteractiveQuestion {
 const row=contractObject(value);const raw=row.choices??[];if(!Array.isArray(raw)||raw.length>12)return fail();
 const choices=raw.map(v=>contractText(v,10000));if(new Set(choices).size!==choices.length)return fail();
 const multi=row.multi_select??false;if(typeof multi!=='boolean'||(multi&&!choices.length))return fail();
 return Object.freeze({id,question:contractText(row.question,65536),choices:Object.freeze(choices),multiSelect:multi,...(lockedAnswer===undefined?{}:{lockedAnswer})});
}
export function parseInteractivePrompt(method:string,params:unknown,runtimeId:string):InteractivePrompt {
 encodeBoundedJson(params,RPC_LIMITS.inboundBytes);contractText(runtimeId,4096);const row=contractObject(params);if(contractText(row.session_id,4096)!==runtimeId)return fail();let result:InteractivePrompt;
 if(method==='approval'){
 const raw=row.choices;if(!Array.isArray(raw)||!raw.length||raw.length>16)return fail();
 const choices:ApprovalChoice[]=[];for(const choice of raw){if((choice==='once'||choice==='session'||choice==='always'||choice==='deny')&&!choices.includes(choice))choices.push(choice);}
 if(!choices.length)return fail();for(const key of ['allow_permanent','allow_session','smart_denied'])if(Object.hasOwn(row,key)&&typeof row[key]!=='boolean')return fail();
 optional(row.gateway_session_id,4096);const command=optional(row.command,65536),description=optional(row.description,65536),toolName=optional(row.tool_name,4096);
 result=Object.freeze({kind:'approval',runtimeId,requestId:contractText(row.request_id,4096),choices:Object.freeze(choices),...(command===undefined?{}:{command}),...(description===undefined?{}:{description}),...(toolName===undefined?{}:{toolName})});
 }else if(method==='clarify'){
 const single=row.question!=null,batch=row.questions!=null;if(single===batch)return fail();let questions:InteractiveQuestion[];
 if(single){if(row.answers!=null)return fail();questions=[question(row,'$single')];}
 else{if(!Array.isArray(row.questions)||!row.questions.length||row.questions.length>10)return fail();const locked=row.answers===undefined?{}:contractObject(row.answers);if(Object.keys(locked).length>5)return fail();
 for(const [id,answer]of Object.entries(locked)){contractText(id,4096);contractText(answer,10000);}
 questions=row.questions.map(value=>{const obj=contractObject(value);const id=contractText(obj.qid,4096);return question(obj,id,Object.hasOwn(locked,id)?contractText(locked[id],10000):undefined);});
 if(new Set(questions.map(q=>q.id)).size!==questions.length||Object.keys(locked).some(id=>!questions.some(q=>q.id===id)))return fail();}
 result=Object.freeze({kind:'clarify',runtimeId,isBatch:batch,questions:Object.freeze(questions)});
 }else if(isSecureMethod(method))result=parseSecurePrompt(method,row,runtimeId);
 else return fail();
 parsed.add(result);return result;
}
function answer(question:InteractiveQuestion,value:unknown):string {
 const text=contractText(value,10000);if(question.lockedAnswer!==undefined){if(text!==question.lockedAnswer)return fail();return text;}
 if(!question.multiSelect)return text;
 let selected:unknown;try{selected=JSON.parse(text);}catch{return text;}
 // Stock UI also accepts typed Other text, including strings that aren't string arrays.
 if(!Array.isArray(selected)||selected.some(v=>typeof v!=='string'))return text;
 if(!selected.length||selected.length>question.choices.length+1)return fail();const values=selected.map(v=>contractText(v,10000));
 if(new Set(values).size!==values.length||values.filter(v=>!question.choices.includes(v)).length>1)return fail();return contractText(JSON.stringify(values),10000);
}
export function encodeInteractiveAnswer(prompt:InteractivePrompt,value:unknown):Readonly<{choice:ApprovalChoice;all:false}>|Readonly<{answer:string}>|Readonly<{answers:Readonly<Record<string,string>>}>|Readonly<{value:string}> {
 if(!parsed.has(prompt))return fail();
 if(prompt.kind==='secure')return encodeSecureAnswer(prompt,value);
 if(prompt.kind==='approval'){if(!prompt.choices.includes(value as ApprovalChoice))return fail();return Object.freeze({choice:value as ApprovalChoice,all:false});}
 if(!prompt.isBatch)return Object.freeze({answer:answer(prompt.questions[0]!,value)});
 encodeBoundedJson(value,RPC_LIMITS.outboundBytes);const submitted=contractObject(value);if(Object.keys(submitted).length!==prompt.questions.length)return fail();
 const answers:Record<string,string>=Object.create(null);for(const q of prompt.questions){if(!Object.hasOwn(submitted,q.id))return fail();answers[q.id]=answer(q,submitted[q.id]);}
 return Object.freeze({answers:Object.freeze(answers)});
}
// Server-request methods this build answers; others are refused with -32601.
export function isInteractivePromptMethod(method:string):boolean{return method==='approval'||method==='clarify'||isSecureMethod(method);}
// Words for an OS notification about a waiting prompt. Never an answer or a typed value.
export function promptAlert(prompt:InteractivePrompt):Readonly<{kind:'approval'|'question';text:string}>{
 if(prompt.kind==='approval')return{kind:'approval',text:prompt.description??prompt.command??''};
 return{kind:'question',text:prompt.kind==='clarify'?prompt.questions[0]?.question??'':secureAlertText(prompt)};
}
