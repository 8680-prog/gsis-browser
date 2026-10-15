import { createEdgeInspectHandler } from '../../server/edge.js';

/**
 * Cloudflare Pages Function: GET /api/inspect
 * (file-based routing: functions/api/inspect.ts -> /api/inspect).
 * Requires the `nodejs_compat` compatibility flag (see wrangler.toml) for node:dns.
 */
const handle = createEdgeInspectHandler();

export const onRequest = (context: { request: Request }): Promise<Response> => handle(context.request);
