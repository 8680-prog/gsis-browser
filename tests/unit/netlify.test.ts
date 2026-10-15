import { describe, expect, it } from 'vitest';
import inspectFunction, { config as inspectConfig } from '../../netlify/functions/inspect';
import notFoundFunction, { config as notFoundConfig } from '../../netlify/functions/api-not-found';

// Exercises the real Netlify Function modules with Web Requests, as Netlify invokes them.
const req = (path: string, init: RequestInit = {}) => new Request(`https://gsis.netlify.app${path}`, init);

describe('Netlify Functions', () => {
  it('routes /api/inspect and sends every other /api/* path to a JSON 404', () => {
    expect(inspectConfig.path).toBe('/api/inspect');
    // Netlify enforces this across instances; windowSize must be 1-180 seconds.
    expect(inspectConfig.rateLimit).toEqual({ windowLimit: 40, windowSize: 60, aggregateBy: ['ip', 'domain'] });
    expect(notFoundConfig).toEqual({ path: '/api/*', excludedPath: '/api/inspect' });
  });

  it('inspect refuses private and metadata targets before any network access', async () => {
    for (const target of ['http://169.254.169.254/latest/meta-data/', 'http://127.0.0.1/', 'http://2130706433/', 'http://[::1]/', 'http://localhost/', 'http://10.0.0.1/']) {
      const res = await inspectFunction(req(`/api/inspect?url=${encodeURIComponent(target)}`), { ip: '198.51.100.1' });
      expect(res.status).toBe(200);
      expect(res.headers.get('cache-control')).toBe('no-store');
      expect(await res.json()).toMatchObject({ ok: false, errorCode: 'blocked_target' });
    }
  });

  it('inspect validates requests (missing url, method, cross-site)', async () => {
    expect((await inspectFunction(req('/api/inspect'), { ip: '198.51.100.2' })).status).toBe(400);
    const post = await inspectFunction(req('/api/inspect?url=x', { method: 'POST' }), { ip: '198.51.100.2' });
    expect(post.status).toBe(405);
    expect(post.headers.get('allow')).toBe('GET');
    const cross = await inspectFunction(req('/api/inspect?url=https%3A%2F%2Fexample.com%2F', { headers: { 'sec-fetch-site': 'cross-site' } }), { ip: '198.51.100.2' });
    expect(cross.status).toBe(403);
  });

  it('rate-limits by the client IP Netlify provides', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 45; i++) statuses.push((await inspectFunction(req('/api/inspect?url=invalid'), { ip: '198.51.100.3' })).status);
    expect(statuses.filter((s) => s === 429).length).toBeGreaterThan(0);
    expect((await inspectFunction(req('/api/inspect?url=invalid'), { ip: '198.51.100.4' })).status).toBe(200);
  });

  it('unknown API paths get a JSON 404', async () => {
    const res = notFoundFunction();
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'Not found' });
  });
});
