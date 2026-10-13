// Financial Modeling Prep (FMP) Stock Service (Feature 3 - Real-time Portfolio Pricing)
import { Investment } from '../types';

export interface StockQuote {
  symbol: string;
  name: string;
  price: number;
  changesPercentage: number;
  change: number;
  dayLow?: number;
  dayHigh?: number;
  yearHigh?: number;
  yearLow?: number;
  exchange?: string;
  previousClose?: number;
}

/**
 * Extract clean stock ticker symbol from name string (e.g. "Apple Inc. (AAPL)" -> "AAPL", "VOO" -> "VOO")
 */
export function extractStockSymbol(name: string): string {
  const parenMatch = name.match(/\(([A-Za-z0-9.]+)\)/);
  if (parenMatch) return parenMatch[1].toUpperCase();

  const tokenMatch = name.match(/\b([A-Za-z0-9]{1,6}(?:\.[A-Za-z]{2})?)\b/);
  return tokenMatch ? tokenMatch[1].toUpperCase() : name.trim().toUpperCase();
}

/**
 * Fetch USD/THB exchange rate from FMP or fallback to 35.5
 */
export async function fetchUsdThbRate(apiKey: string): Promise<number> {
  const fallback = 35.5;
  if (!apiKey) return fallback;

  try {
    const url = `https://financialmodelingprep.com/api/v3/quote/USDTHB?apikey=${apiKey}`;
    const res = await fetch(url);
    if (!res.ok) return fallback;

    const data = (await res.json()) as StockQuote[];
    if (Array.isArray(data) && data.length > 0 && data[0].price > 0) {
      return data[0].price;
    }
  } catch (err) {
    console.warn('[Stock Service] Failed to fetch USDTHB exchange rate:', err);
  }
  return fallback;
}

/**
 * Fetch real-time stock quote from Financial Modeling Prep API
 */
export async function fetchStockQuote(apiKey: string, symbol: string): Promise<StockQuote | null> {
  if (!apiKey || !symbol) return null;

  const clean = extractStockSymbol(symbol);
  try {
    // 1. Try primary symbol (e.g. AAPL, VOO, NVDA)
    const url = `https://financialmodelingprep.com/api/v3/quote/${encodeURIComponent(clean)}?apikey=${apiKey}`;
    const res = await fetch(url);
    if (res.ok) {
      const data = (await res.json()) as StockQuote[];
      if (Array.isArray(data) && data.length > 0 && typeof data[0].price === 'number') {
        return data[0];
      }
    }

    // 2. If no result and symbol has no dot, try with Thai SET suffix (.BK)
    if (!clean.includes('.')) {
      const bkUrl = `https://financialmodelingprep.com/api/v3/quote/${encodeURIComponent(clean + '.BK')}?apikey=${apiKey}`;
      const bkRes = await fetch(bkUrl);
      if (bkRes.ok) {
        const bkData = (await bkRes.json()) as StockQuote[];
        if (Array.isArray(bkData) && bkData.length > 0 && typeof bkData[0].price === 'number') {
          return bkData[0];
        }
      }
    }
  } catch (err) {
    console.warn(`[Stock Service] Error fetching quote for ${symbol}:`, err);
  }

  return null;
}

/**
 * Sync real-time stock prices for a user's investment portfolio in D1
 */
export async function syncPortfolioStockPrices(
  db: D1Database,
  userId: string,
  apiKey: string
): Promise<void> {
  if (!apiKey) return;

  try {
    // Get all user investments
    const { results } = await db
      .prepare('SELECT * FROM investments WHERE user_id = ?')
      .bind(userId)
      .all<Investment>();

    const items = results || [];
    if (items.length === 0) return;

    // Filter stock/fund assets
    const stockItems = items.filter((inv) => {
      const isStockType =
        inv.asset_type.toLowerCase().includes('stock') ||
        inv.asset_type.toLowerCase().includes('หุ้น') ||
        inv.institution.toLowerCase().includes('dime') ||
        inv.institution.toLowerCase().includes('streaming');
      return isStockType;
    });

    if (stockItems.length === 0) return;

    const usdThbRate = await fetchUsdThbRate(apiKey);

    // Fetch and update in parallel
    await Promise.allSettled(
      stockItems.map(async (inv) => {
        const symbol = extractStockSymbol(inv.name);
        const quote = await fetchStockQuote(apiKey, symbol);
        if (!quote || quote.price <= 0) return;

        let newCurrentValue: number | null = null;

        // 1. Try parsing shares from note (e.g. "0.5 หุ้น", "shares: 0.5")
        const noteText = inv.note || '';
        const sharesMatch = noteText.match(/([0-9]+(?:\.[0-9]+)?)\s*(?:หุ้น|shares|units)/i);

        if (sharesMatch) {
          const shares = parseFloat(sharesMatch[1]);
          if (shares > 0) {
            const isThaiStock =
              symbol.endsWith('.BK') ||
              inv.institution.toLowerCase().includes('streaming') ||
              inv.asset_type.includes('หุ้นไทย');

            if (isThaiStock) {
              newCurrentValue = Math.round(shares * quote.price * 100) / 100;
            } else {
              // US / Foreign stock (priced in USD, converted to THB)
              newCurrentValue = Math.round(shares * quote.price * usdThbRate * 100) / 100;
            }
          }
        }

        // 2. Fallback: If shares not found, calculate using quote's daily percentage change
        if (newCurrentValue === null || newCurrentValue <= 0) {
          if (typeof quote.changesPercentage === 'number' && inv.current_value > 0) {
            const dailyFactor = 1 + quote.changesPercentage / 100;
            newCurrentValue = Math.round(inv.current_value * dailyFactor * 100) / 100;
          }
        }

        // Update database if new current value computed
        if (newCurrentValue !== null && newCurrentValue > 0) {
          await db
            .prepare(
              'UPDATE investments SET current_value = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?'
            )
            .bind(newCurrentValue, inv.id, userId)
            .run();
          console.log(
            `[Stock Service] Updated ${inv.name} (${symbol}): price=${quote.price}, new_val=฿${newCurrentValue}`
          );
        }
      })
    );
  } catch (err) {
    console.error('[Stock Service] Failed to sync portfolio prices:', err);
  }
}
