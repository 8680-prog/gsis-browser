import { defineConfig, type Connect, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { inspectUrl } from './server/inspect.js';
import { toNodeHandler } from './server/nodeAdapter.js';
import { createWebInspectHandler } from './server/webHandler.js';

/**
 * Serves /api/inspect during `vite dev` and `vite preview` with the same
 * handler the Netlify Function runs (netlify/functions/inspect.ts).
 */
export function inspectApi(
  handle: (request: Request) => Promise<Response> = createWebInspectHandler((target, ancestor) => inspectUrl(target, ancestor)),
): Plugin {
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
