import { Icon } from './Icon';
import { currentUrl } from '../lib/tabs';
import { displayHost, isWebUrl, parseInternal } from '../lib/url';
import type { Tab } from '../lib/types';

interface Props {
  tabs: Tab[];
  activeId: string;
  onActivate: (id: string) => void;
  onClose: (id: string) => void;
  onNew: () => void;
}

const PAGE_TITLES: Record<string, string> = {
  home: 'New Tab',
  bookmarks: 'Bookmarks',
  history: 'History',
  games: 'Games',
  apps: 'Apps',
  settings: 'Settings',
};

export function tabLabel(tab: Tab): string {
  const url = currentUrl(tab);
  const page = parseInternal(url);
  if (page) return PAGE_TITLES[page];
  return tab.title || (isWebUrl(url) ? displayHost(url) : url) || 'New Tab';
}

function TabIcon({ tab }: { tab: Tab }) {
  if (tab.status === 'checking' || tab.status === 'loading') return <span className="spinner" aria-label="Loading" />;
  if (tab.status === 'blocked' || tab.status === 'error') return <Icon name="alert" size={14} className="tab-warn" />;
  const url = currentUrl(tab);
  if (parseInternal(url)) return <Icon name="leaf" size={14} className="tab-leaf" />;
  const letter = displayHost(url).charAt(0).toUpperCase() || '?';
  return <span className="tab-letter">{letter}</span>;
}

export function TabStrip({ tabs, activeId, onActivate, onClose, onNew }: Props) {
  return (
    <div className="tabstrip" role="tablist" aria-label="Open tabs">
      {tabs.map((tab) => {
        const label = tabLabel(tab);
        const active = tab.id === activeId;
        return (
          <div
            key={tab.id}
            role="tab"
            tabIndex={active ? 0 : -1}
            aria-selected={active}
            className={`tab${active ? ' active' : ''}`}
            title={`${label}\n${currentUrl(tab)}`}
            onClick={() => onActivate(tab.id)}
            onAuxClick={(e) => {
              if (e.button === 1) {
                e.preventDefault();
                onClose(tab.id);
              }
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') onActivate(tab.id);
            }}
            data-testid="tab"
          >
            <TabIcon tab={tab} />
            <span className="tab-title">{label}</span>
            <button
              type="button"
              className="tab-close"
              aria-label={`Close ${label}`}
              onClick={(e) => {
                e.stopPropagation();
                onClose(tab.id);
              }}
              data-testid="tab-close"
            >
              <Icon name="close" size={13} />
            </button>
          </div>
        );
      })}
      <button type="button" className="tab-new" onClick={onNew} aria-label="New tab" title="New tab (Alt+T)" data-testid="new-tab">
        <Icon name="plus" size={16} />
      </button>
    </div>
  );
}
