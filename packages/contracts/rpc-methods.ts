import { boundedString, decodeRpcFrame, encodeBoundedJson, jsonObject, rpcId, RPC_LIMITS, RpcProtocolError } from './rpc.ts';
import type { TextRequest } from '../domain/text-send.ts';

export type ProbeMethod = 'client.capabilities' | 'gateway.capabilities' | 'gateway.ping';
export const SERVER_REQUEST_METHODS = Object.freeze([
  'approval', 'clarify', 'secret', 'sudo', 'mcp.setup', 'vault.code', 'vault.save_login', 'vault.unlock_prompt',
] as const);
export type ServerRequestMethod = typeof SERVER_REQUEST_METHODS[number];

// Finite wire operations, for the privileged connection only. Not an IPC API.
export function encodeProbe(id: string, method: ProbeMethod): string {
  rpcId(id);
  if (method !== 'client.capabilities' && method !== 'gateway.capabilities' && method !== 'gateway.ping') {
    throw new RpcProtocolError();
  }
  return encodeBoundedJson({ jsonrpc: '2.0', id, method,
    params: method === 'client.capabilities' ? { server_requests: true } : {},
  }, RPC_LIMITS.outboundBytes);
}

// Consume the existing durably prepared domain request; never add/rewrite its ID.
export function encodeTextRequest(input: TextRequest): string {
  const text = encodeBoundedJson(input, RPC_LIMITS.outboundBytes);
  const value: unknown = JSON.parse(text);
  if (!jsonObject(value) || Object.keys(value).sort().join(',') !== 'id,jsonrpc,method,params'
    || value.jsonrpc !== '2.0' || value.method !== 'prompt.submit' || !jsonObject(value.params)
    || Object.keys(value.params).sort().join(',') !== 'profile,session_id,text') throw new RpcProtocolError();
  rpcId(value.id);
  for (const identity of [value.params.session_id, value.params.profile]) {
    if (!boundedString(identity, 4096).trim()) throw new RpcProtocolError();
  }
  boundedString(value.params.text, 1024 * 1024);
  // Reuse the envelope parser, including ambiguity and depth validation.
  decodeRpcFrame(text);
  return text;
}

export function parseGatewayCapabilities(input: unknown): Readonly<{ perSessionExclusiveSubmit: boolean }> {
  if (!jsonObject(input) || typeof input.per_session_exclusive_submit !== 'boolean') throw new RpcProtocolError();
  return Object.freeze({ perSessionExclusiveSubmit: input.per_session_exclusive_submit });
}
