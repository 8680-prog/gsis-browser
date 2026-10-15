export type InternalPage = 'home' | 'bookmarks' | 'history' | 'games' | 'apps' | 'settings';

export const INTERNAL_PREFIX = 'fern://';

export type LoadStatus = 'idle' | 'checking' | 'loading' | 'loaded' | 'slow' | 'blocked' | 'error';

export interface Tab {
  id: string;
  /** Addresses opened in this tab through Fern (address bar, links, shortcuts). */
  history: string[];
  index: number;
  title: string;
  status: LoadStatus;
  /** Incremented on every navigation or reload; remounts the page view. */
  loadId: number;
  /** Navigations that happened inside the embedded page (not observable cross-origin). */
  inFrameNavigations: number;
}

export type ThemeId = 'fern' | 'midnight' | 'ember' | 'light';

export type SearchEngineId = 'duckduckgo' | 'bing' | 'google' | 'brave' | 'startpage' | 'wikipedia' | 'custom';

export interface Settings {
  theme: ThemeId;
  searchEngine: SearchEngineId;
  customSearchUrl: string;
  homepage: string;
  checkEmbedding: boolean;
  restoreSession: boolean;
  sidebarExpanded: boolean;
}

export interface Bookmark {
  id: string;
  url: string;
  title: string;
  createdAt: number;
}

export interface HistoryEntry {
  url: string;
  title: string;
  visitedAt: number;
}

export interface Shortcut {
  id: string;
  url: string;
  title: string;
}
