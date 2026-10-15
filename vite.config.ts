import { defineConfig, type Connect, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { createEdgeInspectHandler } from './server/edge.js';
import { toNodeHandler } from './server/nodeAdapter.js';

/**
 * Serves /api/inspect during `vite dev` and `vite preview` with the same
 * Web-standard handler that Cloudflare Pages runs (functions/api/inspect.ts).
 */
export function inspectApi(handle: (request: Request) => Promise<Response> = createEdgeInspectHandler()): Plugin {
  const handler = toNodeHandler(handle);
  const mount = (middlewares: Connect.Server) =>
    middlewares.use('/api/inspect', (req, res) => {
      void handler(req, res);
    });
  return {
    name: 'fern-inspect-api',
    configureServer(server) {
      mount(server.middlewares);
    },
    configurePreviewServer(server) {
      mount(server.middlewares);
    },
  };
}

export default defineConfig({
  plugins: [react(), inspectApi()],
  build: { outDir: 'dist', sourcemap: true },
});
