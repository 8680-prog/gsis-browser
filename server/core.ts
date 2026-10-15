import { evaluateFramePolicy, type FrameBlockSource } from './framePolicy.js';
import { isIpLiteral, type AddressPolicy } from './addressPolicy.js';

/**
 * Runtime-independent parts of the embed inspector, shared by the Node
 * implementation (server/inspect.ts, used by Vercel or any Node host) and the
 * Web-standard implementation (server/edge.ts, used by Cloudflare Pages
 * Functions and local dev). Keeping them here guarantees both report the same
 * results for the same response.
 *
 * The inspector reports *metadata only* (status, final URL, framing verdict,
 * <title>). It never returns the page body, so it cannot be used as a proxy.
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

export const USER_AGENT = 'Mozilla/5.0 (compatible; FernEmbedCheck/1.0; checks whether a page allows iframe embedding)';
export const ACCEPT_HEADER = 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8';

export const DEFAULT_LIMITS = {
  timeoutMs: 8000,
  maxBodyBytes: 256 * 1024,
  maxRedirects: 5,
};

export class InspectError extends Error {
  constructor(
    readonly code: InspectErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export const MESSAGES = {
  timeout: 'The site took too long to respond.',
  dns: 'The domain name could not be found (DNS lookup failed).',
  refused: 'The server refused or dropped the connection.',
  tooManyRedirects: 'The site redirected too many times.',
  badRedirect: 'The site sent an invalid redirect.',
  privateResolution: 'This host resolves to a private or internal network address.',
};

/** Validates a URL against the policy before any network activity. */
export function validateTarget(raw: string, policy: AddressPolicy): URL {
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
  const host = hostOf(url);
  if (isIpLiteral(host)) {
    // Literal IPs skip DNS entirely, so they must be checked here.
    if (!policy.isAddressAllowed(host)) {
      throw new InspectError('blocked_target', 'Private, loopback and link-local addresses cannot be opened.');
    }
  } else if (!policy.isHostnameAllowed(host)) {
    throw new InspectError('blocked_target', 'Local or internal host names cannot be opened.');
  }
  return url;
}

/** Hostname without IPv6 brackets. */
export function hostOf(url: URL): string {
  return url.hostname.replace(/^\[(.*)\]$/, '$1');
}

/** Resolves a redirect Location against the current URL and re-validates it. */
export function nextRedirect(location: string, current: URL, redirects: number, policy: AddressPolicy & { maxRedirects: number }): URL {
  if (redirects >= policy.maxRedirects) throw new InspectError('too_many_redirects', MESSAGES.tooManyRedirects);
  let next: string;
  try {
    next = new URL(location, current).toString();
  } catch {
    throw new InspectError('network', MESSAGES.badRedirect);
  }
  // Every hop is re-validated, so a public site cannot bounce us inward.
  return validateTarget(next, policy);
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

function safeCodePoint(cp: number): string {
  return Number.isInteger(cp) && cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : '';
}

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

export function decodeBody(body: Uint8Array, contentType: string | null): string {
  const charset = /charset=["']?([\w-]+)/i.exec(contentType ?? '')?.[1];
  try {
    return new TextDecoder(charset || 'utf-8').decode(body);
  } catch {
    return new TextDecoder('utf-8').decode(body);
  }
}

/** Whether the body is worth reading for a <title>. */
export function wantsTitle(contentType: string | null): boolean {
  return contentType === null || /html|xml/i.test(contentType);
}

/**
 * Builds the success result from a final (non-redirect) response.
 * `header(name)` returns all values of a header (empty array when absent).
 */
export function describeResponse(params: {
  requestedUrl: string;
  url: URL;
  status: number;
  redirects: number;
  header: (name: string) => string[];
  ancestorOrigin: string;
  title: string | null;
}): InspectSuccess {
  const { url, status, header } = params;
  const first = (name: string) => header(name)[0] ?? null;
  const verdict = evaluateFramePolicy({ csp: header('content-security-policy'), xfo: header('x-frame-options') }, url, params.ancestorOrigin);

  const notes: InspectNote[] = [];
  if (status === 401 || status === 407) notes.push('auth_required');
  if (first('cf-mitigated') === 'challenge' || ((status === 403 || status === 429 || status === 503) && /cloudflare|akamai|captcha/i.test(first('server') ?? ''))) {
    notes.push('bot_challenge');
  } else if (status >= 400 && status !== 401 && status !== 407) {
    notes.push('http_error');
  }
  if (/attachment/i.test(first('content-disposition') ?? '')) notes.push('download');
  if (url.protocol === 'http:') notes.push('insecure');

  return {
    ok: true,
    requestedUrl: params.requestedUrl,
    finalUrl: url.toString(),
    status,
    redirects: params.redirects,
    contentType: first('content-type'),
    title: params.title,
    embeddable: verdict.embeddable,
    blockSource: verdict.source,
    blockReason: verdict.reason,
    notes,
  };
}

// ---- Request handling shared by the HTTP adapters ----

export const MAX_URL_LENGTH = 2048;
export const RATE_LIMIT = 40; // requests per window per client
export const RATE_WINDOW_MS = 60_000;

export function parseAncestor(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.origin;
  } catch {
    return null;
  }
}

/**
 * In-memory fixed-window rate limiter. It is per process / per isolate, so it
 * is best-effort only on serverless platforms with many instances.
 */
export function createRateLimiter(limit = RATE_LIMIT, windowMs = RATE_WINDOW_MS) {
  const buckets = new Map<string, { count: number; start: number }>();
  return function isLimited(key: string): boolean {
    const now = Date.now();
    if (buckets.size > 5000) {
      for (const [k, b] of buckets) if (now - b.start > windowMs) buckets.delete(k);
    }
    const bucket = buckets.get(key);
    if (!bucket || now - bucket.start > windowMs) {
      buckets.set(key, { count: 1, start: now });
      return false;
    }
    bucket.count += 1;
    return bucket.count > limit;
  };
}

export type RequestCheck =
  | { ok: true; target: string; ancestor: string }
  | { ok: false; status: number; error: string; headers?: Record<string, string> };

/** Validates an incoming GET /api/inspect request (method, origin, rate limit, parameters). */
export function checkInspectRequest(input: {
  method: string;
  url: string;
  secFetchSite: string | null;
  clientKey: string;
  fallbackOrigin: string | null;
  isLimited: (key: string) => boolean;
}): RequestCheck {
  if (input.method !== 'GET') return { ok: false, status: 405, error: 'Method not allowed', headers: { allow: 'GET' } };
  // Browsers label requests from other websites; this endpoint is only for
  // the app's own pages and is not a general-purpose service.
  if (input.secFetchSite === 'cross-site') return { ok: false, status: 403, error: 'Cross-site requests are not allowed' };
  if (input.isLimited(input.clientKey)) {
    return { ok: false, status: 429, error: 'Too many requests, slow down.', headers: { 'retry-after': '60' } };
  }
  const params = new URL(input.url, 'http://localhost').searchParams;
  const target = params.get('url');
  if (!target || target.length > MAX_URL_LENGTH) return { ok: false, status: 400, error: 'Missing or overly long "url" parameter' };
  const ancestor = parseAncestor(params.get('ancestor')) ?? input.fallbackOrigin;
  if (!ancestor) return { ok: false, status: 400, error: 'Could not determine the embedding origin' };
  return { ok: true, target, ancestor };
}

export const JSON_HEADERS: Record<string, string> = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
};
