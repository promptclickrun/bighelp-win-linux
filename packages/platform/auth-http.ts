// Privileged-only adapter for host discovery and the dedicated sign-in requests.
// Requests and responses here can carry passwords, codes, cookies and tokens:
// never log them, never pass them to IPC, never include them in an error.
// It never follows a redirect and keeps no cookie jar or cache.
export type AuthHttpRequest = Readonly<{
  url: string; method: 'GET' | 'POST'; headers: Readonly<Record<string, string>>; body?: string;
  maxBytes: number; timeoutMs: number;
}>;
export type AuthHttpResponse = Readonly<{
  status: number;
  // Lowercased media type without parameters, or ''.
  contentType: string;
  // The body as strict UTF-8, or null when it is not valid UTF-8.
  text: string | null;
  // Raw Location header of a 3xx, or null. Callers resolve and check it.
  location: string | null;
  setCookie: readonly string[];
  // A proxy or gate in front of Hermes asked for its own credentials.
  challenged: boolean;
}>;
export type AuthHttp = (request: AuthHttpRequest, signal: AbortSignal) => Promise<AuthHttpResponse>;

// sent: 'no' when the request cannot have reached the host (connection refused,
// name not found, certificate rejected); 'maybe' when a reply was lost.
export class AuthHttpError extends Error {
  readonly sent: 'no' | 'maybe';
  readonly tls: boolean;
  constructor(sent: 'no' | 'maybe', tls = false) {
    super('Host request failed'); this.name = 'AuthHttpError'; this.sent = sent; this.tls = tls;
  }
}

const UNSENT = new Set(['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'EHOSTUNREACH', 'ENETUNREACH', 'ENETDOWN',
  'EADDRNOTAVAIL', 'UND_ERR_CONNECT_TIMEOUT']);
function failure(error: unknown): AuthHttpError {
  const cause = error && typeof error === 'object' && 'cause' in error ? (error as { cause: unknown }).cause : undefined;
  const code = cause && typeof cause === 'object' && 'code' in cause && typeof (cause as { code: unknown }).code === 'string'
    ? (cause as { code: string }).code : '';
  const tls = /^(?:ERR_TLS_|ERR_SSL_|CERT_|UNABLE_TO_|DEPTH_ZERO_|SELF_SIGNED_|HOSTNAME_MISMATCH)/u.test(code);
  return new AuthHttpError(UNSENT.has(code) || tls ? 'no' : 'maybe', tls);
}

export async function authHttp(request: AuthHttpRequest, signal: AbortSignal): Promise<AuthHttpResponse> {
  if (!Number.isSafeInteger(request.maxBytes) || request.maxBytes < 1 || request.maxBytes > 1024 * 1024
    || !Number.isSafeInteger(request.timeoutMs) || request.timeoutMs < 100 || request.timeoutMs > 60000) {
    throw new AuthHttpError('no');
  }
  const url = new URL(request.url);
  if ((url.protocol !== 'https:' && url.protocol !== 'http:') || url.username || url.password || url.hash) throw new AuthHttpError('no');
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal.addEventListener('abort', abort, { once: true });
  if (signal.aborted) abort();
  const timer = setTimeout(abort, request.timeoutMs);
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let response: Response;
  try {
    response = await fetch(request.url, { method: request.method, headers: request.headers,
      ...(request.body === undefined ? {} : { body: request.body }), redirect: 'manual', credentials: 'omit',
      signal: controller.signal });
  } catch (error) {
    clearTimeout(timer); signal.removeEventListener('abort', abort);
    throw failure(error);
  }
  try {
    if (response.redirected || response.url !== request.url) throw new AuthHttpError('maybe');
    const length = response.headers.get('content-length');
    if (length !== null && (!/^\d+$/u.test(length) || Number(length) > request.maxBytes)) throw new AuthHttpError('maybe');
    const chunks: Uint8Array[] = []; let size = 0;
    if (response.body) {
      reader = response.body.getReader();
      while (true) {
        const next = await reader.read();
        if (next.done) break;
        size += next.value.byteLength;
        if (size > request.maxBytes || chunks.length >= 65536) throw new AuthHttpError('maybe');
        chunks.push(next.value);
      }
    }
    if (controller.signal.aborted) throw new AuthHttpError('maybe');
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    let text: string | null;
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { text = null; }
    const type = response.headers.get('content-type') ?? '';
    const location = response.status >= 300 && response.status < 400 ? response.headers.get('location') : null;
    return Object.freeze({
      status: response.status, contentType: type.split(';')[0]?.trim().toLowerCase() ?? '', text,
      location, setCookie: Object.freeze([...response.headers.getSetCookie()]),
      challenged: response.headers.has('www-authenticate'),
    });
  } catch (error) {
    controller.abort();
    throw error instanceof AuthHttpError ? error : new AuthHttpError('maybe');
  } finally {
    clearTimeout(timer); signal.removeEventListener('abort', abort);
    try { await reader?.cancel(); } catch { /* Never expose transport exceptions. */ }
  }
}
