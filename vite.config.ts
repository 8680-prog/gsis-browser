import { defineConfig, type Connect, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { createInspectHandler } from './server/handler.js';

/** Serves /api/inspect during `vite dev` and `vite preview`, mirroring the Vercel function. */
export function inspectApi(handler = createInspectHandler()): Plugin {
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
