import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { BrowserContext, type BrowserApi, type OpenOptions } from './BrowserContext';
import { Sidebar } from './components/Sidebar';
import { TabStrip } from './components/TabStrip';
import { Toolbar, type ToolbarHandle } from './components/Toolbar';
import { WebFrame } from './components/WebFrame';
import { HomePage } from './pages/HomePage';
import { BookmarksPage, HistoryPage } from './pages/ListPages';
import { CatalogPage } from './pages/CatalogPage';
import { SettingsPage } from './pages/SettingsPage';
import { DEFAULT_SHORTCUTS } from './lib/catalog';
import {
  EMPTY_FRAME_HISTORY,
  canFrameGoBack,
  canFrameGoForward,
  frameBack,
  frameDepth,
  frameForward,
  recordFrameNavigation,
} from './lib/frameHistory';
import { clearInspectCache } from './lib/inspect';
import { SEARCH_ENGINES, searchTemplateFor } from './lib/search';
import { createId, readJson, usePersistentState, writeJson } from './lib/storage';
import { createTab, currentUrl, restoreSession, tabsReducer, type TabsState } from './lib/tabs';
import { internalUrl, isWebUrl, normalizeInput, parseInternal } from './lib/url';
import type { Bookmark, HistoryEntry, InternalPage, LoadStatus, Settings, Shortcut, Tab } from './lib/types';

const KEYS = {
  settings: 'fern.settings',
  bookmarks: 'fern.bookmarks',
  history: 'fern.history',
  shortcuts: 'fern.shortcuts',
  session: 'fern.session',
};

const MAX_HISTORY = 500;

/** Keeps iframe names unique across reloads of Fern itself. */
const SESSION_NONCE = Math.random().toString(36).slice(2, 8);
/** A traversal whose frame load never arrives is forgotten after this long. */
const TRAVERSAL_TIMEOUT_MS = 5000;

/** Identifies one iframe mount: a new Fern navigation or reload is a new mount. */
function mountKey(tab: Tab): string {
  return `${tab.id}:${tab.loadId}`;
}

const DEFAULT_SETTINGS: Settings = {
  theme: 'fern',
  searchEngine: 'duckduckgo',
  customSearchUrl: '',
  homepage: internalUrl('home'),
  checkEmbedding: true,
  restoreSession: true,
  sidebarExpanded: false,
};

function validateSettings(value: Settings): Settings {
  const s = { ...DEFAULT_SETTINGS, ...(value && typeof value === 'object' ? value : {}) };
  if (!['fern', 'midnight', 'ember', 'light'].includes(s.theme)) s.theme = DEFAULT_SETTINGS.theme;
  if (s.searchEngine !== 'custom' && !SEARCH_ENGINES.some((e) => e.id === s.searchEngine)) s.searchEngine = DEFAULT_SETTINGS.searchEngine;
  if (typeof s.homepage !== 'string' || !(isWebUrl(s.homepage) || parseInternal(s.homepage))) s.homepage = DEFAULT_SETTINGS.homepage;
  if (typeof s.customSearchUrl !== 'string') s.customSearchUrl = '';
  s.checkEmbedding = s.checkEmbedding !== false;
  s.restoreSession = s.restoreSession !== false;
  s.sidebarExpanded = s.sidebarExpanded === true;
  return s;
}

function validateList<T extends { url: string }>(value: T[]): T[] {
  return Array.isArray(value) ? value.filter((v) => v && typeof v.url === 'string' && isWebUrl(v.url)) : [];
}

function defaultShortcuts(): Shortcut[] {
  return DEFAULT_SHORTCUTS.map((s) => ({ ...s, id: createId('sc') }));
}

function openExternal(url: string) {
  if (isWebUrl(url)) window.open(url, '_blank', 'noopener,noreferrer');
}

function initialTabs(settings: Settings): TabsState {
  if (settings.restoreSession) return restoreSession(readJson(KEYS.session, null), settings.homepage);
  const tab = createTab(settings.homepage);
  return { tabs: [tab], activeId: tab.id };
}

function InternalView({ page }: { page: InternalPage }) {
  switch (page) {
    case 'home':
      return <HomePage />;
    case 'bookmarks':
      return <BookmarksPage />;
    case 'history':
      return <HistoryPage />;
    case 'games':
      return <CatalogPage kind="games" />;
    case 'apps':
      return <CatalogPage kind="apps" />;
    case 'settings':
      return <SettingsPage />;
  }
}

export default function App() {
  const [settings, setSettings] = usePersistentState(KEYS.settings, DEFAULT_SETTINGS, validateSettings);
  const [bookmarks, setBookmarks] = usePersistentState<Bookmark[]>(KEYS.bookmarks, [], validateList);
  const [history, setHistory] = usePersistentState<HistoryEntry[]>(KEYS.history, [], validateList);
  const [shortcuts, setShortcuts] = usePersistentState<Shortcut[]>(KEYS.shortcuts, defaultShortcuts(), validateList);
  const [state, dispatch] = useReducer(tabsReducer, settings, initialTabs);
  const [visited, setVisited] = useState<Set<string>>(() => new Set([state.activeId]));
  const toolbarRef = useRef<ToolbarHandle>(null);
  const [frameHistory, setFrameHistory] = useState(EMPTY_FRAME_HISTORY);
  // Back/forward traversals Fern started, so the resulting frame load is not mistaken for a new link click.
  const pendingTraversals = useRef<{ key: string; at: number }[]>([]);

  const activeTab = state.tabs.find((t) => t.id === state.activeId) ?? state.tabs[0];
  const activeUrl = currentUrl(activeTab);
  const searchTemplate = searchTemplateFor(settings.searchEngine, settings.customSearchUrl);
  const activeKey = mountKey(activeTab);
  const frameCanGoBack = canFrameGoBack(frameHistory, activeKey);
  const frameCanGoForward = canFrameGoForward(frameHistory, activeKey);

  // Tabs restored from a previous session load lazily, when first shown.
  if (!visited.has(state.activeId)) setVisited(new Set(visited).add(state.activeId));

  useEffect(() => {
    document.documentElement.dataset.theme = settings.theme;
  }, [settings.theme]);

  useEffect(() => {
    if (!settings.restoreSession) {
      writeJson(KEYS.session, null);
      return;
    }
    writeJson(KEYS.session, {
      activeId: state.activeId,
      tabs: state.tabs.map((t) => ({ id: t.id, history: t.history, index: t.index, title: t.title })),
    });
  }, [state, settings.restoreSession]);

  useEffect(() => {
    const page = parseInternal(activeUrl);
    document.title = page ? 'Fern' : `${activeTab.title || activeUrl} – Fern`;
  }, [activeUrl, activeTab.title]);

  const addVisit = useCallback(
    (url: string) => {
      if (!isWebUrl(url)) return;
      const now = Date.now();
      setHistory((h) => [{ url, title: '', visitedAt: now }, ...h.filter((e) => !(e.url === url && now - e.visitedAt < 60_000))].slice(0, MAX_HISTORY));
    },
    [setHistory],
  );

  const navigate = useCallback(
    (tabId: string, url: string) => {
      dispatch({ type: 'navigate', id: tabId, url });
      addVisit(url);
    },
    [addVisit],
  );

  const newTab = useCallback(
    (url: string = settings.homepage) => {
      dispatch({ type: 'new', url });
      addVisit(url);
    },
    [settings.homepage, addVisit],
  );

  const closeTab = useCallback((id: string) => dispatch({ type: 'close', id, fallbackUrl: settings.homepage }), [settings.homepage]);

  const open = useCallback(
    (input: string, options: OpenOptions = {}) => {
      const target = normalizeInput(input, searchTemplate);
      if (!target) return false;
      if (options.newTab) newTab(target.url);
      else navigate(state.activeId, target.url);
      return true;
    },
    [searchTemplate, newTab, navigate, state.activeId],
  );

  /** Steps the embedded page itself through the browser's session history. */
  const traverseFrame = useCallback((key: string, direction: -1 | 1) => {
    pendingTraversals.current.push({ key, at: Date.now() });
    setFrameHistory((h) => (direction < 0 ? frameBack(h) : frameForward(h)));
    if (direction < 0) window.history.back();
    else window.history.forward();
  }, []);

  const goBack = useCallback(() => {
    // Links followed inside the page are undone first, like a normal browser.
    if (frameCanGoBack) return traverseFrame(activeKey, -1);
    if (activeTab.index === 0) return;
    dispatch({ type: 'back', id: activeTab.id });
    addVisit(activeTab.history[activeTab.index - 1]);
  }, [frameCanGoBack, traverseFrame, activeKey, activeTab, addVisit]);

  const goForward = useCallback(() => {
    if (frameCanGoForward) return traverseFrame(activeKey, 1);
    if (activeTab.index >= activeTab.history.length - 1) return;
    dispatch({ type: 'forward', id: activeTab.id });
    addVisit(activeTab.history[activeTab.index + 1]);
  }, [frameCanGoForward, traverseFrame, activeKey, activeTab, addVisit]);

  const onFrameNavigated = useCallback((tab: Tab) => {
    const key = mountKey(tab);
    const now = Date.now();
    const pending = pendingTraversals.current.filter((p) => now - p.at < TRAVERSAL_TIMEOUT_MS);
    const match = pending.findIndex((p) => p.key === key);
    if (match >= 0) {
      // This load is the result of Fern's own back/forward, already reflected in frameHistory.
      pending.splice(match, 1);
      pendingTraversals.current = pending;
      return;
    }
    pendingTraversals.current = pending;
    setFrameHistory((h) => recordFrameNavigation(h, key));
    dispatch({ type: 'frameNavigated', id: tab.id });
  }, []);

  const reload = useCallback(
    (tab: Tab = activeTab) => {
      clearInspectCache(currentUrl(tab));
      dispatch({ type: 'reload', id: tab.id });
    },
    [activeTab],
  );

  const toggleBookmark = useCallback(
    (url: string, title: string) => {
      if (!isWebUrl(url)) return;
      setBookmarks((list) =>
        list.some((b) => b.url === url)
          ? list.filter((b) => b.url !== url)
          : [{ id: createId('bm'), url, title: title || url, createdAt: Date.now() }, ...list],
      );
    },
    [setBookmarks],
  );

  const onStatus = useCallback(
    (tab: Tab, status: LoadStatus, title?: string) => {
      dispatch({ type: 'meta', id: tab.id, status, title });
      const url = currentUrl(tab);
      if (title && (status === 'loading' || status === 'loaded') && isWebUrl(url)) {
        setHistory((h) => {
          const i = h.findIndex((e) => e.url === url);
          if (i < 0 || h[i].title === title) return h;
          const next = [...h];
          next[i] = { ...next[i], title };
          return next;
        });
      }
    },
    [setHistory],
  );

  // Keyboard shortcuts (only reach Fern while focus is outside the embedded page).
  const shortcutHandler = useRef<(e: KeyboardEvent) => void>(() => {});
  shortcutHandler.current = (e: KeyboardEvent) => {
    const ctrl = e.ctrlKey || e.metaKey;
    const key = e.key.toLowerCase();
    let handled = true;
    if ((ctrl && key === 'l') || (e.altKey && key === 'd') || e.key === 'F6') toolbarRef.current?.focusAddress();
    else if ((ctrl || e.altKey) && !e.shiftKey && key === 't') newTab();
    else if ((ctrl || e.altKey) && !e.shiftKey && key === 'w') closeTab(activeTab.id);
    else if ((ctrl && key === 'r') || e.key === 'F5') reload();
    else if (ctrl && key === 'd') toggleBookmark(activeUrl, activeTab.title);
    else if (e.altKey && e.shiftKey && e.key === 'ArrowRight') dispatch({ type: 'cycle', delta: 1 });
    else if (e.altKey && e.shiftKey && e.key === 'ArrowLeft') dispatch({ type: 'cycle', delta: -1 });
    else if (e.altKey && e.key === 'ArrowLeft') goBack();
    else if (e.altKey && e.key === 'ArrowRight') goForward();
    else if (e.altKey && e.key === 'Home') navigate(activeTab.id, settings.homepage);
    else if (e.altKey && /^[1-9]$/.test(e.key)) dispatch({ type: 'activateIndex', index: e.key === '9' ? -1 : Number(e.key) - 1 });
    else handled = false;
    if (handled) e.preventDefault();
  };
  useEffect(() => {
    const listener = (e: KeyboardEvent) => shortcutHandler.current(e);
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, []);

  const api: BrowserApi = useMemo(
    () => ({
      settings,
      updateSettings: (patch) => setSettings((s) => validateSettings({ ...s, ...patch })),
      searchTemplate,
      bookmarks,
      isBookmarked: (url) => bookmarks.some((b) => b.url === url),
      toggleBookmark,
      removeBookmark: (id) => setBookmarks((list) => list.filter((b) => b.id !== id)),
      clearBookmarks: () => setBookmarks([]),
      history,
      removeHistoryEntry: (entry) => setHistory((h) => h.filter((e) => e !== entry && !(e.url === entry.url && e.visitedAt === entry.visitedAt))),
      clearHistory: () => setHistory([]),
      shortcuts,
      addShortcut: (title, url) => {
        const target = normalizeInput(url, searchTemplate);
        if (!target || target.kind !== 'url') return false;
        const name = title.trim() || new URL(target.url).hostname.replace(/^www\./, '');
        setShortcuts((list) => [...list, { id: createId('sc'), title: name, url: target.url }]);
        return true;
      },
      removeShortcut: (id) => setShortcuts((list) => list.filter((s) => s.id !== id)),
      resetShortcuts: () => setShortcuts(defaultShortcuts()),
      open,
    }),
    [settings, setSettings, searchTemplate, bookmarks, toggleBookmark, setBookmarks, history, setHistory, shortcuts, setShortcuts, open],
  );

  const currentPage = parseInternal(activeUrl);

  return (
    <BrowserContext.Provider value={api}>
      <div className="app">
        <Sidebar
          expanded={settings.sidebarExpanded}
          current={currentPage}
          onToggle={() => api.updateSettings({ sidebarExpanded: !settings.sidebarExpanded })}
          onSelect={(target) => {
            if (target === 'newtab') newTab();
            else if (target === 'home') navigate(activeTab.id, settings.homepage);
            else if (currentPage !== target) navigate(activeTab.id, internalUrl(target));
          }}
        />
        <div className="main">
          <TabStrip
            tabs={state.tabs}
            activeId={state.activeId}
            onActivate={(id) => dispatch({ type: 'activate', id })}
            onClose={closeTab}
            onNew={() => newTab()}
          />
          <Toolbar
            ref={toolbarRef}
            tab={activeTab}
            bookmarked={api.isBookmarked(activeUrl)}
            canGoBack={frameCanGoBack || activeTab.index > 0}
            canGoForward={frameCanGoForward || activeTab.index < activeTab.history.length - 1}
            frameDepth={frameDepth(frameHistory, activeKey)}
            onBack={goBack}
            onForward={goForward}
            onReload={() => reload()}
            onHome={() => navigate(activeTab.id, settings.homepage)}
            onSubmit={(input) => open(input)}
            onToggleBookmark={() => toggleBookmark(activeUrl, activeTab.title)}
            onOpenExternal={() => openExternal(activeUrl)}
          />
          <main className="viewport">
            {state.tabs.map((tab) => {
              if (!visited.has(tab.id)) return null;
              const url = currentUrl(tab);
              const page = parseInternal(url);
              const active = tab.id === state.activeId;
              return (
                <div key={tab.id} className="tab-view" hidden={!active} data-testid={active ? 'active-view' : undefined}>
                  {page ? (
                    <InternalView key={tab.loadId} page={page} />
                  ) : isWebUrl(url) ? (
                    <WebFrame
                      key={tab.loadId}
                      url={url}
                      frameName={`fern-${SESSION_NONCE}-${tab.id}-${tab.loadId}`}
                      active={active}
                      checkEmbedding={settings.checkEmbedding}
                      onStatus={(status, title) => onStatus(tab, status, title)}
                      onResolvedUrl={(resolved) => dispatch({ type: 'replaceUrl', id: tab.id, url: resolved })}
                      onFrameNavigated={() => onFrameNavigated(tab)}
                      onRetry={() => reload(tab)}
                      onNavigate={(next) => navigate(tab.id, next)}
                    />
                  ) : (
                    <div className="page-state">
                      <div className="state-card">
                        <h2>Unknown page</h2>
                        <p className="state-url">{url}</p>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </main>
        </div>
      </div>
    </BrowserContext.Provider>
  );
}
