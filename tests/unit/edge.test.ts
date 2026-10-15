import http, { type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_EDGE_POLICY, createEdgeInspectHandler, inspectUrlEdge, type EdgePolicy } from '../../server/edge';
import { inspectUrl, DEFAULT_POLICY, type InspectPolicy } from '../../server/inspect';
import { localFetch } from '../support/localFetch';

// The Cloudflare Pages Function uses inspectUrlEdge; these tests mirror the Node inspector tests.

let server: Server;
let port = 0;

beforeAll(async () => {
  server = http.createServer((req, res) => {
    const path = req.url ?? '/';
    const html = (title: string, headers: Record<string, string> = {}, status = 200) => {
      res.writeHead(status, { 'content-type': 'text/html; charset=utf-8', ...headers });
      res.end(`<title>${title}</title>`);
    };
    if (path === '/ok') return html('Embeddable page');
    if (path === '/xfo') return html('No frames', { 'x-frame-options': 'DENY' });
    if (path === '/xfo-twice') {
      res.setHeader('x-frame-options', ['SAMEORIGIN', 'DENY']);
      return html('Conflicting');
    }
    if (path === '/csp') return html('CSP', { 'content-security-policy': "frame-ancestors 'none'" });
    if (path === '/csp-multi') {
      res.setHeader('content-security-policy', ['frame-ancestors *', "frame-ancestors 'none'"]);
      return html('Two policies');
    }
    if (path === '/redirect') return html('', { location: '/ok' }, 302);
    if (path === '/redirect-private') return html('', { location: 'http://169.254.169.254/latest/meta-data/' }, 302);
    if (path === '/redirect-private-dns') return html('', { location: `http://private.example:${port}/` }, 302);
    if (path === '/loop') return html('', { location: '/loop' }, 302);
    if (path === '/hang') return;
    if (path === '/huge') {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.write('<html>' + 'x'.repeat(10_000_000));
      return res.end('<title>too late</title>');
    }
    if (path === '/auth') return html('Sign in', {}, 401);
    res.writeHead(404).end();
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  port = (server.address() as AddressInfo).port;
});

afterAll(() => {
  server.closeAllConnections();
  server.close();
});

function edgePolicy(overrides: Partial<EdgePolicy> = {}): EdgePolicy {
  return {
    ...DEFAULT_EDGE_POLICY,
    resolve: async (host) => {
      if (host.endsWith('.test')) return ['127.0.0.1'];
      if (host === 'private.example') return ['10.0.0.1'];
      if (host === 'mixed.example') return ['93.184.215.14', '192.168.1.5'];
      throw new Error('ENOTFOUND');
    },
    fetch: localFetch,
    isAddressAllowed: (ip) => ip === '127.0.0.1' || ip === '93.184.215.14',
    isHostnameAllowed: () => true,
    allowedPorts: [port],
    timeoutMs: 1500,
    maxBodyBytes: 4096,
    ...overrides,
  };
}

const APP = 'http://localhost:5173';
const u = (path: string) => `http://site.test:${port}${path}`;

describe('inspectUrlEdge (Cloudflare Pages Function core)', () => {
  it('reports embeddable pages with their title', async () => {
    expect(await inspectUrlEdge(u('/ok'), APP, edgePolicy())).toMatchObject({ ok: true, embeddable: true, status: 200, title: 'Embeddable page' });
  });

  it('reports X-Frame-Options and CSP blocks, including repeated headers', async () => {
    expect(await inspectUrlEdge(u('/xfo'), APP, edgePolicy())).toMatchObject({ embeddable: false, blockSource: 'xfo' });
    expect(await inspectUrlEdge(u('/xfo-twice'), APP, edgePolicy())).toMatchObject({ embeddable: false, blockSource: 'xfo' });
    expect(await inspectUrlEdge(u('/csp'), APP, edgePolicy())).toMatchObject({ embeddable: false, blockSource: 'csp' });
    expect(await inspectUrlEdge(u('/csp-multi'), APP, edgePolicy())).toMatchObject({ embeddable: false, blockSource: 'csp' });
  });

  it('follows redirects manually and reports the final URL', async () => {
    expect(await inspectUrlEdge(u('/redirect'), APP, edgePolicy())).toMatchObject({ ok: true, redirects: 1, finalUrl: u('/ok') });
  });

  it('refuses redirects to private addresses (literal and via DNS)', async () => {
    expect(await inspectUrlEdge(u('/redirect-private'), APP, edgePolicy({ allowedPorts: [port, 80] }))).toMatchObject({ ok: false, errorCode: 'blocked_target' });
    expect(await inspectUrlEdge(u('/redirect-private-dns'), APP, edgePolicy())).toMatchObject({ ok: false, errorCode: 'blocked_target' });
  });

  it('refuses a hostname if any resolved address is private', async () => {
    let fetched = false;
    const r = await inspectUrlEdge(`http://mixed.example:${port}/`, APP, edgePolicy({ fetch: async () => ((fetched = true), new Response('')) }));
    expect(r).toMatchObject({ ok: false, errorCode: 'blocked_target' });
    expect(fetched).toBe(false); // no request is made at all
  });

  it('stops redirect loops, times out and limits the body', async () => {
    expect(await inspectUrlEdge(u('/loop'), APP, edgePolicy())).toMatchObject({ ok: false, errorCode: 'too_many_redirects' });
    const t0 = Date.now();
    expect(await inspectUrlEdge(u('/hang'), APP, edgePolicy({ timeoutMs: 500 }))).toMatchObject({ ok: false, errorCode: 'timeout' });
    expect(Date.now() - t0).toBeLessThan(1500);
    const t1 = Date.now();
    expect(await inspectUrlEdge(u('/huge'), APP, edgePolicy())).toMatchObject({ ok: true, title: null });
    expect(Date.now() - t1).toBeLessThan(1500);
  });

  it('reports DNS failures, refused connections and sign-in pages', async () => {
    expect(await inspectUrlEdge(`http://nowhere.example:${port}/`, APP, edgePolicy())).toMatchObject({ ok: false, errorCode: 'dns' });
    expect(await inspectUrlEdge('http://closed.test:1/', APP, edgePolicy({ allowedPorts: [1] }))).toMatchObject({ ok: false, errorCode: 'refused' });
    expect(await inspectUrlEdge(u('/auth'), APP, edgePolicy())).toMatchObject({ ok: true, notes: ['auth_required', 'insecure'] });
  });

  it('refuses private targets with the production policy before any network access', async () => {
    let called = false;
    const spy: EdgePolicy = { ...DEFAULT_EDGE_POLICY, fetch: async () => ((called = true), new Response('')), resolve: async () => ((called = true), []) };
    for (const target of ['http://127.0.0.1/', 'http://169.254.169.254/latest/meta-data/', 'http://[::1]/', 'http://localhost/', 'http://metadata.google.internal/', 'http://10.0.0.1/', 'https://example.com:8443/']) {
      expect(await inspectUrlEdge(target, APP, spy)).toMatchObject({ ok: false, errorCode: 'blocked_target' });
    }
    expect(called).toBe(false);
  });
});

describe('Node and Cloudflare inspectors agree', () => {
  const nodePolicy = (): InspectPolicy => ({
    ...DEFAULT_POLICY,
    resolver: async (host) => (host.endsWith('.test') ? [{ address: '127.0.0.1', family: 4 }] : Promise.reject(Object.assign(new Error('nx'), { code: 'ENOTFOUND' }))),
    isAddressAllowed: (ip) => ip === '127.0.0.1',
    isHostnameAllowed: () => true,
    allowedPorts: [port],
    timeoutMs: 1500,
    maxBodyBytes: 4096,
  });

  it.each(['/ok', '/xfo', '/xfo-twice', '/csp', '/csp-multi', '/redirect', '/auth', '/loop'])('%s', async (path) => {
    const a = await inspectUrl(u(path), APP, nodePolicy());
    const b = await inspectUrlEdge(u(path), APP, edgePolicy());
    expect(b).toEqual(a);
  });
});

describe('createEdgeInspectHandler (Request -> Response)', () => {
  const req = (path: string, init: RequestInit = {}) => new Request(`https://fern.pages.dev${path}`, init);

  it('returns JSON with no-store caching and only metadata', async () => {
    const handle = createEdgeInspectHandler(edgePolicy());
    const res = await handle(req(`/api/inspect?url=${encodeURIComponent(u('/xfo'))}`));
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('content-type')).toContain('application/json');
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, embeddable: false });
    expect(Object.keys(body).sort()).toEqual(
      ['blockReason', 'blockSource', 'contentType', 'embeddable', 'finalUrl', 'notes', 'ok', 'redirects', 'requestedUrl', 'status', 'title'].sort(),
    );
  });

  it('defaults the embedding origin to the request origin', async () => {
    // frame-ancestors naming the Pages origin is only allowed when the ancestor is derived correctly.
    const policy = edgePolicy({
      fetch: async () => new Response('<title>x</title>', { headers: { 'content-security-policy': 'frame-ancestors https://fern.pages.dev', 'content-type': 'text/html' } }),
    });
    const res = await createEdgeInspectHandler(policy)(req(`/api/inspect?url=${encodeURIComponent(u('/'))}`));
    expect(await res.json()).toMatchObject({ ok: true, embeddable: true });
  });

  it('rejects bad requests, other methods and cross-site callers', async () => {
    const handle = createEdgeInspectHandler(edgePolicy());
    expect((await handle(req('/api/inspect'))).status).toBe(400);
    const post = await handle(req('/api/inspect?url=x', { method: 'POST' }));
    expect(post.status).toBe(405);
    expect(post.headers.get('allow')).toBe('GET');
    expect((await handle(req(`/api/inspect?url=${encodeURIComponent(u('/ok'))}`, { headers: { 'sec-fetch-site': 'cross-site' } }))).status).toBe(403);
  });

  it('rate-limits per client IP using cf-connecting-ip', async () => {
    const handle = createEdgeInspectHandler(edgePolicy());
    const statuses: number[] = [];
    for (let i = 0; i < 45; i++) statuses.push((await handle(req('/api/inspect?url=invalid', { headers: { 'cf-connecting-ip': '203.0.113.9' } }))).status);
    expect(statuses.filter((s) => s === 429).length).toBeGreaterThan(0);
    // A different client is unaffected.
    expect((await handle(req('/api/inspect?url=invalid', { headers: { 'cf-connecting-ip': '203.0.113.10' } }))).status).toBe(200);
  });
});
