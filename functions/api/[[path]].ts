import { apiNotFound } from '../../server/webHandler.js';

/**
 * Cloudflare Pages: catch-all for unknown /api/* routes. Without it, Pages would
 * fall back to the single-page app's index.html (HTTP 200), hiding API mistakes.
 * More specific routes such as functions/api/inspect.ts take precedence.
 */
export const onRequest = (): Response => apiNotFound();
