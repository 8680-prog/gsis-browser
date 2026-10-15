import { describe, expect, it } from 'vitest';
import { normalizeInput } from '../../src/lib/url';
import { buildSearchUrl, isValidSearchTemplate, searchTemplateFor } from '../../src/lib/search';

const DDG = 'https://duckduckgo.com/?q=%s';
const n = (s: string) => normalizeInput(s, DDG);

describe('normalizeInput', () => {
  it('keeps full http(s) URLs', () => {
    expect(n('https://example.com/a?b=1')).toEqual({ kind: 'url', url: 'https://example.com/a?b=1' });
    expect(n('HTTP://Example.COM')).toEqual({ kind: 'url', url: 'http://example.com/' });
  });

  it('adds https:// to bare domains, paths and ports', () => {
    expect(n('example.com')?.url).toBe('https://example.com/');
    expect(n('en.wikipedia.org/wiki/Fern')?.url).toBe('https://en.wikipedia.org/wiki/Fern');
    expect(n('example.com:8443/x')?.url).toBe('https://example.com:8443/x');
    expect(n('xn--bcher-kva.example')?.kind).toBe('url');
  });

  it('uses http:// for localhost and IP addresses', () => {
    expect(n('localhost:3000')?.url).toBe('http://localhost:3000/');
    expect(n('192.168.1.1')?.url).toBe('http://192.168.1.1/');
  });

  it('treats ordinary text as a search query', () => {
    expect(n('how do ferns reproduce')).toEqual({
      kind: 'search',
      query: 'how do ferns reproduce',
      url: 'https://duckduckgo.com/?q=how%20do%20ferns%20reproduce',
    });
    expect(n('ferns')?.kind).toBe('search');
    expect(n('999.1.1.1')?.kind).toBe('search');
    expect(n('c++ & rust')?.url).toBe('https://duckduckgo.com/?q=c%2B%2B%20%26%20rust');
  });

  it('never navigates to dangerous schemes', () => {
    for (const input of ['javascript:alert(1)', 'data:text/html,<b>x</b>', 'file:///etc/passwd', 'vbscript:x', 'chrome://settings']) {
      expect(n(input)?.kind).toBe('search');
    }
  });

  it('recognises internal pages and ignores empty input', () => {
    expect(n('fern://settings')).toEqual({ kind: 'internal', url: 'fern://settings' });
    expect(n('fern://nope')?.kind).toBe('search');
    expect(n('   ')).toBeNull();
  });
});

describe('search engines', () => {
  it('validates custom templates', () => {
    expect(isValidSearchTemplate('https://search.example/?q=%s')).toBe(true);
    expect(isValidSearchTemplate('https://search.example/?q=')).toBe(false);
    expect(isValidSearchTemplate('javascript:%s')).toBe(false);
  });

  it('falls back to the default engine for an invalid custom template', () => {
    expect(searchTemplateFor('custom', 'bad')).toBe(DDG);
    expect(searchTemplateFor('custom', 'https://s.example/?q=%s')).toBe('https://s.example/?q=%s');
    expect(searchTemplateFor('wikipedia', '')).toContain('wikipedia.org');
  });

  it('encodes queries', () => {
    expect(buildSearchUrl(' a/b?c ', 'https://x.example/?q=%s')).toBe('https://x.example/?q=a%2Fb%3Fc');
  });
});
