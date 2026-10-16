import { decodeRpcFrame, RPC_LIMITS } from '../contracts/rpc.ts';
import type { HttpPlan } from './transport-policy.ts';

// Reuse the RPC scanner for duplicate decoded keys, depth, numbers and Unicode.
// Only JSON whitespace outside strings is folded; invalid literal newlines stay invalid.
function parseJson(text: string): unknown {
  let quoted = false, escaped = false, compact = '';
  for (const character of text) {
    if (!quoted && (character === '\n' || character === '\r')) { compact += ' '; continue; }
    compact += character;
    if (escaped) { escaped = false; continue; }
    if (quoted && character === '\\') { escaped = true; continue; }
    if (character === '"') quoted = !quoted;
  }
  const frame = decodeRpcFrame('{"jsonrpc":"2.0","id":"http","result":' + compact + '}')[0];
  if (!frame || frame.kind !== 'result') throw new Error();
  return frame.result;
}

export async function boundedHttp(plan: HttpPlan, signal: AbortSignal): Promise<unknown> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal.addEventListener('abort', abort, { once: true });
  if (signal.aborted) abort();
  const timer = setTimeout(abort, 20000);
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    if (!Number.isSafeInteger(plan.maxResponseBytes) || plan.maxResponseBytes < 1
        || plan.maxResponseBytes > RPC_LIMITS.inboundBytes - 128) throw new Error();
    const response = await fetch(plan.url, { method: plan.method, headers: plan.headers,
      ...(plan.body === undefined ? {} : { body: plan.body }), redirect: 'error', credentials: 'omit', signal: controller.signal });
    if (response.redirected || response.url !== plan.url || !response.body) throw new Error();
    const length = response.headers.get('content-length');
    if (length !== null && (!/^\d+$/.test(length) || Number(length) > plan.maxResponseBytes)) throw new Error();
    reader = response.body.getReader();
    const chunks: Uint8Array[] = []; let size = 0;
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > plan.maxResponseBytes || chunks.length >= 65536) throw new Error();
      chunks.push(next.value);
    }
    if (controller.signal.aborted) throw new Error();
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    const body = parseJson(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    const headers: Record<string, string> = {};
    for (const key of ['etag', 'x-loopdy-request-id']) {
      const value = response.headers.get(key);
      if (value !== null) { if (value.includes(',')) throw new Error(); headers[key] = value; }
    }
    return Object.freeze({ status: response.status, url: response.url, redirected: false, body, headers: Object.freeze(headers) });
  } catch {
    controller.abort();
    throw new Error('Host request failed or retired');
  } finally {
    clearTimeout(timer); signal.removeEventListener('abort', abort);
    try { await reader?.cancel(); } catch { /* Do not expose transport exceptions. */ }
  }
}
