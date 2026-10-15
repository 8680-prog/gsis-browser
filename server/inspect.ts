import http, { type IncomingMessage } from 'node:http';
import https from 'node:https';
import zlib from 'node:zlib';
import {
  ACCEPT_HEADER,
  DEFAULT_LIMITS,
  InspectError,
  MESSAGES,
  USER_AGENT,
  decodeBody,
  describeResponse,
  extractTitle,
  nextRedirect,
  validateTarget as validateWithPolicy,
  wantsTitle,
  type InspectResult,
} from './core.js';
import { BlockedTargetError, createGuardedLookup, isPublicAddress, isPublicHostname, systemResolver, type Resolver } from './netGuard.js';

/**
 * Node.js embed inspector (Vercel functions, Vite dev/preview, any Node host).
 *
 * Stronger than the Cloudflare version: DNS is resolved through a guarded
 * `lookup`, and the socket connects only to the validated addresses, which
 * rules out DNS rebinding between the check and the connection.
 */

export type { InspectErrorCode, InspectFailure, InspectNote, InspectResult, InspectSuccess } from './core.js';
export { extractTitle };

export interface InspectPolicy {
  resolver: Resolver;
  isAddressAllowed: (ip: string) => boolean;
  isHostnameAllowed: (hostname: string) => boolean;
  allowedPorts: number[];
  timeoutMs: number;
  maxBodyBytes: number;
  maxRedirects: number;
}

export const DEFAULT_POLICY: InspectPolicy = {
  resolver: systemResolver,
  isAddressAllowed: isPublicAddress,
  isHostnameAllowed: isPublicHostname,
  allowedPorts: [80, 443],
  ...DEFAULT_LIMITS,
};

export function validateTarget(raw: string, policy: InspectPolicy): URL {
  return validateWithPolicy(raw, policy);
}

function classifyError(err: unknown): InspectError {
  if (err instanceof InspectError) return err;
  if (err instanceof BlockedTargetError) return new InspectError('blocked_target', MESSAGES.privateResolution);
  const e = err as NodeJS.ErrnoException;
  const code = e?.code ?? '';
  if (e?.name === 'AbortError' || code === 'ABORT_ERR' || code === 'ETIMEDOUT' || code === 'ESOCKETTIMEDOUT') {
    return new InspectError('timeout', MESSAGES.timeout);
  }
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN' || code === 'ENODATA') return new InspectError('dns', MESSAGES.dns);
  if (code === 'ECONNREFUSED' || code === 'ECONNRESET' || code === 'EHOSTUNREACH' || code === 'ENETUNREACH') {
    return new InspectError('refused', MESSAGES.refused);
  }
  if (/CERT|TLS|SSL|SELF_SIGNED|UNABLE_TO_VERIFY/i.test(code) || /certificate|ssl|tls/i.test(e?.message ?? '')) {
    return new InspectError('tls', `The site's secure connection could not be verified (${code || 'TLS error'}).`);
  }
  return new InspectError('network', `The site could not be reached (${code || e?.message || 'network error'}).`);
}

function headerList(value: string | string[] | number | undefined): string[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [String(value)];
}

function request(url: URL, policy: InspectPolicy, signal: AbortSignal): Promise<IncomingMessage> {
  const lib = url.protocol === 'https:' ? https : http;
  return new Promise((resolve, reject) => {
    const req = lib.request(
      url,
      {
        method: 'GET',
        agent: false,
        lookup: createGuardedLookup(policy.resolver, policy.isAddressAllowed),
        signal,
        timeout: policy.timeoutMs,
        headers: {
          'user-agent': USER_AGENT,
          accept: ACCEPT_HEADER,
          'accept-encoding': 'gzip, deflate, br',
          'accept-language': 'en-US,en;q=0.8',
        },
      },
      resolve,
    );
    req.on('timeout', () => req.destroy(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' })));
    req.on('error', reject);
    req.end();
  });
}

/** Reads at most `limit` decoded bytes, then stops the download. */
async function readLimited(res: IncomingMessage, limit: number): Promise<Buffer> {
  const encoding = String(res.headers['content-encoding'] ?? '').toLowerCase();
  let stream: NodeJS.ReadableStream = res;
  if (encoding === 'gzip' || encoding === 'x-gzip') stream = res.pipe(zlib.createGunzip());
  else if (encoding === 'deflate') stream = res.pipe(zlib.createInflate());
  else if (encoding === 'br') stream = res.pipe(zlib.createBrotliDecompress());

  const chunks: Buffer[] = [];
  let size = 0;
  try {
    for await (const chunk of stream) {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string);
      chunks.push(buf);
      size += buf.length;
      if (size >= limit) break;
    }
  } catch {
    // A truncated or corrupt body only means we may not find a title.
  } finally {
    res.destroy();
  }
  return Buffer.concat(chunks).subarray(0, limit);
}

export async function inspectUrl(rawUrl: string, ancestorOrigin: string, policy: InspectPolicy = DEFAULT_POLICY): Promise<InspectResult> {
  const controller = new AbortController();
  const deadline = setTimeout(() => controller.abort(), policy.timeoutMs);
  try {
    let url = validateTarget(rawUrl, policy);
    let redirects = 0;

    for (;;) {
      const res = await request(url, policy, controller.signal);
      const status = res.statusCode ?? 0;
      const location = res.headers.location;

      if (status >= 300 && status < 400 && location) {
        res.destroy();
        url = nextRedirect(location, url, redirects, policy);
        redirects += 1;
        continue;
      }

      const contentType = typeof res.headers['content-type'] === 'string' ? res.headers['content-type'] : null;
      let title: string | null = null;
      if (wantsTitle(contentType)) title = extractTitle(decodeBody(await readLimited(res, policy.maxBodyBytes), contentType));
      else res.destroy();

      return describeResponse({
        requestedUrl: rawUrl,
        url,
        status,
        redirects,
        header: (name) => headerList(res.headers[name]),
        ancestorOrigin,
        title,
      });
    }
  } catch (err) {
    const e = classifyError(controller.signal.aborted ? Object.assign(new Error('aborted'), { name: 'AbortError' }) : err);
    return { ok: false, requestedUrl: rawUrl, errorCode: e.code, message: e.message };
  } finally {
    clearTimeout(deadline);
  }
}
