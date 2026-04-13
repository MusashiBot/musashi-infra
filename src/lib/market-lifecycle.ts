import type { MarketStatus } from '../types/market.js';

export function isMarketActive(status: MarketStatus, resolved: boolean): boolean {
  return status === 'open' && resolved === false;
}
