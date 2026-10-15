import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { inspectApi } from './vite.config.js';
import { createInspectHandler } from './server/handler.js';
import { DEFAULT_POLICY } from './server/inspect.js';

/**
 * Test-only configuration. The production policy refuses loopback addresses,
 * so the e2e run maps fake *.test hosts to the local fixture server. Every
 * other name fails DNS, like an unknown domain would.
 */
const e2eHandler = createInspectHandler({
  ...DEFAULT_POLICY,
  resolver: async (host) => {
    if (host.endsWith('.test')) return [{ address: '127.0.0.1', family: 4 }];
    throw Object.assign(new Error(`getaddrinfo ENOTFOUND ${host}`), { code: 'ENOTFOUND' });
  },
  isAddressAllowed: (ip) => ip === '127.0.0.1',
  isHostnameAllowed: () => true,
  allowedPorts: [4101, 4199],
  timeoutMs: 3000,
});

// Serve the same security headers as production so the tests run under the real CSP.
const vercel = JSON.parse(readFileSync(new URL('./vercel.json', import.meta.url), 'utf8')) as {
  headers: { headers: { key: string; value: string }[] }[];
};
const productionHeaders = Object.fromEntries(vercel.headers[0].headers.map((h) => [h.key, h.value]));

export default defineConfig({
  plugins: [react(), inspectApi(e2eHandler)],
  build: { outDir: 'dist' },
  preview: { headers: productionHeaders },
});
