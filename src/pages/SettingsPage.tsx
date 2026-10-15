import { useState } from 'react';
import { useBrowser } from '../BrowserContext';
import { SEARCH_ENGINES, isValidSearchTemplate } from '../lib/search';
import { normalizeInput, internalUrl } from '../lib/url';
import type { SearchEngineId, ThemeId } from '../lib/types';

const THEMES: { id: ThemeId; name: string }[] = [
  { id: 'fern', name: 'Fern (dark green)' },
  { id: 'midnight', name: 'Midnight (dark blue)' },
  { id: 'ember', name: 'Ember (dark warm)' },
  { id: 'light', name: 'Light' },
];

const SHORTCUTS: [string, string][] = [
  ['Ctrl+L, Alt+D or F6', 'Focus the address bar'],
  ['Alt+T (Ctrl+T in fullscreen/app windows)', 'New tab'],
  ['Alt+W (Ctrl+W in fullscreen/app windows)', 'Close tab'],
  ['Alt+1 … Alt+9', 'Switch to tab 1–8, or the last tab'],
  ['Alt+Shift+Right / Alt+Shift+Left', 'Next / previous tab'],
  ['Alt+Left / Alt+Right', 'Back / forward'],
  ['Ctrl+R or F5', 'Reload page'],
  ['Alt+Home', 'Go to homepage'],
  ['Ctrl+D', 'Bookmark current page'],
];

export function SettingsPage() {
  const { settings, updateSettings, clearHistory, clearBookmarks, resetShortcuts, searchTemplate } = useBrowser();
  const [customDraft, setCustomDraft] = useState(settings.customSearchUrl);
  const [homeDraft, setHomeDraft] = useState(settings.homepage === internalUrl('home') ? '' : settings.homepage);
  const [message, setMessage] = useState('');

  const customValid = isValidSearchTemplate(customDraft);

  return (
    <div className="internal-page settings-page" data-testid="page-settings">
      <header className="page-header">
        <h1>Settings</h1>
      </header>

      <section className="settings-section">
        <h2>Appearance</h2>
        <label className="field">
          <span>Theme</span>
          <select value={settings.theme} onChange={(e) => updateSettings({ theme: e.target.value as ThemeId })} data-testid="theme-select">
            {THEMES.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field check">
          <input type="checkbox" checked={settings.sidebarExpanded} onChange={(e) => updateSettings({ sidebarExpanded: e.target.checked })} />
          <span>Show sidebar labels</span>
        </label>
      </section>

      <section className="settings-section">
        <h2>Search</h2>
        <label className="field">
          <span>Search engine</span>
          <select
            value={settings.searchEngine}
            onChange={(e) => updateSettings({ searchEngine: e.target.value as SearchEngineId })}
            data-testid="engine-select"
          >
            {SEARCH_ENGINES.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
            <option value="custom">Custom…</option>
          </select>
        </label>
        {settings.searchEngine === 'custom' && (
          <form
            className="field"
            onSubmit={(e) => {
              e.preventDefault();
              if (customValid) {
                updateSettings({ customSearchUrl: customDraft.trim() });
                setMessage('Custom search engine saved.');
              }
            }}
          >
            <span>Custom search URL (use %s for the query)</span>
            <div className="row">
              <input value={customDraft} onChange={(e) => setCustomDraft(e.target.value)} placeholder="https://example.com/search?q=%s" aria-invalid={!customValid} />
              <button type="submit" className="btn" disabled={!customValid}>
                Save
              </button>
            </div>
            {!customValid && customDraft && <span className="form-error">Must be an http(s) URL containing %s.</span>}
          </form>
        )}
        <p className="hint">
          Searches go to <code>{searchTemplate.replace('%s', '…')}</code>. Most search engines forbid being embedded, so results
          usually open with a “doesn’t allow embedding” notice and a one-click option to open them in a normal tab. Wikipedia search
          generally can be embedded.
        </p>
      </section>

      <section className="settings-section">
        <h2>Startup</h2>
        <form
          className="field"
          onSubmit={(e) => {
            e.preventDefault();
            if (!homeDraft.trim()) {
              updateSettings({ homepage: internalUrl('home') });
              setMessage('Homepage reset to the Fern start page.');
              return;
            }
            const result = normalizeInput(homeDraft, searchTemplate);
            if (result && result.kind !== 'search') {
              updateSettings({ homepage: result.url });
              setHomeDraft(result.kind === 'internal' ? '' : result.url);
              setMessage('Homepage saved.');
            } else {
              setMessage('Homepage must be a web address such as example.com.');
            }
          }}
        >
          <span>Homepage and new tab page (leave empty for the Fern start page)</span>
          <div className="row">
            <input value={homeDraft} onChange={(e) => setHomeDraft(e.target.value)} placeholder="Fern start page" data-testid="homepage-input" />
            <button type="submit" className="btn">
              Save
            </button>
          </div>
        </form>
        <label className="field check">
          <input type="checkbox" checked={settings.restoreSession} onChange={(e) => updateSettings({ restoreSession: e.target.checked })} />
          <span>Reopen my tabs when Fern is reloaded</span>
        </label>
        <label className="field check">
          <input type="checkbox" checked={settings.checkEmbedding} onChange={(e) => updateSettings({ checkEmbedding: e.target.checked })} />
          <span>Check whether a site allows embedding before loading it (recommended)</span>
        </label>
      </section>

      {message && (
        <p className="settings-message" role="status">
          {message}
        </p>
      )}

      <section className="settings-section">
        <h2>Data</h2>
        <p className="hint">Settings, bookmarks, history and open tabs are stored only in this browser (localStorage).</p>
        <div className="row wrap">
          <button type="button" className="btn" onClick={() => window.confirm('Clear all history?') && clearHistory()}>
            Clear history
          </button>
          <button type="button" className="btn" onClick={() => window.confirm('Delete all bookmarks?') && clearBookmarks()}>
            Delete bookmarks
          </button>
          <button type="button" className="btn" onClick={resetShortcuts}>
            Reset home shortcuts
          </button>
        </div>
      </section>

      <section className="settings-section">
        <h2>Keyboard shortcuts</h2>
        <p className="hint">
          Shortcuts work while focus is in Fern’s own interface. When you click into an embedded page, it receives the keys instead.
          Browsers reserve Ctrl+T and Ctrl+W in normal windows, so Fern also accepts Alt+T and Alt+W.
        </p>
        <table className="shortcut-table">
          <tbody>
            {SHORTCUTS.map(([keys, action]) => (
              <tr key={keys}>
                <td>
                  <kbd>{keys}</kbd>
                </td>
                <td>{action}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="settings-section">
        <h2>How embedding works</h2>
        <ul className="explain">
          <li>Fern shows websites in an iframe. Each website decides whether it may be embedded, using the X-Frame-Options header or the Content-Security-Policy “frame-ancestors” rule. Your browser enforces that decision and no web app can override it.</li>
          <li>Before loading, Fern’s server reads only those headers and the page title, so Fern can explain a refusal instead of showing a blank box. It never relays page content and refuses private or internal network addresses.</li>
          <li>Links you follow inside an embedded page stay inside it. Browser security hides the new address from Fern, so Back/Forward step through pages you opened from Fern.</li>
          <li>Sign-in inside embedded pages often fails because browsers block third-party cookies. Use “Open in new browser tab” for those sites.</li>
        </ul>
      </section>
    </div>
  );
}
