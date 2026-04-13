import { describe, expect, it } from 'vitest';

import { isMarketActive } from '../../src/lib/market-lifecycle.js';

describe('isMarketActive', () => {
  it('returns true only for unresolved open markets', () => {
    expect(isMarketActive('open', false)).toBe(true);
    expect(isMarketActive('closed', false)).toBe(false);
    expect(isMarketActive('resolved', true)).toBe(false);
    expect(isMarketActive('open', true)).toBe(false);
  });
});
