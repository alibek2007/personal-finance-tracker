/** Supported currencies. `exponent` = number of minor-unit decimal places. */
export const CURRENCIES = {
  USD: { exponent: 2, symbol: '$', name: 'US Dollar' },
  EUR: { exponent: 2, symbol: '€', name: 'Euro' },
  GBP: { exponent: 2, symbol: '£', name: 'British Pound' },
  KZT: { exponent: 2, symbol: '₸', name: 'Kazakhstani Tenge' },
  RUB: { exponent: 2, symbol: '₽', name: 'Russian Ruble' },
  JPY: { exponent: 0, symbol: '¥', name: 'Japanese Yen' },
} as const;

export type CurrencyCode = keyof typeof CURRENCIES;

export const CURRENCY_CODES = Object.keys(CURRENCIES) as CurrencyCode[];

export function isCurrencyCode(value: string): value is CurrencyCode {
  return Object.prototype.hasOwnProperty.call(CURRENCIES, value);
}

export function currencyExponent(code: CurrencyCode): number {
  return CURRENCIES[code].exponent;
}
