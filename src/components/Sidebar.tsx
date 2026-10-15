import { Icon, type IconName } from './Icon';
import type { InternalPage } from '../lib/types';

type SidebarTarget = InternalPage | 'newtab';

const ITEMS: { target: SidebarTarget; label: string; icon: IconName; hint?: string }[] = [
  { target: 'home', label: 'Home', icon: 'home', hint: 'Alt+Home' },
  { target: 'newtab', label: 'New Tab', icon: 'plus', hint: 'Alt+T' },
  { target: 'bookmarks', label: 'Bookmarks', icon: 'bookmark' },
  { target: 'history', label: 'History', icon: 'history' },
  { target: 'games', label: 'Games', icon: 'games' },
  { target: 'apps', label: 'Apps', icon: 'apps' },
];

interface Props {
  expanded: boolean;
  current: InternalPage | null;
  onToggle: () => void;
  onSelect: (target: SidebarTarget) => void;
}

export function Sidebar({ expanded, current, onToggle, onSelect }: Props) {
  const item = (target: SidebarTarget, label: string, icon: IconName, hint?: string) => (
    <button
      key={target}
      type="button"
      className={`side-item${current === target ? ' active' : ''}`}
      onClick={() => onSelect(target)}
      title={hint ? `${label} (${hint})` : label}
      aria-label={label}
      aria-current={current === target ? 'page' : undefined}
      data-testid={`side-${target}`}
    >
      <Icon name={icon} size={20} />
      <span className="side-label">{label}</span>
    </button>
  );

  return (
    <nav className={`sidebar${expanded ? ' expanded' : ''}`} aria-label="Fern navigation">
      <button type="button" className="side-brand" onClick={onToggle} title={expanded ? 'Collapse sidebar' : 'Expand sidebar'} aria-label="Toggle sidebar" aria-expanded={expanded}>
        <span className="brand-mark">
          <Icon name="leaf" size={20} />
        </span>
        <span className="side-label brand-name">Fern</span>
      </button>
      <div className="side-items">{ITEMS.map((i) => item(i.target, i.label, i.icon, i.hint))}</div>
      <div className="side-bottom">{item('settings', 'Settings', 'settings')}</div>
    </nav>
  );
}
