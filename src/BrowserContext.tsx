import { createContext, useContext } from 'react';
import type { Bookmark, HistoryEntry, Settings, Shortcut } from './lib/types';

export interface OpenOptions {
  newTab?: boolean;
}

export interface BrowserApi {
  settings: Settings;
  updateSettings: (patch: Partial<Settings>) => void;
  searchTemplate: string;

  bookmarks: Bookmark[];
  isBookmarked: (url: string) => boolean;
  toggleBookmark: (url: string, title: string) => void;
  removeBookmark: (id: string) => void;
  clearBookmarks: () => void;

  history: HistoryEntry[];
  removeHistoryEntry: (entry: HistoryEntry) => void;
  clearHistory: () => void;

  shortcuts: Shortcut[];
  addShortcut: (title: string, url: string) => boolean;
  removeShortcut: (id: string) => void;
  resetShortcuts: () => void;

  /** Opens address-bar style input (URL, host or search text). */
  open: (input: string, options?: OpenOptions) => boolean;
}

export const BrowserContext = createContext<BrowserApi | null>(null);

export function useBrowser(): BrowserApi {
  const api = useContext(BrowserContext);
  if (!api) throw new Error('useBrowser must be used inside BrowserContext');
  return api;
}
