import { inspectUrl } from '../../server/inspect.js';
import { createWebInspectHandler } from '../../server/webHandler.js';

/**
 * Netlify Function: GET /api/inspect
 *
 * Netlify Functions run on Node.js, so this uses the Node inspector
 * (server/inspect.ts): DNS is resolved through a guarded lookup and the socket
 * connects only to the validated addresses (no DNS-rebinding window).
 */
const handle = createWebInspectHandler((target, ancestor) => inspectUrl(target, ancestor));

export default (request: Request, context?: { ip?: string }): Promise<Response> => handle(request, context?.ip);

export const config = {
  path: '/api/inspect',
  // Platform rate limit (per visitor IP, available on all Netlify plans). Unlike the
  // in-memory limiter in server/core.ts, it holds across function instances.
  rateLimit: { windowLimit: 40, windowSize: 60, aggregateBy: ['ip', 'domain'] },
};
