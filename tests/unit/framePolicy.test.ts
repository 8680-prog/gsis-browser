import { describe, expect, it } from 'vitest';
import { evaluateFramePolicy } from '../../server/framePolicy';

const APP = 'https://fern.example.app';
const page = new URL('https://site.example/page');
const check = (csp: string[], xfo: string[], ancestor = APP) => evaluateFramePolicy({ csp, xfo }, page, ancestor);

describe('evaluateFramePolicy', () => {
  it('allows pages without framing headers', () => {
    expect(check([], []).embeddable).toBe(true);
  });

  it('blocks X-Frame-Options DENY and SAMEORIGIN', () => {
    expect(check([], ['DENY'])).toMatchObject({ embeddable: false, source: 'xfo' });
    expect(check([], ['sameorigin'])).toMatchObject({ embeddable: false, source: 'xfo' });
    expect(check([], ['SAMEORIGIN'], 'https://site.example').embeddable).toBe(true);
  });

  it('treats conflicting X-Frame-Options as blocked and ignores invalid values', () => {
    expect(check([], ['DENY, SAMEORIGIN']).embeddable).toBe(false);
    expect(check([], ['ALLOW-FROM https://fern.example.app']).embeddable).toBe(true);
  });

  it("blocks frame-ancestors 'none' and 'self'", () => {
    expect(check(["default-src 'self'; frame-ancestors 'none'"], [])).toMatchObject({ embeddable: false, source: 'csp' });
    expect(check(["frame-ancestors 'self'"], []).embeddable).toBe(false);
  });

  it('lets frame-ancestors override X-Frame-Options', () => {
    expect(check(['frame-ancestors *'], ['DENY']).embeddable).toBe(true);
    expect(check(['frame-ancestors https://fern.example.app'], ['DENY']).embeddable).toBe(true);
  });

  it('matches host, wildcard and scheme sources', () => {
    expect(check(['frame-ancestors https://*.example.app'], []).embeddable).toBe(true);
    expect(check(['frame-ancestors *.other.com'], []).embeddable).toBe(false);
    expect(check(['frame-ancestors https:'], []).embeddable).toBe(true);
    expect(check(['frame-ancestors http://fern.example.app'], []).embeddable).toBe(true); // http->https upgrade
    expect(check(['frame-ancestors https://fern.example.app:8443'], []).embeddable).toBe(false);
    expect(check(['frame-ancestors fern.example.app:*'], []).embeddable).toBe(true);
  });

  it('enforces every policy when several are sent', () => {
    expect(check(['frame-ancestors *', "frame-ancestors 'none'"], []).embeddable).toBe(false);
    expect(check(["frame-ancestors *, frame-ancestors 'self'"], []).embeddable).toBe(false);
  });

  it('works for a local http origin', () => {
    expect(check(['frame-ancestors http://localhost:5173'], [], 'http://localhost:5173').embeddable).toBe(true);
    expect(check(['frame-ancestors https://localhost:5173'], [], 'http://localhost:5173').embeddable).toBe(false);
  });
});
