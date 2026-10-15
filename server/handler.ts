import type { IncomingMessage, ServerResponse } from 'node:http';
import { JSON_HEADERS, checkInspectRequest, createRateLimiter } from './core.js';
import { DEFAULT_POLICY, inspectUrl, type InspectPolicy } from './inspect.js';

/**
 * Node HTTP handler for GET /api/inspect?url=<target>&ancestor=<origin>.
 * Used by the Vercel function (api/inspect.ts) and any plain Node server.
 */

function sendJson(res: ServerResponse, status: number, body: unknown, extraHeaders: Record<string, string> = {}): void {
  res.statusCode = status;
  for (const [k, v] of Object.entries({ ...JSON_HEADERS, ...extraHeaders })) res.setHeader(k, v);
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

export function createInspectHandler(policy: InspectPolicy = DEFAULT_POLICY) {
  const isLimited = createRateLimiter();

  return async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const check = checkInspectRequest({
      method: req.method ?? 'GET',
      url: req.url ?? '/',
      secFetchSite: typeof req.headers['sec-fetch-site'] === 'string' ? req.headers['sec-fetch-site'] : null,
      clientKey: clientKey(req),
      fallbackOrigin: requestOrigin(req),
      isLimited,
    });
    if (!check.ok) {
      sendJson(res, check.status, { error: check.error }, check.headers);
      return;
    }
    try {
      sendJson(res, 200, await inspectUrl(check.target, check.ancestor, policy));
    } catch {
      sendJson(res, 500, { error: 'Inspection failed unexpectedly' });
    }
  };
}
