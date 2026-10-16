import { encodeBoundedJson, RPC_LIMITS } from './rpc.ts';
import { contractObject, contractText, coordinate, decodeProfiles, decodeSessionReceipt } from './session.ts';

// Bighelp d62a545: DirectHermesSessionCatalogClient.swift:497,1339-1406,
// 680-778,2113-2174. Hermes 3b2f971: tui_gateway/methods_session.py:514-538.
export type CanonicalRegistry = Readonly<{ id: string; resolvedId: string | null }>;
export type CanonicalReceipt = ReturnType<typeof decodeSessionReceipt>;
export type CanonicalState = Readonly<{
 version: 1; root: string | null;
 phase: 'complete' | 'createRequested' | 'created' | 'titleRequested' | 'awaitingRegistry' | 'titleTaken';
 createdStoredId: string | null;
}>;
export const EMPTY_CANONICAL_STATE: CanonicalState = Object.freeze({version:1,root:null,phase:'complete',createdStoredId:null});
const invalid = (): never => { throw new TypeError('Invalid canonical chat response'); };
function bounded(value: unknown) { encodeBoundedJson(value,RPC_LIMITS.inboundBytes); return contractObject(value); }
function registry(value: unknown): CanonicalRegistry {
 const row=contractObject(value);
 return Object.freeze({id:coordinate(row.id),resolvedId:row.resolved_id===undefined||row.resolved_id===null?null:coordinate(row.resolved_id)});
}
export function decodeCanonicalProfiles(value: unknown, profile: string): CanonicalRegistry | null {
 const profiles=decodeProfiles(value); if(!profiles.some(row=>row.id===profile))return invalid();
 const rows=contractObject(value).profiles as unknown[];
 const row=rows.map(contractObject).find(row=>row.name===profile)!;
 return row.canonical_session===undefined||row.canonical_session===null?null:registry(row.canonical_session);
}
export function decodeCanonicalList(value: unknown, profile: string): CanonicalRegistry | null {
 coordinate(profile); const rows=bounded(value).sessions;
 if(!Array.isArray(rows)||rows.length>1)return invalid();
 if(!rows.length)return null;
 const row=contractObject(rows[0]);
 if(row.title!=='Bot Chat'||(row.profile!==undefined&&row.profile!==profile))return invalid();
 return registry(row);
}
export function decodeCanonicalCreate(value: unknown, profile: string): CanonicalReceipt {
 const row=bounded(value);
 if(row.message_count!==0||!Array.isArray(row.messages)||row.messages.length!==0
  ||contractObject(row.info).profile_name!==profile||row.stored_session_id===undefined)return invalid();
 return decodeSessionReceipt(value,profile);
}
export function decodeCanonicalTitle(value: unknown): void {
 const row=bounded(value); if(row.pending!==false||row.title!=='Bot Chat')return invalid();
}
export function decodeRetiredCanonical(value: unknown, profile: string, storedId: string): boolean {
 const row=bounded(value);
 if(row.id!==storedId||row.profile!==profile||(row.archived!==undefined&&typeof row.archived!=='boolean'))return invalid();
 const title=contractText(row.title,65536,true);
 return row.archived===true||title!=='Bot Chat';
}
export function decodeCanonicalState(value: unknown): CanonicalState {
 if(value===null||value===undefined)return EMPTY_CANONICAL_STATE;
 const row=bounded(value);
 if(Object.keys(row).sort().join(',')!=='createdStoredId,phase,root,version'||row.version!==1
  ||!['complete','createRequested','created','titleRequested','awaitingRegistry','titleTaken'].includes(String(row.phase)))return invalid();
 const root=row.root===null?null:coordinate(row.root), createdStoredId=row.createdStoredId===null?null:coordinate(row.createdStoredId);
 if(['created','titleRequested','awaitingRegistry'].includes(String(row.phase))&&!createdStoredId)return invalid();
 return Object.freeze({version:1,root,phase:row.phase as CanonicalState['phase'],createdStoredId});
}
