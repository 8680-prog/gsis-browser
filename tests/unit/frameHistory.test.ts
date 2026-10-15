import { describe, expect, it } from 'vitest';
import {
  EMPTY_FRAME_HISTORY,
  MAX_FRAME_ENTRIES,
  canFrameGoBack,
  canFrameGoForward,
  frameBack,
  frameDepth,
  frameForward,
  recordFrameNavigation,
} from '../../src/lib/frameHistory';

describe('frame history model', () => {
  it('allows stepping back and forward inside the frame that created the entries', () => {
    let h = recordFrameNavigation(EMPTY_FRAME_HISTORY, 'A:1');
    h = recordFrameNavigation(h, 'A:1');
    expect(frameDepth(h, 'A:1')).toBe(2);
    expect(canFrameGoBack(h, 'A:1')).toBe(true);
    expect(canFrameGoForward(h, 'A:1')).toBe(false);
    h = frameBack(h);
    expect(frameDepth(h, 'A:1')).toBe(1);
    expect(canFrameGoForward(h, 'A:1')).toBe(true);
    h = frameBack(h);
    expect(canFrameGoBack(h, 'A:1')).toBe(false); // back at the page Fern opened
    h = frameForward(h);
    expect(frameDepth(h, 'A:1')).toBe(1);
  });

  it('refuses frame back when the latest entry belongs to another frame or an old mount', () => {
    let h = recordFrameNavigation(EMPTY_FRAME_HISTORY, 'A:1');
    h = recordFrameNavigation(h, 'B:1');
    expect(canFrameGoBack(h, 'A:1')).toBe(false); // history.back() would move tab B instead
    expect(canFrameGoBack(h, 'B:1')).toBe(true);
    // After tab A is re-navigated by Fern (new mount A:2), A:1's entries are orphaned.
    expect(canFrameGoBack(h, 'A:2')).toBe(false);
  });

  it('drops forward entries on a new in-frame navigation', () => {
    let h = recordFrameNavigation(EMPTY_FRAME_HISTORY, 'A:1');
    h = recordFrameNavigation(h, 'A:1');
    h = frameBack(h);
    h = recordFrameNavigation(h, 'A:1');
    expect(h.entries).toEqual(['A:1', 'A:1']);
    expect(canFrameGoForward(h, 'A:1')).toBe(false);
  });

  it('caps the number of tracked entries', () => {
    let h = EMPTY_FRAME_HISTORY;
    for (let i = 0; i < MAX_FRAME_ENTRIES + 10; i++) h = recordFrameNavigation(h, 'A:1');
    expect(h.entries).toHaveLength(MAX_FRAME_ENTRIES);
    expect(h.pos).toBe(MAX_FRAME_ENTRIES - 1);
  });

  it('back and forward are no-ops at the ends', () => {
    expect(frameBack(EMPTY_FRAME_HISTORY)).toBe(EMPTY_FRAME_HISTORY);
    const h = recordFrameNavigation(EMPTY_FRAME_HISTORY, 'A:1');
    expect(frameForward(h)).toBe(h);
  });
});
