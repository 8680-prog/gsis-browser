import { useMemo, useState } from 'react';
import { Icon } from '../components/Icon';
import { useBrowser } from '../BrowserContext';
import { displayHost } from '../lib/url';
import type { HistoryEntry } from '../lib/types';

function matches(filter: string, ...fields: string[]): boolean {
  const f = filter.trim().toLowerCase();
  return !f || fields.some((x) => x.toLowerCase().includes(f));
}

export function BookmarksPage() {
  const { bookmarks, open, removeBookmark } = useBrowser();
  const [filter, setFilter] = useState('');
  const shown = bookmarks.filter((b) => matches(filter, b.title, b.url));

  return (
    <div className="internal-page" data-testid="page-bookmarks">
      <header className="page-header">
        <h1>Bookmarks</h1>
        <input className="filter" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter bookmarks" aria-label="Filter bookmarks" />
      </header>
      {bookmarks.length === 0 ? (
        <p className="empty">No bookmarks yet. Press the star in the address bar (or Ctrl+D) on any page to save it here.</p>
      ) : (
        <ul className="list">
          {shown.map((b) => (
            <li key={b.id} className="list-row" data-testid="bookmark-row">
              <button type="button" className="list-main" onClick={() => open(b.url)} title={b.url}>
                <span className="list-letter">{(b.title || displayHost(b.url)).charAt(0).toUpperCase()}</span>
                <span className="list-text">
                  <span className="list-title">{b.title || displayHost(b.url)}</span>
                  <span className="list-sub">{b.url}</span>
                </span>
              </button>
              <button type="button" className="icon-btn small" onClick={() => open(b.url, { newTab: true })} aria-label="Open in new Fern tab" title="Open in new tab">
                <Icon name="plus" size={16} />
              </button>
              <button type="button" className="icon-btn small" onClick={() => removeBookmark(b.id)} aria-label={`Delete bookmark ${b.title}`} title="Delete">
                <Icon name="trash" size={16} />
              </button>
            </li>
          ))}
          {shown.length === 0 && <p className="empty">No bookmarks match “{filter}”.</p>}
        </ul>
      )}
    </div>
  );
}

function dayLabel(ts: number): string {
  const d = new Date(ts);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return d.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
}

export function HistoryPage() {
  const { history, open, removeHistoryEntry, clearHistory } = useBrowser();
  const [filter, setFilter] = useState('');

  const groups = useMemo(() => {
    const result: { label: string; entries: HistoryEntry[] }[] = [];
    for (const entry of history) {
      if (!matches(filter, entry.title, entry.url)) continue;
      const label = dayLabel(entry.visitedAt);
      const last = result[result.length - 1];
      if (last && last.label === label) last.entries.push(entry);
      else result.push({ label, entries: [entry] });
    }
    return result;
  }, [history, filter]);

  return (
    <div className="internal-page" data-testid="page-history">
      <header className="page-header">
        <h1>History</h1>
        <input className="filter" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Search history" aria-label="Search history" />
        {history.length > 0 && (
          <button
            type="button"
            className="btn"
            onClick={() => {
              if (window.confirm('Clear all browsing history stored by Fern?')) clearHistory();
            }}
          >
            <Icon name="trash" size={16} /> Clear history
          </button>
        )}
      </header>
      {history.length === 0 && <p className="empty">Pages you open in Fern will be listed here. History is stored only in this browser.</p>}
      {groups.map((group) => (
        <section key={group.label} className="history-group">
          <h2>{group.label}</h2>
          <ul className="list">
            {group.entries.map((entry) => (
              <li key={`${entry.url}-${entry.visitedAt}`} className="list-row" data-testid="history-row">
                <span className="list-time">{new Date(entry.visitedAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}</span>
                <button type="button" className="list-main" onClick={() => open(entry.url)} title={entry.url}>
                  <span className="list-text">
                    <span className="list-title">{entry.title || displayHost(entry.url)}</span>
                    <span className="list-sub">{entry.url}</span>
                  </span>
                </button>
                <button type="button" className="icon-btn small" onClick={() => removeHistoryEntry(entry)} aria-label="Remove from history" title="Remove">
                  <Icon name="close" size={14} />
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
