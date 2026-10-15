import { useState } from 'react';
import { Icon } from '../components/Icon';
import { useBrowser } from '../BrowserContext';
import { SEARCH_ENGINES } from '../lib/search';
import { displayHost } from '../lib/url';

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 5) return 'Good night';
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

export function HomePage() {
  const { open, shortcuts, addShortcut, removeShortcut, settings } = useBrowser();
  const [query, setQuery] = useState('');
  const [adding, setAdding] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newUrl, setNewUrl] = useState('');
  const [addError, setAddError] = useState('');

  const engineName =
    settings.searchEngine === 'custom' ? 'your custom engine' : SEARCH_ENGINES.find((e) => e.id === settings.searchEngine)?.name ?? 'the web';

  return (
    <div className="internal-page home-page" data-testid="page-home">
      <div className="home-hero">
        <div className="home-logo">
          <Icon name="leaf" size={34} />
        </div>
        <h1>{greeting()}</h1>
        <form
          className="home-search"
          onSubmit={(e) => {
            e.preventDefault();
            if (open(query)) setQuery('');
          }}
        >
          <Icon name="search" size={18} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={`Search with ${engineName} or type an address`}
            aria-label="Search or enter address"
            data-testid="home-search"
            autoFocus
          />
          <button type="submit" className="btn primary">
            Go
          </button>
        </form>
      </div>

      <section className="shortcuts" aria-label="Shortcuts">
        {shortcuts.map((s) => (
          <div key={s.id} className="shortcut">
            <button type="button" className="shortcut-main" onClick={() => open(s.url)} title={s.url} data-testid="shortcut">
              <span className="shortcut-icon">{s.title.charAt(0).toUpperCase()}</span>
              <span className="shortcut-title">{s.title}</span>
              <span className="shortcut-host">{displayHost(s.url)}</span>
            </button>
            <button type="button" className="shortcut-remove" aria-label={`Remove ${s.title}`} onClick={() => removeShortcut(s.id)}>
              <Icon name="close" size={12} />
            </button>
          </div>
        ))}
        {adding ? (
          <form
            className="shortcut add-form"
            onSubmit={(e) => {
              e.preventDefault();
              if (addShortcut(newTitle, newUrl)) {
                setAdding(false);
                setNewTitle('');
                setNewUrl('');
                setAddError('');
              } else {
                setAddError('Enter a valid web address.');
              }
            }}
          >
            <input value={newTitle} onChange={(e) => setNewTitle(e.target.value)} placeholder="Name" aria-label="Shortcut name" />
            <input value={newUrl} onChange={(e) => setNewUrl(e.target.value)} placeholder="example.com" aria-label="Shortcut address" required />
            {addError && <span className="form-error">{addError}</span>}
            <div className="row">
              <button type="submit" className="btn small primary">
                Add
              </button>
              <button type="button" className="btn small" onClick={() => setAdding(false)}>
                Cancel
              </button>
            </div>
          </form>
        ) : (
          <button type="button" className="shortcut shortcut-add" onClick={() => setAdding(true)}>
            <Icon name="plus" size={20} />
            <span>Add shortcut</span>
          </button>
        )}
      </section>

      <p className="home-footnote">
        Pages open inside Fern when the site permits embedding. Sites that forbid it (most search engines, social networks and
        sign-in pages) get a clear notice and a button to open them in a normal browser tab.
      </p>
    </div>
  );
}
