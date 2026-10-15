/**
 * Catch-all for unknown /api/* routes. Without it, Cloudflare Pages would fall
 * back to the single-page app's index.html (HTTP 200), hiding API mistakes.
 * More specific routes such as functions/api/inspect.ts take precedence.
 */
export const onRequest = (): Response =>
  new Response(JSON.stringify({ error: 'Not found' }), {
    status: 404,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' },
  });
