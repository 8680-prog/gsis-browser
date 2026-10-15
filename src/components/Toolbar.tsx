import { forwardRef, useImperativeHandle, useRef, useState } from 'react';
import { Icon } from './Icon';
import { currentUrl } from '../lib/tabs';
import { isWebUrl, parseInternal } from '../lib/url';
import type { Tab } from '../lib/types';

export interface ToolbarHandle {
  focusAddress: () => void;
}

interface Props {
  tab: Tab;
  bookmarked: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  /** Links followed inside the embedded page since Fern opened it. */
  frameDepth: number;
  onBack: () => void;
  onForward: () => void;
  onReload: () => void;
  onHome: () => void;
  onSubmit: (input: string) => void;
  onToggleBookmark: () => void;
  onOpenExternal: () => void;
}

export const Toolbar = forwardRef<ToolbarHandle, Props>(function Toolbar(
  { tab, bookmarked, canGoBack, canGoForward, frameDepth, onBack, onForward, onReload, onHome, onSubmit, onToggleBookmark, onOpenExternal },
  ref,
) {
  const inputRef = useRef<HTMLInputElement>(null);
  // While the user is typing, keep their draft; otherwise show the tab's URL.
  const [draft, setDraft] = useState<{ tabId: string; loadId: number; text: string } | null>(null);

  useImperativeHandle(ref, () => ({
    focusAddress: () => {
      inputRef.current?.focus();
      inputRef.current?.select();
    },
  }));

  const url = currentUrl(tab);
  const page = parseInternal(url);
  const isWeb = isWebUrl(url);
  const shown = page === 'home' ? '' : url;
  const editing = draft && draft.tabId === tab.id && draft.loadId === tab.loadId;
  const value = editing ? draft.text : shown;
  const busy = tab.status === 'checking' || tab.status === 'loading';

  return (
    <div className="toolbar">
      <div className="nav-buttons">
        <button type="button" className="icon-btn" onClick={onBack} disabled={!canGoBack} aria-label="Back" title="Back (Alt+Left)" data-testid="back">
          <Icon name="back" />
        </button>
        <button
          type="button"
          className="icon-btn"
          onClick={onForward}
          disabled={!canGoForward}
          aria-label="Forward"
          title="Forward (Alt+Right)"
          data-testid="forward"
        >
          <Icon name="forward" />
        </button>
        <button type="button" className="icon-btn" onClick={onReload} aria-label="Reload" title="Reload (Ctrl+R)" data-testid="reload">
          <Icon name="reload" className={busy ? 'spin-slow' : undefined} />
        </button>
        <button type="button" className="icon-btn" onClick={onHome} aria-label="Home" title="Home (Alt+Home)" data-testid="home">
          <Icon name="home" />
        </button>
      </div>

      <form
        className="address"
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          const text = (editing ? draft.text : value).trim();
          if (!text) return;
          setDraft(null);
          inputRef.current?.blur();
          onSubmit(text);
        }}
      >
        <span className="address-icon" title={isWeb ? (url.startsWith('https:') ? 'Secure connection (https)' : 'Not secure (http)') : 'Fern page'}>
          <Icon name={page ? 'leaf' : url.startsWith('https:') ? 'lock' : isWeb ? 'unlock' : 'search'} size={15} />
        </span>
        <input
          ref={inputRef}
          className="address-input"
          value={value}
          placeholder="Search or enter address"
          spellCheck={false}
          autoCapitalize="off"
          autoComplete="off"
          aria-label="Address and search bar"
          data-testid="address"
          onChange={(e) => setDraft({ tabId: tab.id, loadId: tab.loadId, text: e.target.value })}
          onFocus={(e) => e.currentTarget.select()}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              setDraft(null);
              e.currentTarget.blur();
            }
          }}
        />
        {busy && <span className="address-busy" aria-hidden="true" />}
        {frameDepth > 0 && isWeb && (
          <span
            className="address-hint"
            data-testid="frame-depth-hint"
            title={`You followed ${frameDepth === 1 ? 'a link' : `${frameDepth} links`} inside this page. Browsers do not let Fern read another site's address, so the bar shows the page Fern opened. Back steps back inside the page; Reload returns to the address shown.`}
          >
            <Icon name="info" size={14} />
          </span>
        )}
        {isWeb && (
          <button
            type="button"
            className={`icon-btn small${bookmarked ? ' on' : ''}`}
            onClick={onToggleBookmark}
            aria-label={bookmarked ? 'Remove bookmark' : 'Bookmark this page'}
            aria-pressed={bookmarked}
            title={bookmarked ? 'Remove bookmark (Ctrl+D)' : 'Bookmark (Ctrl+D)'}
            data-testid="bookmark-toggle"
          >
            <Icon name="star" size={16} filled={bookmarked} />
          </button>
        )}
      </form>

      <button
        type="button"
        className="icon-btn"
        onClick={onOpenExternal}
        disabled={!isWeb}
        aria-label="Open in a real browser tab"
        title="Open this page in a normal browser tab"
        data-testid="open-external"
      >
        <Icon name="external" />
      </button>
    </div>
  );
});
