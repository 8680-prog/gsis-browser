import { JSON_HEADERS, checkInspectRequest, createRateLimiter, type InspectResult } from './core.js';

/**
 * GET /api/inspect handler using the Web Request/Response API. Shared by the
 * Netlify Function (Node inspector), the Cloudflare Pages Function (Workers
 * inspector) and Vite dev/preview.
 */

export type Inspector = (target: string, ancestorOrigin: string) => Promise<InspectResult>;

function json(status: number, body: unknown, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...JSON_HEADERS, ...extraHeaders } });
}

export function createWebInspectHandler(inspect: Inspector) {
  const isLimited = createRateLimiter();

  /** `clientIp` is the platform-verified client address when available (Netlify `context.ip`). */
  return async function handle(request: Request, clientIp?: string): Promise<Response> {
    const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
    const check = checkInspectRequest({
      method: request.method,
      url: request.url,
      secFetchSite: request.headers.get('sec-fetch-site'),
      clientKey:
        clientIp ||
        request.headers.get('x-nf-client-connection-ip') || // Netlify
        request.headers.get('cf-connecting-ip') || // Cloudflare
        forwarded ||
        'unknown',
      fallbackOrigin: new URL(request.url).origin,
      isLimited,
    });
    if (!check.ok) return json(check.status, { error: check.error }, check.headers);
    try {
      return json(200, await inspect(check.target, check.ancestor));
    } catch {
      return json(500, { error: 'Inspection failed unexpectedly' });
    }
  };
}

/** JSON 404 for unknown /api/* routes (instead of an HTML page). */
export function apiNotFound(): Response {
  return json(404, { error: 'Not found' });
}
