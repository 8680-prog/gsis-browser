import type { IncomingMessage, ServerResponse } from 'node:http';
import { DEFAULT_POLICY, inspectUrl, type InspectPolicy } from './inspect.js';

/**
 * HTTP handler for GET /api/inspect?url=<target>&ancestor=<origin>.
 * Works as a Vercel Node function and as Vite dev/preview middleware.
 */

const MAX_URL_LENGTH = 2048;
const RATE_LIMIT = 40; // requests per window per client
const RATE_WINDOW_MS = 60_000;

interface Bucket {
  count: number;
  start: number;
}

function sendJson(res: ServerResponse, status: number, body: unknown, extraHeaders: Record<string, string> = {}): void {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.setHeader('x-content-type-options', 'nosniff');
  for (const [k, v] of Object.entries(extraHeaders)) res.setHeader(k, v);
  res.end(JSON.stringify(body));
}

function clientKey(req: IncomingMessage): string {
  // On Vercel the platform sets x-forwarded-for; elsewhere this is best-effort.
  const forwarded = req.headers['x-forwarded-for'];
  const first = (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(',')[0]?.trim();
  return first || req.socket.remoteAddress || 'unknown';
}

function requestOrigin(req: IncomingMessage): string | null {
  const host = req.headers['x-forwarded-host'] ?? req.headers.host;
  if (typeof host !== 'string' || !host) return null;
  const proto = req.headers['x-forwarded-proto'];
  const scheme = typeof proto === 'string' && proto.split(',')[0].trim() === 'https' ? 'https' : 'http';
  try {
    return new URL(`${scheme}://${host}`).origin;
  } catch {
    return null;
  }
}

function parseAncestor(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.origin;
  } catch {
    return null;
  }
}

export function createInspectHandler(policy: InspectPolicy = DEFAULT_POLICY) {
  const buckets = new Map<string, Bucket>();

  function rateLimited(key: string): boolean {
    const now = Date.now();
    if (buckets.size > 5000) {
      for (const [k, b] of buckets) if (now - b.start > RATE_WINDOW_MS) buckets.delete(k);
    }
    const bucket = buckets.get(key);
    if (!bucket || now - bucket.start > RATE_WINDOW_MS) {
      buckets.set(key, { count: 1, start: now });
      return false;
    }
    bucket.count += 1;
    return bucket.count > RATE_LIMIT;
  }

  return async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (req.method !== 'GET') {
      sendJson(res, 405, { error: 'Method not allowed' }, { allow: 'GET' });
      return;
    }
    // Browsers label requests from other websites; this endpoint is only for
    // the app's own pages and is not a general-purpose service.
    if (req.headers['sec-fetch-site'] === 'cross-site') {
      sendJson(res, 403, { error: 'Cross-site requests are not allowed' });
      return;
    }
    if (rateLimited(clientKey(req))) {
      sendJson(res, 429, { error: 'Too many requests, slow down.' }, { 'retry-after': '60' });
      return;
    }

    const params = new URL(req.url ?? '/', 'http://localhost').searchParams;
    const target = params.get('url');
    if (!target || target.length > MAX_URL_LENGTH) {
      sendJson(res, 400, { error: 'Missing or overly long "url" parameter' });
      return;
    }
    const ancestor = parseAncestor(params.get('ancestor')) ?? requestOrigin(req);
    if (!ancestor) {
      sendJson(res, 400, { error: 'Could not determine the embedding origin' });
      return;
    }

    try {
      const result = await inspectUrl(target, ancestor, policy);
      sendJson(res, 200, result);
    } catch {
      sendJson(res, 500, { error: 'Inspection failed unexpectedly' });
    }
  };
}
