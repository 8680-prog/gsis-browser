import { apiNotFound } from '../../server/webHandler.js';

/** Netlify Function: JSON 404 for any other /api/* path. */
export default (): Response => apiNotFound();

export const config = { path: '/api/*', excludedPath: '/api/inspect' };
