import { INTERNAL_PREFIX, type InternalPage } from './types';
import { buildSearchUrl } from './search';

export const INTERNAL_PAGES: InternalPage[] = ['home', 'bookmarks', 'history', 'games', 'apps', 'settings'];

export function internalUrl(page: InternalPage): string {
  return `${INTERNAL_PREFIX}${page}`;
}

export function parseInternal(url: string): InternalPage | null {
  if (!url.toLowerCase().startsWith(INTERNAL_PREFIX)) return null;
  const page = url.slice(INTERNAL_PREFIX.length).replace(/\/+$/, '').toLowerCase();
  return (INTERNAL_PAGES as string[]).includes(page) ? (page as InternalPage) : null;
}

export function isWebUrl(url: string): boolean {
  return /^https?:\/\//i.test(url);
}

const IPV4 = /^(\d{1,3})(\.\d{1,3}){3}$/;
const HOST_LABEL = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/i;

function looksLikeHost(host: string): boolean {
  const h = host.toLowerCase();
  if (h === 'localhost') return true;
  if (IPV4.test(h)) return h.split('.').every((p) => Number(p) <= 255);
  if (/^\[[0-9a-f:.]+\]$/i.test(h)) return true;
  const labels = h.replace(/\.$/, '').split('.');
  if (labels.length < 2) return false;
  if (!labels.every((l) => HOST_LABEL.test(l) || /^xn--/.test(l))) return false;
  const tld = labels[labels.length - 1];
  return /^[a-z]{2,63}$/.test(tld) || /^xn--[a-z0-9-]+$/.test(tld);
}

export type NormalizedInput =
  | { kind: 'internal'; url: string }
  | { kind: 'url'; url: string }
  | { kind: 'search'; url: string; query: string };

/**
 * Turns address-bar input into something to open:
 *  - fern://pages
 *  - full http(s) URLs
 *  - bare hosts such as "example.com/path" or "localhost:3000"
 *  - everything else becomes a search query. Other schemes (javascript:,
 *    data:, file:, ...) are never navigated to.
 */
export function normalizeInput(raw: string, searchTemplate: string): NormalizedInput | null {
  const input = raw.trim();
  if (!input) return null;

  const internal = parseInternal(input);
  if (internal) return { kind: 'internal', url: internalUrl(internal) };

  const search = (): NormalizedInput => ({ kind: 'search', url: buildSearchUrl(input, searchTemplate), query: input });

  if (/^https?:\/\//i.test(input)) {
    try {
      const url = new URL(input);
      if (!url.hostname) return search();
      return { kind: 'url', url: url.toString() };
    } catch {
      return search();
    }
  }

  if (/\s/.test(input)) return search();

  // Any other explicit scheme (javascript:, data:, file:, chrome:, ...).
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(input)) return search();
  const schemeLike = /^([a-z][a-z0-9+.-]*):(.*)$/i.exec(input);
  if (schemeLike && !/^\d+(\/|$|\?|#)/.test(schemeLike[2])) return search();

  const hostPart = input.split(/[/?#]/)[0];
  const host = hostPart.replace(/:\d{1,5}$/, '');
  if (!looksLikeHost(host)) return search();

  const isLocal = host === 'localhost' || IPV4.test(host) || host.startsWith('[');
  try {
    const url = new URL(`${isLocal ? 'http' : 'https'}://${input}`);
    return { kind: 'url', url: url.toString() };
  } catch {
    return search();
  }
}

/** Human-friendly form of a URL for compact display. */
export function displayHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}
