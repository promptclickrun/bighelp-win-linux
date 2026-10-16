import { decodeCanonicalCreate, decodeCanonicalList, decodeCanonicalProfiles, decodeCanonicalState, decodeCanonicalTitle, decodeRetiredCanonical } from '../contracts/canonical-chat.ts';
import type { CanonicalReceipt, CanonicalRegistry, CanonicalState } from '../contracts/canonical-chat.ts';
import { decodeSessionReceipt } from '../contracts/session.ts';
import type { DesktopRpcOperation } from '../contracts/session.ts';
import { parseWorkspaceOwner, sameWorkspaceOwner } from '../contracts/workspace.ts';
import type { WorkspaceOwner } from '../contracts/workspace.ts';
import { GatewayOperationError } from './gateway.ts';

export type CanonicalFailure = 'owner-changed' | 'canonical-missing' | 'creation-unconfirmed' | 'title-taken';
export class CanonicalChatError extends Error {
 readonly kind: CanonicalFailure;
 constructor(kind: CanonicalFailure) { super(kind); this.kind=kind; this.name='CanonicalChatError'; }
}
// Main-only finite capabilities. Durable state is encrypted and keyed by stable
// host/principal/profile by the caller, independent of the connection generation.
export function createCanonicalChatClient(adapters: Readonly<{
 owner: WorkspaceOwner; currentOwner(): WorkspaceOwner | null;
 operation(operation: DesktopRpcOperation): Promise<unknown>;
 sessionDetail?(storedSessionId: string): Promise<unknown>;
 readState(): Promise<unknown>; saveState(state: CanonicalState): Promise<void>;
}>) {
 const owner=parseWorkspaceOwner(adapters.owner), profile=owner.profileId;
 function current() { if(!sameWorkspaceOwner(owner,adapters.currentOwner()))throw new CanonicalChatError('owner-changed'); }
 async function call<T>(operation:()=>Promise<T>):Promise<T> { current(); const result=await operation(); current(); return result; }
 const rpc=(operation:DesktopRpcOperation)=>call(()=>adapters.operation(operation));
 const save=(state:CanonicalState)=>call(()=>adapters.saveState(state));
 const lookup=async()=>decodeCanonicalList(await rpc({kind:'canonicalSessionList',profile}),profile);
 async function resume(id:string):Promise<CanonicalReceipt> { return decodeSessionReceipt(await rpc({kind:'sessionResume',profile,storedSessionId:id}),profile); }
 let resolving=false;
 return Object.freeze({async resolve():Promise<Readonly<{root:string;receipt:CanonicalReceipt}>> {
  current(); if(resolving)throw new CanonicalChatError('creation-unconfirmed'); resolving=true;
  try {
   let state=decodeCanonicalState(await call(adapters.readState));
   async function open(found:CanonicalRegistry, resumed?:CanonicalReceipt) {
    // Resume the root, not a guessed latest chat. Hermes supplies the compaction tip.
    await save({version:1,root:found.id,phase:'complete',createdStoredId:null});
    return Object.freeze({root:found.id,receipt:resumed??await resume(found.id)});
   }
   const projected=decodeCanonicalProfiles(await rpc({kind:'profilesList'}),profile);
   const found=projected??await lookup();
   if(found)return await open(found);
   if(state.root) {
    // Source: resolveCanonicalChat/isRetiredBotChat:515-530 and detail:2018.
    // Missing lookup alone never authorizes replacement. Confirm deliberate
    // archival/rename on that exact profile and stored root first.
    let retired=false;
    try {
     if(adapters.sessionDetail)retired=decodeRetiredCanonical(await call(()=>adapters.sessionDetail!(state.root!)),profile,state.root);
    } catch { current(); }
    if(!retired)throw new CanonicalChatError('canonical-missing');
    state={version:1,root:null,phase:'complete',createdStoredId:null}; await save(state);
   }
   if(state.phase==='titleTaken')throw new CanonicalChatError('title-taken');
   if(state.phase!=='complete'&&state.phase!=='created')throw new CanonicalChatError('creation-unconfirmed');
   // createFirstCanonicalChat rechecks the registry after discovery. Another
   // client may have registered the canonical chat while we loaded state.
   const rechecked=await lookup(); if(rechecked)return await open(rechecked);
   let receipt:CanonicalReceipt;
   if(state.phase==='created')receipt=await resume(state.createdStoredId!);
   else {
    state={version:1,root:null,phase:'createRequested',createdStoredId:null}; await save(state);
    receipt=decodeCanonicalCreate(await rpc({kind:'canonicalSessionCreate',profile}),profile);
    state={...state,phase:'created',createdStoredId:receipt.storedSessionId}; await save(state);
   }
   state={...state,phase:'titleRequested'}; await save(state);
   try { decodeCanonicalTitle(await rpc({kind:'canonicalSessionTitle',runtimeId:receipt.runtimeId})); }
   catch(error) {
    current();
    if(!(error instanceof GatewayOperationError)||error.code!==4022)throw error;
    // Exact source collision recovery only. A generic failure never reaches this path.
    const winner=await lookup(); if(winner)return await open(winner);
    try {
     const holder=await resume('Bot Chat');
     const resolved=await open({id:holder.storedSessionId,resolvedId:null},holder);
     // Source cleanup is restricted to this acknowledged empty creation. Never
     // delete the winner, and never repeat an uncertain cleanup mutation.
     if(state.createdStoredId!==holder.storedSessionId) {
      try { await rpc({kind:'canonicalSessionDiscard',profile,storedSessionId:state.createdStoredId!}); } catch { current(); }
     }
     return resolved;
    } catch(missing) {
     current();
     if(missing instanceof GatewayOperationError&&missing.code===4007) {
      await save({...state,phase:'titleTaken'});
      try { await rpc({kind:'canonicalSessionDiscard',profile,storedSessionId:state.createdStoredId!}); } catch { current(); }
      throw new CanonicalChatError('title-taken');
     }
     throw missing;
    }
   }
   state={...state,phase:'awaitingRegistry'}; await save(state);
   const registered=await lookup(); if(!registered)throw new CanonicalChatError('creation-unconfirmed');
   return await open(registered);
  } finally { resolving=false; }
 }});
}
