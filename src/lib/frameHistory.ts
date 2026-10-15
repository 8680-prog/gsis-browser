/**
 * Model of the browser's joint session history entries created by links
 * followed *inside* embedded pages.
 *
 * Fern never adds top-level history entries itself (each Fern navigation
 * mounts a fresh iframe), so every entry after the page's own belongs to an
 * in-frame navigation. Each entry is tagged with the iframe mount that created
 * it. `window.history.back()` only moves the frame we expect when the current
 * entry was created by that same mount; entries of removed iframes are no-ops,
 * so in that case Fern falls back to its own per-tab history.
 *
 * Cross-origin pages hide their URL, so this model is the only reliable way to
 * know whether "Back" can step back inside the page.
 */

export interface FrameHistory {
  /** Mount key (tabId:loadId) of the frame that created each entry, oldest first. */
  entries: string[];
  /** Index of the current entry; -1 means the page's base entry. */
  pos: number;
}

/** Browsers cap session history at about 50 entries; stay below that. */
export const MAX_FRAME_ENTRIES = 45;

export const EMPTY_FRAME_HISTORY: FrameHistory = { entries: [], pos: -1 };

/** A new in-frame navigation by `key` drops any forward entries, like a browser. */
export function recordFrameNavigation(history: FrameHistory, key: string): FrameHistory {
  let entries = [...history.entries.slice(0, history.pos + 1), key];
  const overflow = entries.length - MAX_FRAME_ENTRIES;
  if (overflow > 0) entries = entries.slice(overflow);
  return { entries, pos: entries.length - 1 };
}

export function canFrameGoBack(history: FrameHistory, key: string): boolean {
  return history.pos >= 0 && history.entries[history.pos] === key;
}

export function canFrameGoForward(history: FrameHistory, key: string): boolean {
  return history.entries[history.pos + 1] === key;
}

export function frameBack(history: FrameHistory): FrameHistory {
  return history.pos >= 0 ? { ...history, pos: history.pos - 1 } : history;
}

export function frameForward(history: FrameHistory): FrameHistory {
  return history.pos < history.entries.length - 1 ? { ...history, pos: history.pos + 1 } : history;
}

/** How many in-frame steps the frame `key` currently is away from the page Fern opened. */
export function frameDepth(history: FrameHistory, key: string): number {
  let depth = 0;
  for (let i = 0; i <= history.pos; i++) if (history.entries[i] === key) depth++;
  return depth;
}
