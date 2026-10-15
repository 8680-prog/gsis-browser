import type { SearchEngineId } from './types';

export interface SearchEngine {
  id: SearchEngineId;
  name: string;
  template: string;
}

export const SEARCH_ENGINES: SearchEngine[] = [
  { id: 'duckduckgo', name: 'DuckDuckGo', template: 'https://duckduckgo.com/?q=%s' },
  { id: 'bing', name: 'Bing', template: 'https://www.bing.com/search?q=%s' },
  { id: 'google', name: 'Google', template: 'https://www.google.com/search?q=%s' },
  { id: 'brave', name: 'Brave Search', template: 'https://search.brave.com/search?q=%s' },
  { id: 'startpage', name: 'Startpage', template: 'https://www.startpage.com/do/search?q=%s' },
  { id: 'wikipedia', name: 'Wikipedia', template: 'https://en.wikipedia.org/w/index.php?search=%s' },
];

/** A custom template must be an http(s) URL containing the %s placeholder. */
export function isValidSearchTemplate(template: string): boolean {
  if (!template.includes('%s')) return false;
  try {
    const url = new URL(template.replace('%s', 'test'));
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

export function searchTemplateFor(engine: SearchEngineId, customTemplate: string): string {
  if (engine === 'custom' && isValidSearchTemplate(customTemplate)) return customTemplate;
  return (SEARCH_ENGINES.find((e) => e.id === engine) ?? SEARCH_ENGINES[0]).template;
}

export function buildSearchUrl(query: string, template: string): string {
  return template.replace('%s', encodeURIComponent(query.trim()));
}
