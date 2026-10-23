/**
 * Optional TypeScript transform hook for `utilities/exchange-rates`.
 * Demonstrates how OpenAct blueprints combine declarative YAML extraction
 * with custom post-processing logic when needed.
 */
export function transform(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object') return raw;
  const record = raw as {
    baseCurrency?: string;
    lastUpdatedUtc?: string;
    rates?: Record<string, number>;
  };

  const rates = record.rates ?? {};
  const majorCurrencies = ['USD', 'EUR', 'GBP', 'JPY', 'CAD', 'CHF', 'AUD'];
  const majorPairs: Record<string, number> = {};

  for (const code of majorCurrencies) {
    if (typeof rates[code] === 'number') {
      majorPairs[code] = rates[code];
    }
  }

  return {
    ...record,
    majorPairs,
  };
}
