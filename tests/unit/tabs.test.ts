import { describe, expect, it } from 'vitest';
import { createTab, currentUrl, restoreSession, tabsReducer, type TabsState } from '../../src/lib/tabs';

const HOME = 'fern://home';

function start(...urls: string[]): TabsState {
  const tabs = urls.map(createTab);
  return { tabs, activeId: tabs[0].id };
}

describe('tabsReducer', () => {
  it('opens new tabs and activates them', () => {
    let s = start(HOME);
    s = tabsReducer(s, { type: 'new', url: 'https://a.example/' });
    expect(s.tabs).toHaveLength(2);
    expect(currentUrl(s.tabs.find((t) => t.id === s.activeId)!)).toBe('https://a.example/');
  });

  it('keeps independent history per tab with back/forward', () => {
    let s = start(HOME, HOME);
    const [a, b] = s.tabs;
    s = tabsReducer(s, { type: 'navigate', id: a.id, url: 'https://one.example/' });
    s = tabsReducer(s, { type: 'navigate', id: a.id, url: 'https://two.example/' });
    s = tabsReducer(s, { type: 'navigate', id: b.id, url: 'https://other.example/' });
    s = tabsReducer(s, { type: 'back', id: a.id });
    const tabA = s.tabs[0];
    expect(currentUrl(tabA)).toBe('https://one.example/');
    expect(currentUrl(s.tabs[1])).toBe('https://other.example/');
    s = tabsReducer(s, { type: 'forward', id: a.id });
    expect(currentUrl(s.tabs[0])).toBe('https://two.example/');
    // Navigating after going back drops the forward entries.
    s = tabsReducer(s, { type: 'back', id: a.id });
    s = tabsReducer(s, { type: 'navigate', id: a.id, url: 'https://three.example/' });
    expect(s.tabs[0].history).toEqual([HOME, 'https://one.example/', 'https://three.example/']);
    expect(s.tabs[0].index).toBe(2);
  });

  it('bumps loadId on navigation and reload but not on URL replacement', () => {
    let s = start(HOME);
    const id = s.tabs[0].id;
    s = tabsReducer(s, { type: 'navigate', id, url: 'http://a.example/' });
    const afterNav = s.tabs[0].loadId;
    s = tabsReducer(s, { type: 'replaceUrl', id, url: 'https://a.example/' });
    expect(s.tabs[0].loadId).toBe(afterNav);
    expect(currentUrl(s.tabs[0])).toBe('https://a.example/');
    s = tabsReducer(s, { type: 'reload', id });
    expect(s.tabs[0].loadId).toBe(afterNav + 1);
  });

  it('selects a sensible tab when closing', () => {
    let s = start('https://1.example/', 'https://2.example/', 'https://3.example/');
    const [t1, t2, t3] = s.tabs;
    s = tabsReducer(s, { type: 'activate', id: t2.id });
    s = tabsReducer(s, { type: 'close', id: t2.id, fallbackUrl: HOME });
    expect(s.activeId).toBe(t3.id); // right neighbour
    s = tabsReducer(s, { type: 'close', id: t3.id, fallbackUrl: HOME });
    expect(s.activeId).toBe(t1.id); // left when closing the last tab
    s = tabsReducer(s, { type: 'close', id: t1.id, fallbackUrl: HOME });
    expect(s.tabs).toHaveLength(1);
    expect(currentUrl(s.tabs[0])).toBe(HOME); // never zero tabs
  });

  it('closing a background tab keeps the active tab', () => {
    let s = start('https://1.example/', 'https://2.example/');
    s = tabsReducer(s, { type: 'close', id: s.tabs[1].id, fallbackUrl: HOME });
    expect(s.activeId).toBe(s.tabs[0].id);
  });

  it('restores sessions defensively', () => {
    expect(restoreSession('garbage', HOME).tabs).toHaveLength(1);
    const restored = restoreSession(
      { activeId: 'b', tabs: [{ id: 'a', history: [], index: 0 }, { id: 'b', history: ['https://x.example/', 5], index: 9, title: 'X' }] },
      HOME,
    );
    expect(restored.tabs).toHaveLength(1);
    expect(restored.activeId).toBe('b');
    expect(restored.tabs[0].index).toBe(0);
    expect(restored.tabs[0].status).toBe('idle');
  });
});
