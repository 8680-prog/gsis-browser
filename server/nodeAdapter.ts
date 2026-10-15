import type { IncomingMessage, ServerResponse } from 'node:http';

/**
 * Runs a Web-standard `(Request) => Response` handler inside a Node/Connect
 * server, so `vite dev` and `vite preview` serve /api/inspect with the same
 * code Cloudflare Pages runs in production.
 */
export function toNodeHandler(handle: (request: Request) => Promise<Response>) {
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const host = req.headers.host ?? 'localhost';
    // Connect strips the mount path from req.url; originalUrl keeps it.
    const path = (req as IncomingMessage & { originalUrl?: string }).originalUrl ?? req.url ?? '/';
    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers)) {
      if (value === undefined) continue;
      for (const v of Array.isArray(value) ? value : [value]) headers.append(key, v);
    }
    const response = await handle(new Request(`http://${host}${path}`, { method: req.method ?? 'GET', headers }));
    res.statusCode = response.status;
    response.headers.forEach((value, key) => res.setHeader(key, value));
    res.end(Buffer.from(await response.arrayBuffer()));
  };
}
