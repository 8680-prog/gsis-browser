import { createId } from './storage';
import type { LoadStatus, Tab } from './types';

export interface TabsState {
  tabs: Tab[];
  activeId: string;
}

export type TabsAction =
  | { type: 'new'; url: string; activate?: boolean; afterId?: string }
  | { type: 'close'; id: string; fallbackUrl: string }
  | { type: 'activate'; id: string }
  | { type: 'activateIndex'; index: number }
  | { type: 'cycle'; delta: number }
  | { type: 'navigate'; id: string; url: string }
  | { type: 'replaceUrl'; id: string; url: string }
  | { type: 'back'; id: string }
  | { type: 'forward'; id: string }
  | { type: 'reload'; id: string }
  | { type: 'meta'; id: string; title?: string; status?: LoadStatus }
  | { type: 'frameNavigated'; id: string };

const MAX_TAB_HISTORY = 50;

export function createTab(url: string): Tab {
  return { id: createId('tab'), history: [url], index: 0, title: '', status: 'idle', loadId: 0, inFrameNavigations: 0 };
}

export function currentUrl(tab: Tab): string {
  return tab.history[tab.index] ?? '';
}

function updateTab(state: TabsState, id: string, fn: (tab: Tab) => Tab): TabsState {
  let changed = false;
  const tabs = state.tabs.map((t) => {
    if (t.id !== id) return t;
    const next = fn(t);
    if (next !== t) changed = true;
    return next;
  });
  return changed ? { ...state, tabs } : state;
}

const PAGE_RESET: Pick<Tab, 'title' | 'status' | 'inFrameNavigations'> = { title: '', status: 'idle', inFrameNavigations: 0 };

/** Starts a fresh page load in the tab (new loadId remounts the page view). */
function load(tab: Tab, changes: Partial<Tab>): Tab {
  return { ...tab, ...PAGE_RESET, ...changes, loadId: tab.loadId + 1 };
}

export function tabsReducer(state: TabsState, action: TabsAction): TabsState {
  switch (action.type) {
    case 'new': {
      const tab = createTab(action.url);
      const tabs = [...state.tabs];
      const after = action.afterId ? tabs.findIndex((t) => t.id === action.afterId) : -1;
      if (after >= 0) tabs.splice(after + 1, 0, tab);
      else tabs.push(tab);
      return { tabs, activeId: action.activate === false ? state.activeId : tab.id };
    }
    case 'close': {
      const index = state.tabs.findIndex((t) => t.id === action.id);
      if (index < 0) return state;
      const tabs = state.tabs.filter((t) => t.id !== action.id);
      if (tabs.length === 0) {
        // Like a browser window, keep one tab open.
        const tab = createTab(action.fallbackUrl);
        return { tabs: [tab], activeId: tab.id };
      }
      if (state.activeId !== action.id) return { ...state, tabs };
      // Select the tab to the right, or the left one when closing the last tab.
      const next = tabs[Math.min(index, tabs.length - 1)];
      return { tabs, activeId: next.id };
    }
    case 'activate':
      return state.tabs.some((t) => t.id === action.id) && state.activeId !== action.id
        ? { ...state, activeId: action.id }
        : state;
    case 'activateIndex': {
      const tab = action.index < 0 ? state.tabs[state.tabs.length - 1] : state.tabs[action.index];
      return tab ? { ...state, activeId: tab.id } : state;
    }
    case 'cycle': {
      const index = state.tabs.findIndex((t) => t.id === state.activeId);
      const n = state.tabs.length;
      const next = state.tabs[(index + action.delta + n) % n];
      return { ...state, activeId: next.id };
    }
    case 'navigate':
      return updateTab(state, action.id, (tab) => {
        const history = [...tab.history.slice(0, tab.index + 1), action.url].slice(-MAX_TAB_HISTORY);
        return load(tab, { history, index: history.length - 1 });
      });
    case 'replaceUrl':
      return updateTab(state, action.id, (tab) => {
        if (currentUrl(tab) === action.url) return tab;
        const history = [...tab.history];
        history[tab.index] = action.url;
        return { ...tab, history };
      });
    case 'back':
      return updateTab(state, action.id, (tab) =>
        tab.index > 0 ? load(tab, { index: tab.index - 1 }) : tab,
      );
    case 'forward':
      return updateTab(state, action.id, (tab) =>
        tab.index < tab.history.length - 1 ? load(tab, { index: tab.index + 1 }) : tab,
      );
    case 'reload':
      return updateTab(state, action.id, (tab) => load(tab, {}));
    case 'meta':
      return updateTab(state, action.id, (tab) => {
        const title = action.title ?? tab.title;
        const status = action.status ?? tab.status;
        return title === tab.title && status === tab.status ? tab : { ...tab, title, status };
      });
    case 'frameNavigated':
      return updateTab(state, action.id, (tab) => ({ ...tab, inFrameNavigations: tab.inFrameNavigations + 1 }));
    default:
      return state;
  }
}

/** Validates a persisted session so corrupt storage cannot crash the app. */
export function restoreSession(raw: unknown, fallbackUrl: string): TabsState {
  const fresh = (): TabsState => {
    const tab = createTab(fallbackUrl);
    return { tabs: [tab], activeId: tab.id };
  };
  if (!raw || typeof raw !== 'object') return fresh();
  const { tabs, activeId } = raw as Partial<TabsState>;
  if (!Array.isArray(tabs)) return fresh();
  const valid: Tab[] = tabs
    .filter((t): t is Tab => !!t && typeof t.id === 'string' && Array.isArray(t.history) && t.history.length > 0)
    .map((t) => {
      const history = t.history.filter((u): u is string => typeof u === 'string').slice(-MAX_TAB_HISTORY);
      const index = Math.min(Math.max(0, Number(t.index) || 0), history.length - 1);
      return {
        id: t.id,
        history,
        index,
        title: typeof t.title === 'string' ? t.title : '',
        status: 'idle' as const,
        loadId: 0,
        inFrameNavigations: 0,
      };
    })
    .filter((t) => t.history.length > 0);
  if (valid.length === 0) return fresh();
  return { tabs: valid, activeId: valid.some((t) => t.id === activeId) ? (activeId as string) : valid[0].id };
}
