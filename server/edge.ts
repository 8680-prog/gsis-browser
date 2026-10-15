import { promises as dns } from 'node:dns';
import { isPublicAddress, isPublicHostname, isIpLiteral, type AddressPolicy } from './addressPolicy.js';
import {
  ACCEPT_HEADER,
  DEFAULT_LIMITS,
  InspectError,
  JSON_HEADERS,
  MESSAGES,
  USER_AGENT,
  checkInspectRequest,
  createRateLimiter,
  decodeBody,
  describeResponse,
  extractTitle,
  hostOf,
  nextRedirect,
  validateTarget,
  wantsTitle,
  type InspectResult,
} from './core.js';

/**
 * Web-standard embed inspector for Cloudflare Pages Functions (Workers
 * runtime). It is also used by `vite dev`/`vite preview`, so local testing runs
 * the same code path as production.
 *
 * Differences from the Node version (server/inspect.ts), forced by the
 * Workers runtime:
 *  - `dns.lookup` and custom socket lookups are not available, so the
 *    resolved addresses cannot be pinned for the connection. Every hostname
 *    (including each redirect hop) is resolved with `dns.resolve4/resolve6`
 *    (DNS over HTTPS on Workers) and refused if any address is non-public;
 *    `fetch` then resolves the name again itself. Workers cannot fetch raw IP
 *    addresses and do not run inside a private network, which limits what a
 *    DNS-rebinding attempt could reach, but it is not the same guarantee as
 *    pinning.
 *  - Error details are coarser: the Workers `fetch` does not expose socket
 *    error codes, so refused/TLS errors may be reported as "network".
 */

export type AddressResolver = (hostname: string) => Promise<string[]>;
export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export interface EdgePolicy extends AddressPolicy {
  resolve: AddressResolver;
  fetch: FetchLike;
  timeoutMs: number;
  maxBodyBytes: number;
  maxRedirects: number;
}

/** Resolves A and AAAA records. On Workers this uses DNS over HTTPS (nodejs_compat). */
export const dnsResolver: AddressResolver = async (hostname) => {
  const [v4, v6] = await Promise.allSettled([dns.resolve4(hostname), dns.resolve6(hostname)]);
  const addresses = [...(v4.status === 'fulfilled' ? v4.value : []), ...(v6.status === 'fulfilled' ? v6.value : [])];
  if (addresses.length === 0) throw new InspectError('dns', MESSAGES.dns);
  return addresses;
};

export const DEFAULT_EDGE_POLICY: EdgePolicy = {
  resolve: dnsResolver,
  // Wrapped so `fetch` is always called unbound, as the Workers runtime requires.
  fetch: (input, init) => fetch(input, init),
  isAddressAllowed: isPublicAddress,
  isHostnameAllowed: isPublicHostname,
  allowedPorts: [80, 443],
  ...DEFAULT_LIMITS,
};

function withAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(new InspectError('timeout', MESSAGES.timeout));
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(new InspectError('timeout', MESSAGES.timeout));
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (v) => {
        signal.removeEventListener('abort', onAbort);
        resolve(v);
      },
      (e) => {
        signal.removeEventListener('abort', onAbort);
        reject(e);
      },
    );
  });
}

/** Refuses hostnames that resolve to any non-public address. */
async function checkResolution(url: URL, policy: EdgePolicy, signal: AbortSignal): Promise<void> {
  const host = hostOf(url);
  if (isIpLiteral(host)) return; // already validated by validateTarget
  let addresses: string[];
  try {
    addresses = await withAbort(policy.resolve(host), signal);
  } catch (err) {
    if (err instanceof InspectError) throw err;
    throw new InspectError('dns', MESSAGES.dns);
  }
  if (addresses.length === 0) throw new InspectError('dns', MESSAGES.dns);
  if (addresses.some((ip) => !policy.isAddressAllowed(ip))) throw new InspectError('blocked_target', MESSAGES.privateResolution);
}

async function readLimited(res: Response, limit: number): Promise<Uint8Array> {
  if (!res.body) return new Uint8Array();
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (size < limit) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      size += value.byteLength;
    }
  } catch {
    // A truncated body only means we may not find a title.
  } finally {
    reader.cancel().catch(() => {});
  }
  const out = new Uint8Array(Math.min(size, limit));
  let offset = 0;
  for (const chunk of chunks) {
    const part = chunk.subarray(0, out.length - offset);
    out.set(part, offset);
    offset += part.length;
    if (offset >= out.length) break;
  }
  return out;
}

function classifyFetchError(err: unknown, signal: AbortSignal): InspectError {
  if (err instanceof InspectError) return err;
  if (signal.aborted) return new InspectError('timeout', MESSAGES.timeout);
  const e = err as Error & { cause?: { code?: string; message?: string } };
  if (e?.name === 'AbortError' || e?.name === 'TimeoutError') return new InspectError('timeout', MESSAGES.timeout);
  const code = e?.cause?.code ?? '';
  const text = `${e?.message ?? ''} ${e?.cause?.message ?? ''}`;
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return new InspectError('dns', MESSAGES.dns);
  if (code === 'ECONNREFUSED' || code === 'ECONNRESET' || code === 'EHOSTUNREACH' || code === 'ENETUNREACH') {
    return new InspectError('refused', MESSAGES.refused);
  }
  if (/CERT|TLS|SSL/i.test(code) || /certificate|ssl|tls/i.test(text)) {
    return new InspectError('tls', "The site's secure connection could not be verified.");
  }
  return new InspectError('network', `The site could not be reached (${code || e?.message || 'network error'}).`);
}

export async function inspectUrlEdge(rawUrl: string, ancestorOrigin: string, policy: EdgePolicy = DEFAULT_EDGE_POLICY): Promise<InspectResult> {
  const controller = new AbortController();
  const deadline = setTimeout(() => controller.abort(), policy.timeoutMs);
  const { signal } = controller;
  try {
    let url = validateTarget(rawUrl, policy);
    let redirects = 0;

    for (;;) {
      await checkResolution(url, policy, signal);
      const res = await policy.fetch(url.toString(), {
        method: 'GET',
        redirect: 'manual', // every hop is re-validated below
        signal,
        headers: { 'user-agent': USER_AGENT, accept: ACCEPT_HEADER, 'accept-language': 'en-US,en;q=0.8' },
      });
      const location = res.headers.get('location');

      if (res.status >= 300 && res.status < 400 && location) {
        await res.body?.cancel().catch(() => {});
        url = nextRedirect(location, url, redirects, policy);
        redirects += 1;
        continue;
      }

      const contentType = res.headers.get('content-type');
      let title: string | null = null;
      if (wantsTitle(contentType)) title = extractTitle(decodeBody(await readLimited(res, policy.maxBodyBytes), contentType));
      else await res.body?.cancel().catch(() => {});

      return describeResponse({
        requestedUrl: rawUrl,
        url,
        status: res.status,
        redirects,
        // Headers.get joins repeated headers with ", ", which the policy parsers split again.
        header: (name) => {
          const value = res.headers.get(name);
          return value === null ? [] : [value];
        },
        ancestorOrigin,
        title,
      });
    }
  } catch (err) {
    const e = classifyFetchError(err, signal);
    return { ok: false, requestedUrl: rawUrl, errorCode: e.code, message: e.message };
  } finally {
    clearTimeout(deadline);
  }
}

function json(status: number, body: unknown, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...JSON_HEADERS, ...extraHeaders } });
}

/** GET /api/inspect handler using the Web Request/Response API (Cloudflare Pages Functions). */
export function createEdgeInspectHandler(policy: EdgePolicy = DEFAULT_EDGE_POLICY) {
  const isLimited = createRateLimiter();

  return async function handle(request: Request): Promise<Response> {
    const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
    const check = checkInspectRequest({
      method: request.method,
      url: request.url,
      secFetchSite: request.headers.get('sec-fetch-site'),
      // Cloudflare sets cf-connecting-ip to the real client address.
      clientKey: request.headers.get('cf-connecting-ip') || forwarded || 'unknown',
      fallbackOrigin: new URL(request.url).origin,
      isLimited,
    });
    if (!check.ok) return json(check.status, { error: check.error }, check.headers);
    try {
      return json(200, await inspectUrlEdge(check.target, check.ancestor, policy));
    } catch {
      return json(500, { error: 'Inspection failed unexpectedly' });
    }
  };
}
