import http from 'node:http';
import { Readable } from 'node:stream';

/**
 * Test-only `fetch` that sends every request to 127.0.0.1 while keeping the
 * original Host header, so fixture hostnames like frame-ok.test work without
 * real DNS. Errors are wrapped like Node's built-in fetch (TypeError with a
 * `cause` carrying the socket error code). Never used in production.
 */
export function localFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const url = new URL(input);
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = { host: url.host };
    new Headers(init.headers).forEach((value, key) => (headers[key] = value));
    const req = http.request(
      { host: '127.0.0.1', port: url.port || 80, path: `${url.pathname}${url.search}`, method: init.method ?? 'GET', headers, signal: init.signal ?? undefined },
      (res) => {
        const status = res.statusCode ?? 500;
        const responseHeaders = new Headers();
        for (const [key, value] of Object.entries(res.headers)) {
          if (value === undefined) continue;
          for (const v of Array.isArray(value) ? value : [value]) responseHeaders.append(key, v);
        }
        const nullBody = status === 204 || status === 304;
        if (nullBody) res.resume();
        const body = nullBody ? null : (Readable.toWeb(res) as unknown as ReadableStream<Uint8Array>);
        resolve(new Response(body, { status, headers: responseHeaders }));
      },
    );
    req.on('error', (err) => reject(init.signal?.aborted ? err : new TypeError('fetch failed', { cause: err })));
    req.end();
  });
}
