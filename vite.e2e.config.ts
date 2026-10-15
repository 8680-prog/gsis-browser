import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { inspectApi } from './vite.config.js';
import { DEFAULT_EDGE_POLICY, createEdgeInspectHandler } from './server/edge.js';
import { InspectError } from './server/core.js';
import { localFetch } from './tests/support/localFetch.js';

/**
 * Test-only configuration. The production policy refuses loopback addresses,
 * so the e2e run maps fake *.test hosts to the local fixture server. Every
 * other name fails DNS, like an unknown domain would.
 */
const e2eHandler = createEdgeInspectHandler({
  ...DEFAULT_EDGE_POLICY,
  resolve: async (host) => {
    if (host.endsWith('.test')) return ['127.0.0.1'];
    throw new InspectError('dns', 'The domain name could not be found (DNS lookup failed).');
  },
  fetch: localFetch,
  isAddressAllowed: (ip) => ip === '127.0.0.1',
  isHostnameAllowed: () => true,
  allowedPorts: [4101, 4199],
  timeoutMs: 3000,
});

// Serve the same security headers as production (Cloudflare Pages reads public/_headers).
function parseHeadersFile(text: string): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const line of text.split('\n')) {
    const match = /^\s+([A-Za-z-]+):\s*(.+)$/.exec(line);
    if (match) headers[match[1]] = match[2].trim();
  }
  return headers;
}
const productionHeaders = parseHeadersFile(readFileSync(new URL('./public/_headers', import.meta.url), 'utf8'));
if (!productionHeaders['Content-Security-Policy']) throw new Error('public/_headers has no Content-Security-Policy');

export default defineConfig({
  plugins: [react(), inspectApi(e2eHandler)],
  build: { outDir: 'dist' },
  preview: { headers: productionHeaders },
});
