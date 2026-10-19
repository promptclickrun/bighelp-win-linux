// Hermes text framing only. No JSON-RPC array batches or numeric IDs.
// Source and intentionally narrower policies: docs/evidence/protocol-foundation.md.
export type JsonValue = null | boolean | number | string | JsonObject | readonly JsonValue[];
export type JsonObject = { readonly [key: string]: JsonValue };
export type RpcEvent = Readonly<{ kind: 'event'; params: JsonObject }>;
export type RpcServerRequest = Readonly<{ kind: 'request'; id: string; method: string; params: JsonObject }>;
export type RpcResult = Readonly<{ kind: 'result'; id: string; result: JsonValue }>;
export type RpcFailure = Readonly<{ kind: 'error'; id: string; code: number; message: string; reason?: string }>;
export type RpcFrame = RpcEvent | RpcServerRequest | RpcResult | RpcFailure;
export type ServerReply = Readonly<{ result: unknown }> | Readonly<{ error: { code: number; message: string } }>;

export const RPC_LIMITS = Object.freeze({
  inboundBytes: 4 * 1024 * 1024, lineObjects: 4096, depth: 64,
  methodBytes: 256, idBytes: 1024, messageBytes: 4096,
  outboundBytes: 2 * 1024 * 1024, serverResponseBytes: 2 * 1024 * 1024,
  // Only validated attachment staging may use this larger outbound budget.
  attachmentOutboundBytes: 12 * 1024 * 1024,
});

export class RpcProtocolError extends Error {
  constructor() { super('Invalid or oversized Hermes RPC frame'); this.name = 'RpcProtocolError'; }
}
const invalid = (): never => { throw new RpcProtocolError(); };

// Counts without allocating an encoded copy; rejects malformed UTF-16 as well.
export function boundedString(value: unknown, maximumBytes: number): string {
  if (typeof value !== 'string' || value.length > maximumBytes || !value.isWellFormed()) return invalid();
  let bytes = 0;
  for (const character of value) {
    const code = character.codePointAt(0)!;
    bytes += code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
    if (bytes > maximumBytes) return invalid();
  }
  return value;
}
export function rpcId(value: unknown): string { return boundedString(value, RPC_LIMITS.idBytes); }
export function rpcMethod(value: unknown): string {
  const method = boundedString(value, RPC_LIMITS.methodBytes);
  if (!/^[\x21-\x7e]+$/.test(method)) return invalid();
  return method;
}
export function jsonObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
const has = (value: JsonObject, key: string) => Object.hasOwn(value, key);

// Parse into immutable null-prototype objects. Duplicate decoded keys (including
// escaped aliases) are rejected BEFORE assigning them, at every depth.
function parseLine(text: string): JsonValue {
  let cursor = 0;
  const whitespace = () => { while (/[\x20\t\r]/.test(text[cursor] ?? '\0')) cursor++; };
  function string(): string {
    const start = cursor++;
    while (cursor < text.length) {
      const character = text[cursor++];
      if (character === '\\') { cursor++; continue; }
      if (character === '"') {
        let value: unknown;
        try { value = JSON.parse(text.slice(start, cursor)); } catch { return invalid(); }
        return boundedString(value, RPC_LIMITS.inboundBytes);
      }
    }
    return invalid();
  }
  function value(depth: number): JsonValue {
    whitespace();
    const character = text[cursor];
    if (character === '{' || character === '[') {
      if (depth >= RPC_LIMITS.depth) return invalid();
      cursor++;
      const object: Record<string, JsonValue> = Object.create(null);
      const array: JsonValue[] = [];
      const close = character === '{' ? '}' : ']';
      whitespace();
      if (text[cursor] !== close) {
        while (true) {
          if (character === '{') {
            if (text[cursor] !== '"') return invalid();
            const key = string();
            if (Object.hasOwn(object, key)) return invalid();
            whitespace();
            if (text[cursor++] !== ':') return invalid();
            object[key] = value(depth + 1);
          } else array.push(value(depth + 1));
          whitespace();
          if (text[cursor] === close) break;
          if (text[cursor++] !== ',') return invalid();
          whitespace();
        }
      }
      cursor++;
      return character === '{' ? Object.freeze(object) : Object.freeze(array);
    }
    if (character === '"') return string();
    const start = cursor;
    while (cursor < text.length && !/[\s,\]}]/.test(text[cursor] ?? '')) cursor++;
    const token = text.slice(start, cursor);
    if (token === 'true') return true;
    if (token === 'false') return false;
    if (token === 'null') return null;
    if (!/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(token)) return invalid();
    const number = Number(token);
    if (!Number.isFinite(number) || (Number.isInteger(number) && !Number.isSafeInteger(number))) return invalid();
    return number;
  }
  const result = value(0);
  whitespace();
  if (cursor !== text.length) return invalid();
  return result;
}

function classify(value: JsonValue): RpcFrame {
  if (!jsonObject(value) || value.jsonrpc !== '2.0') return invalid();
  if (has(value, 'method')) {
    const method = rpcMethod(value.method);
    if (has(value, 'result') || has(value, 'error')) return invalid();
    if (method === 'event') {
      if (has(value, 'id') || !jsonObject(value.params)) return invalid();
      const params = value.params;
      if (!boundedString(params.type, RPC_LIMITS.methodBytes)) return invalid();
      if (has(params, 'payload') && !jsonObject(params.payload)) return invalid();
      if (has(params, 'session_id') && params.session_id !== null) boundedString(params.session_id, 4096);
      if (has(params, 'seq') && (typeof params.seq !== 'number' || !Number.isSafeInteger(params.seq))) return invalid();
      if (params.type === 'request.cancel') {
        const payload = params.payload;
        if (!jsonObject(payload) || Object.keys(payload).sort().join(',') !== 'id,method,reason') return invalid();
        rpcId(payload.id); rpcMethod(payload.method); boundedString(payload.reason, RPC_LIMITS.messageBytes);
      }
      return Object.freeze({ kind: 'event', params });
    }
    const id = rpcId(value.id);
    const params = value.params ?? Object.freeze({});
    if (!jsonObject(params)) return invalid();
    return Object.freeze({ kind: 'request', id, method, params });
  }
  const id = rpcId(value.id);
  if (has(value, 'params') || has(value, 'result') === has(value, 'error')) return invalid();
  const result = value.result;
  if (result !== undefined) return Object.freeze({ kind: 'result', id, result });
  const error = value.error;
  if (!jsonObject(error) || typeof error.code !== 'number' || !Number.isSafeInteger(error.code)) return invalid();
  const message = boundedString(error.message, RPC_LIMITS.messageBytes);
  let reason: string | undefined;
  if (jsonObject(error.data) && has(error.data, 'reason')) reason = boundedString(error.data.reason, RPC_LIMITS.messageBytes);
  return Object.freeze({ kind: 'error', id, code: error.code, message, ...(reason === undefined ? {} : { reason }) });
}

// Validate the entire frame before exposing any event, response, or side effect.
export function decodeRpcFrame(input: unknown): readonly RpcFrame[] {
  const text = boundedString(input, RPC_LIMITS.inboundBytes);
  const messages: RpcFrame[] = [];
  let start = 0;
  for (let end = 0; end <= text.length; end++) {
    if (end !== text.length && text[end] !== '\n') continue;
    const line = text.slice(start, end);
    start = end + 1;
    if (/^[\x20\r\t]*$/.test(line)) continue;
    if (messages.length >= RPC_LIMITS.lineObjects) return invalid();
    messages.push(classify(parseLine(line)));
  }
  if (messages.length === 0) return invalid();
  return Object.freeze(messages);
}

// Serialize caller-owned unknown data with a byte budget before allocating the
// full wire string. No toJSON, accessors, unsupported values, or cycles.
export function encodeBoundedJson(input: unknown, maximumBytes: number): string {
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1 || maximumBytes > Math.max(RPC_LIMITS.inboundBytes, RPC_LIMITS.attachmentOutboundBytes)) return invalid();
  let remaining = maximumBytes;
  const chunks: string[] = [];
  const ancestors = new Set<object>();
  function emit(text: string, bytes = text.length) {
    remaining -= bytes;
    if (remaining < 0) return invalid();
    chunks.push(text);
  }
  function string(text: string) {
    boundedString(text, remaining);
    let size = 2;
    for (const character of text) {
      const code = character.codePointAt(0)!;
      size += code < 0x20 ? ('\b\t\n\f\r'.includes(character) ? 2 : 6)
        : character === '"' || character === '\\' ? 2
        : code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
      if (size > remaining) return invalid();
    }
    if (size > remaining) return invalid();
    emit(JSON.stringify(text), size);
  }
  function visit(value: unknown, depth: number) {
    if (value === null) { emit('null'); return; }
    if (typeof value === 'string') { string(value); return; }
    if (typeof value === 'boolean') { emit(String(value)); return; }
    if (typeof value === 'number') {
      if (!Number.isFinite(value) || (Number.isInteger(value) && !Number.isSafeInteger(value))) return invalid();
      emit(String(value)); return;
    }
    if (typeof value !== 'object' || depth >= RPC_LIMITS.depth || ancestors.has(value)) return invalid();
    ancestors.add(value);
    if (Array.isArray(value)) {
      if (value.length > remaining) return invalid();
      emit('[');
      for (let index = 0; index < value.length; index++) {
        if (index) emit(',');
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (!descriptor || !('value' in descriptor)) return invalid();
        visit(descriptor.value, depth + 1);
      }
      emit(']');
    } else {
      if (Object.getPrototypeOf(value) !== null && Object.getPrototypeOf(value) !== Object.prototype) return invalid();
      emit('{');
      let count = 0;
      for (const key in value) {
        if (!Object.hasOwn(value, key)) continue;
        const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
        if (!('value' in descriptor)) return invalid();
        if (count++) emit(',');
        string(key); emit(':'); visit(descriptor.value, depth + 1);
      }
      emit('}');
    }
    ancestors.delete(value);
  }
  visit(input, 0);
  return chunks.join('');
}

export function encodeServerReply(id: string, reply: ServerReply): string {
  rpcId(id);
  const value: unknown = JSON.parse(encodeBoundedJson(reply, RPC_LIMITS.serverResponseBytes));
  if (!jsonObject(value) || Object.keys(value).length !== 1 || (!has(value, 'result') && !has(value, 'error'))) return invalid();
  const text = encodeBoundedJson({ jsonrpc: '2.0', id, ...value }, RPC_LIMITS.serverResponseBytes);
  const frame = decodeRpcFrame(text)[0];
  if (!frame || (frame.kind !== 'result' && frame.kind !== 'error')) return invalid();
  if (frame.kind === 'error' && !frame.message) return invalid();
  return text;
}
