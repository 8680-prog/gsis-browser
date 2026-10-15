import { useState } from 'react';
import { Icon } from '../components/Icon';
import { useBrowser } from '../BrowserContext';
import { APPS, GAMES } from '../lib/catalog';
import { displayHost } from '../lib/url';

export function CatalogPage({ kind }: { kind: 'games' | 'apps' }) {
  const { open } = useBrowser();
  const items = kind === 'games' ? GAMES : APPS;
  const categories = ['All', ...Array.from(new Set(items.map((i) => i.category)))];
  const [category, setCategory] = useState('All');
  const shown = category === 'All' ? items : items.filter((i) => i.category === category);

  return (
    <div className="internal-page" data-testid={`page-${kind}`}>
      <header className="page-header">
        <h1>{kind === 'games' ? 'Games' : 'Apps'}</h1>
        <div className="chips" role="group" aria-label="Categories">
          {categories.map((c) => (
            <button key={c} type="button" className={`chip${c === category ? ' active' : ''}`} onClick={() => setCategory(c)} aria-pressed={c === category}>
              {c}
            </button>
          ))}
        </div>
      </header>
      <p className="page-note">
        These are links to free public sites. Each one is checked when you open it: it plays inside Fern if the site allows embedding,
        otherwise you get an option to open it in a normal browser tab.
      </p>
      <div className="catalog-grid">
        {shown.map((item) => (
          <div key={item.url} className="catalog-card" data-testid="catalog-card">
            <button type="button" className="catalog-main" onClick={() => open(item.url)} title={item.url}>
              <span className="catalog-icon">{item.name.charAt(0)}</span>
              <span className="catalog-name">{item.name}</span>
              <span className="catalog-desc">{item.description}</span>
              <span className="catalog-host">{displayHost(item.url)}</span>
            </button>
            <button type="button" className="icon-btn small catalog-newtab" onClick={() => open(item.url, { newTab: true })} aria-label={`Open ${item.name} in new tab`} title="Open in new tab">
              <Icon name="plus" size={15} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
