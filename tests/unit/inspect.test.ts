import http, { type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_POLICY, extractTitle, inspectUrl, validateTarget, type InspectPolicy } from '../../server/inspect';
import { createGuardedLookup, isPublicAddress, isPublicHostname } from '../../server/netGuard';
import { createInspectHandler } from '../../server/handler';

describe('isPublicAddress', () => {
  it.each([
    '127.0.0.1', '10.1.2.3', '172.16.0.5', '192.168.0.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '255.255.255.255',
    '224.0.0.1', '::1', '::', 'fe80::1', 'fd00:ec2::254', 'fc00::1', '::ffff:127.0.0.1', '::ffff:10.0.0.1', '64:ff9b::a00:1', 'not-an-ip',
  ])('rejects %s', (ip) => expect(isPublicAddress(ip)).toBe(false));

  it.each(['93.184.215.14', '8.8.8.8', '2606:4700:4700::1111', '::ffff:8.8.8.8'])('accepts %s', (ip) =>
    expect(isPublicAddress(ip)).toBe(true),
  );
});

describe('isPublicHostname', () => {
  it.each(['localhost', 'foo.localhost', 'metadata.google.internal', 'printer.local', 'intranet', 'router.lan', 'x.home.arpa'])('rejects %s', (h) =>
    expect(isPublicHostname(h)).toBe(false),
  );
  it('accepts normal domains', () => expect(isPublicHostname('en.wikipedia.org')).toBe(true));
});

describe('validateTarget (default policy)', () => {
  it.each([
    'http://127.0.0.1/', 'http://2130706433/', 'http://0x7f.1/', 'http://[::1]/', 'http://169.254.169.254/latest/meta-data/',
    'http://[::ffff:169.254.169.254]/', 'http://localhost/', 'http://10.0.0.1/', 'https://example.com:22/', 'ftp://example.com/',
    'https://user:pass@example.com/', 'javascript:alert(1)',
  ])('refuses %s', (url) => expect(() => validateTarget(url, DEFAULT_POLICY)).toThrow());

  it('accepts a normal public URL', () => expect(validateTarget('https://example.com/a', DEFAULT_POLICY).href).toBe('https://example.com/a'));
});

describe('createGuardedLookup', () => {
  it('refuses hostnames that resolve to private addresses (DNS rebinding style)', async () => {
    const lookup = createGuardedLookup(async () => [{ address: '8.8.8.8', family: 4 }, { address: '10.0.0.7', family: 4 }], isPublicAddress);
    const err = await new Promise<NodeJS.ErrnoException | null>((resolve) => lookup('evil.example', {}, (e) => resolve(e)));
    expect(err?.code).toBe('EBLOCKED');
  });

  it('passes validated addresses through', async () => {
    const lookup = createGuardedLookup(async () => [{ address: '8.8.8.8', family: 4 }], isPublicAddress);
    const result = await new Promise((resolve) => lookup('ok.example', { all: true }, (_e, a) => resolve(a)));
    expect(result).toEqual([{ address: '8.8.8.8', family: 4 }]);
  });
});

describe('extractTitle', () => {
  it('decodes entities and trims', () => {
    expect(extractTitle('<html><head><title>\n  Ferns &amp; Mosses &#8211; Wiki </title>')).toBe('Ferns & Mosses – Wiki');
    expect(extractTitle('<p>no title</p>')).toBeNull();
  });
});

// ---- Behaviour against real local HTTP servers ----

let server: Server;
let port = 0;

/** Test policy: *.test names resolve to loopback, and only this test server's port is reachable. */
function testPolicy(overrides: Partial<InspectPolicy> = {}): InspectPolicy {
  return {
    ...DEFAULT_POLICY,
    resolver: async (host) => {
      if (host.endsWith('.test')) return [{ address: '127.0.0.1', family: 4 }];
      if (host === 'private.example') return [{ address: '10.0.0.1', family: 4 }];
      throw Object.assign(new Error('nx'), { code: 'ENOTFOUND' });
    },
    isAddressAllowed: (ip) => ip === '127.0.0.1',
    isHostnameAllowed: () => true,
    allowedPorts: [port],
    timeoutMs: 1500,
    maxBodyBytes: 4096,
    ...overrides,
  };
}

beforeAll(async () => {
  server = http.createServer((req, res) => {
    const path = req.url ?? '/';
    if (path === '/ok') {
      res.setHeader('content-type', 'text/html; charset=utf-8');
      res.end('<title>Embeddable page</title><p>hi</p>');
    } else if (path === '/xfo') {
      res.setHeader('x-frame-options', 'DENY');
      res.setHeader('content-type', 'text/html');
      res.end('<title>No frames</title>');
    } else if (path === '/csp') {
      res.setHeader('content-security-policy', "frame-ancestors 'none'");
      res.setHeader('content-type', 'text/html');
      res.end('<title>CSP</title>');
    } else if (path === '/redirect') {
      res.statusCode = 302;
      res.setHeader('location', '/ok');
      res.end();
    } else if (path === '/redirect-private') {
      res.statusCode = 302;
      res.setHeader('location', 'http://169.254.169.254/latest/meta-data/');
      res.end();
    } else if (path === '/redirect-private-dns') {
      res.statusCode = 302;
      res.setHeader('location', `http://private.example:${port}/`);
      res.end();
    } else if (path === '/loop') {
      res.statusCode = 302;
      res.setHeader('location', '/loop');
      res.end();
    } else if (path === '/hang') {
      // never respond
    } else if (path === '/huge') {
      res.setHeader('content-type', 'text/html');
      res.write('<html>' + 'x'.repeat(10_000_000));
      res.end('<title>too late</title>');
    } else if (path === '/auth') {
      res.statusCode = 401;
      res.setHeader('content-type', 'text/html');
      res.end('<title>Sign in</title>');
    } else {
      res.statusCode = 404;
      res.end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = (server.address() as AddressInfo).port;
});

afterAll(() => {
  server.closeAllConnections();
  server.close();
});

const APP = 'http://localhost:5173';
const u = (path: string) => `http://site.test:${port}${path}`;

describe('inspectUrl', () => {
  it('reports embeddable pages with their title', async () => {
    const r = await inspectUrl(u('/ok'), APP, testPolicy());
    expect(r).toMatchObject({ ok: true, embeddable: true, status: 200, title: 'Embeddable page' });
  });

  it('reports X-Frame-Options and CSP blocks', async () => {
    expect(await inspectUrl(u('/xfo'), APP, testPolicy())).toMatchObject({ ok: true, embeddable: false, blockSource: 'xfo' });
    expect(await inspectUrl(u('/csp'), APP, testPolicy())).toMatchObject({ ok: true, embeddable: false, blockSource: 'csp' });
  });

  it('follows redirects and reports the final URL', async () => {
    const r = await inspectUrl(u('/redirect'), APP, testPolicy());
    expect(r).toMatchObject({ ok: true, redirects: 1, finalUrl: u('/ok') });
  });

  it('refuses redirects to private addresses (literal and via DNS)', async () => {
    expect(await inspectUrl(u('/redirect-private'), APP, testPolicy({ allowedPorts: [port, 80] }))).toMatchObject({ ok: false, errorCode: 'blocked_target' });
    expect(await inspectUrl(u('/redirect-private-dns'), APP, testPolicy())).toMatchObject({ ok: false, errorCode: 'blocked_target' });
  });

  it('stops redirect loops', async () => {
    expect(await inspectUrl(u('/loop'), APP, testPolicy())).toMatchObject({ ok: false, errorCode: 'too_many_redirects' });
  });

  it('times out on unresponsive servers', async () => {
    const started = Date.now();
    expect(await inspectUrl(u('/hang'), APP, testPolicy({ timeoutMs: 500 }))).toMatchObject({ ok: false, errorCode: 'timeout' });
    expect(Date.now() - started).toBeLessThan(1500);
  });

  it('limits how much of the body it reads', async () => {
    const started = Date.now();
    const r = await inspectUrl(u('/huge'), APP, testPolicy());
    expect(r).toMatchObject({ ok: true, title: null });
    expect(Date.now() - started).toBeLessThan(1500);
  });

  it('flags pages that require sign-in', async () => {
    expect(await inspectUrl(u('/auth'), APP, testPolicy())).toMatchObject({ ok: true, notes: ['auth_required', 'insecure'] });
  });

  it('reports DNS and connection failures', async () => {
    expect(await inspectUrl(`http://nowhere.example:${port}/`, APP, testPolicy())).toMatchObject({ ok: false, errorCode: 'dns' });
    expect(await inspectUrl('http://closed.test:1/', APP, testPolicy({ allowedPorts: [1] }))).toMatchObject({ ok: false, errorCode: 'refused' });
  });

  it('refuses loopback with the production policy', async () => {
    expect(await inspectUrl(`http://127.0.0.1:${port}/ok`, APP)).toMatchObject({ ok: false, errorCode: 'blocked_target' });
  });
});

describe('inspect HTTP handler', () => {
  async function call(handler: ReturnType<typeof createInspectHandler>, path: string, headers: Record<string, string> = {}, method = 'GET') {
    const srv = http.createServer((req, res) => void handler(req, res));
    await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
    const { port: p } = srv.address() as AddressInfo;
    try {
      const res = await fetch(`http://127.0.0.1:${p}${path}`, { method, headers });
      return { status: res.status, body: await res.json(), headers: res.headers };
    } finally {
      srv.close();
    }
  }

  it('returns inspection JSON with no-store caching', async () => {
    const handler = createInspectHandler(testPolicy());
    const r = await call(handler, `/api/inspect?url=${encodeURIComponent(u('/xfo'))}&ancestor=${encodeURIComponent(APP)}`);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ ok: true, embeddable: false });
    expect(r.headers.get('cache-control')).toBe('no-store');
    expect(r.body).not.toHaveProperty('body');
  });

  it('rejects bad requests, other methods and cross-site callers', async () => {
    const handler = createInspectHandler(testPolicy());
    expect((await call(handler, '/api/inspect')).status).toBe(400);
    expect((await call(handler, '/api/inspect?url=x', {}, 'POST')).status).toBe(405);
    expect((await call(handler, `/api/inspect?url=${encodeURIComponent(u('/ok'))}`, { 'sec-fetch-site': 'cross-site' })).status).toBe(403);
  });

  it('rate-limits a single client', async () => {
    const handler = createInspectHandler(testPolicy());
    const srv = http.createServer((req, res) => void handler(req, res));
    await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
    const { port: p } = srv.address() as AddressInfo;
    const statuses: number[] = [];
    for (let i = 0; i < 45; i++) {
      const res = await fetch(`http://127.0.0.1:${p}/api/inspect?url=invalid`);
      statuses.push(res.status);
      await res.arrayBuffer();
    }
    srv.close();
    expect(statuses.filter((s) => s === 429).length).toBeGreaterThan(0);
  });
});
