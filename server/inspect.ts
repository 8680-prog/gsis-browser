import http, { type IncomingMessage } from 'node:http';
import https from 'node:https';
import net from 'node:net';
import zlib from 'node:zlib';
import { evaluateFramePolicy, type FrameBlockSource } from './framePolicy.js';
import {
  BlockedTargetError,
  createGuardedLookup,
  isPublicAddress,
  isPublicHostname,
  systemResolver,
  type Resolver,
} from './netGuard.js';

/**
 * Embed inspector: fetches a URL server-side and reports *metadata only*
 * (status, final URL, framing headers, <title>) so the browser UI can tell the
 * user whether the page can be shown in an iframe. It never returns the page
 * body, so it cannot be used as a content proxy.
 */

export type InspectErrorCode =
  | 'invalid_url'
  | 'blocked_target'
  | 'dns'
  | 'refused'
  | 'tls'
  | 'timeout'
  | 'too_many_redirects'
  | 'network';

export type InspectNote = 'auth_required' | 'bot_challenge' | 'download' | 'http_error' | 'insecure';

export interface InspectSuccess {
  ok: true;
  requestedUrl: string;
  finalUrl: string;
  status: number;
  redirects: number;
  contentType: string | null;
  title: string | null;
  embeddable: boolean;
  blockSource: FrameBlockSource | null;
  blockReason: string | null;
  notes: InspectNote[];
}

export interface InspectFailure {
  ok: false;
  requestedUrl: string;
  errorCode: InspectErrorCode;
  message: string;
}

export type InspectResult = InspectSuccess | InspectFailure;

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
  timeoutMs: 8000,
  maxBodyBytes: 256 * 1024,
  maxRedirects: 5,
};

const USER_AGENT =
  'Mozilla/5.0 (compatible; FernEmbedCheck/1.0; checks whether a page allows iframe embedding)';

class InspectError extends Error {
  constructor(
    readonly code: InspectErrorCode,
    message: string,
  ) {
    super(message);
  }
}

/** Validates a URL against the policy before any network activity. */
export function validateTarget(raw: string, policy: InspectPolicy): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new InspectError('invalid_url', 'That is not a valid web address.');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new InspectError('invalid_url', 'Only http and https addresses can be opened.');
  }
  if (url.username || url.password) {
    throw new InspectError('invalid_url', 'Addresses containing credentials are not allowed.');
  }
  const port = url.port ? Number(url.port) : url.protocol === 'https:' ? 443 : 80;
  if (!policy.allowedPorts.includes(port)) {
    throw new InspectError('blocked_target', `Port ${port} is not allowed.`);
  }
  // WHATWG URL already normalised odd IPv4 forms (e.g. 2130706433 -> 127.0.0.1).
  const host = url.hostname.replace(/^\[(.*)\]$/, '$1');
  if (net.isIP(host)) {
    // Literal IPs skip DNS lookup entirely, so they must be checked here.
    if (!policy.isAddressAllowed(host)) {
      throw new InspectError('blocked_target', 'Private, loopback and link-local addresses cannot be opened.');
    }
  } else if (!policy.isHostnameAllowed(host)) {
    throw new InspectError('blocked_target', 'Local or internal host names cannot be opened.');
  }
  return url;
}

function classifyError(err: unknown): InspectError {
  if (err instanceof InspectError) return err;
  if (err instanceof BlockedTargetError) {
    return new InspectError('blocked_target', 'This host resolves to a private or internal network address.');
  }
  const e = err as NodeJS.ErrnoException;
  const code = e?.code ?? '';
  if (e?.name === 'AbortError' || code === 'ABORT_ERR' || code === 'ETIMEDOUT' || code === 'ESOCKETTIMEDOUT') {
    return new InspectError('timeout', 'The site took too long to respond.');
  }
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN' || code === 'ENODATA') {
    return new InspectError('dns', 'The domain name could not be found (DNS lookup failed).');
  }
  if (code === 'ECONNREFUSED' || code === 'ECONNRESET' || code === 'EHOSTUNREACH' || code === 'ENETUNREACH') {
    return new InspectError('refused', 'The server refused or dropped the connection.');
  }
  if (/CERT|TLS|SSL|SELF_SIGNED|UNABLE_TO_VERIFY/i.test(code) || /certificate|ssl|tls/i.test(e?.message ?? '')) {
    return new InspectError('tls', `The site's secure connection could not be verified (${code || 'TLS error'}).`);
  }
  return new InspectError('network', `The site could not be reached (${code || e?.message || 'network error'}).`);
}

function headerList(value: string | string[] | undefined): string[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
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
          accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
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

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

export function extractTitle(html: string): string | null {
  const match = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  if (!match) return null;
  const decoded = match[1]
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => safeCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => safeCodePoint(parseInt(dec, 10)))
    .replace(/&([a-z]+);/gi, (whole, name: string) => ENTITIES[name.toLowerCase()] ?? whole)
    .replace(/\s+/g, ' ')
    .trim();
  return decoded ? decoded.slice(0, 200) : null;
}

function safeCodePoint(cp: number): string {
  return Number.isInteger(cp) && cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : '';
}

function decodeBody(body: Buffer, contentType: string | null): string {
  const charset = /charset=["']?([\w-]+)/i.exec(contentType ?? '')?.[1];
  try {
    return new TextDecoder(charset || 'utf-8').decode(body);
  } catch {
    return new TextDecoder('utf-8').decode(body);
  }
}

export async function inspectUrl(
  rawUrl: string,
  ancestorOrigin: string,
  policy: InspectPolicy = DEFAULT_POLICY,
): Promise<InspectResult> {
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
        if (redirects >= policy.maxRedirects) {
          throw new InspectError('too_many_redirects', 'The site redirected too many times.');
        }
        let next: string;
        try {
          next = new URL(location, url).toString();
        } catch {
          throw new InspectError('network', 'The site sent an invalid redirect.');
        }
        // Every hop is re-validated, so a public site cannot bounce us inward.
        url = validateTarget(next, policy);
        redirects += 1;
        continue;
      }

      const contentType = typeof res.headers['content-type'] === 'string' ? res.headers['content-type'] : null;
      const verdict = evaluateFramePolicy(
        {
          csp: headerList(res.headers['content-security-policy']),
          xfo: headerList(res.headers['x-frame-options']),
        },
        url,
        ancestorOrigin,
      );

      const notes: InspectNote[] = [];
      if (status === 401 || status === 407) notes.push('auth_required');
      if (res.headers['cf-mitigated'] === 'challenge' || ((status === 403 || status === 429 || status === 503) && /cloudflare|akamai|captcha/i.test(String(res.headers.server ?? '')))) {
        notes.push('bot_challenge');
      } else if (status >= 400 && status !== 401 && status !== 407) {
        notes.push('http_error');
      }
      if (/attachment/i.test(String(res.headers['content-disposition'] ?? ''))) notes.push('download');
      if (url.protocol === 'http:') notes.push('insecure');

      let title: string | null = null;
      if (contentType === null || /html|xml/i.test(contentType)) {
        const body = await readLimited(res, policy.maxBodyBytes);
        title = extractTitle(decodeBody(body, contentType));
      } else {
        res.destroy();
      }

      return {
        ok: true,
        requestedUrl: rawUrl,
        finalUrl: url.toString(),
        status,
        redirects,
        contentType,
        title,
        embeddable: verdict.embeddable,
        blockSource: verdict.source,
        blockReason: verdict.reason,
        notes,
      };
    }
  } catch (err) {
    const e = classifyError(controller.signal.aborted ? Object.assign(new Error('aborted'), { name: 'AbortError' }) : err);
    return { ok: false, requestedUrl: rawUrl, errorCode: e.code, message: e.message };
  } finally {
    clearTimeout(deadline);
  }
}
