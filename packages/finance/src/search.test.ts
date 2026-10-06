import { describe, expect, it } from 'vitest';
import { parseAmount, ruleBasedInterpreter, type InterpretContext } from './search';

const ctx: InterpretContext = {
  today: '2026-10-15',
  minorPerMajor: 100,
  currencySymbol: '$',
  categories: [
    { id: 'food', name: 'Food' },
    { id: 'eat', name: 'Eating out' },
    { id: 'rent', name: 'Rent' },
  ],
};
const q = (s: string) => ruleBasedInterpreter.interpret(s, ctx);

describe('parseAmount', () => {
  it('is exact in minor units', () => {
    expect(parseAmount('50', 100)).toBe(5000);
    expect(parseAmount('$1,250.50', 100)).toBe(125050);
    expect(parseAmount('0.1', 100)).toBe(10);
    expect(parseAmount('19.999', 100)).toBe(1999);
    expect(parseAmount('abc', 100)).toBeNull();
  });
  it('handles currencies without minor units', () => {
    expect(parseAmount('1500', 1)).toBe(1500);
  });
});

describe('ruleBasedInterpreter', () => {
  it('leaves plain words alone', () => {
    expect(q('Starbucks')).toEqual({ text: 'Starbucks', categoryIds: [], understood: [] });
  });

  it('understands amounts', () => {
    expect(q('coffee over $50')).toMatchObject({
      text: 'coffee',
      amountMin: 5001,
      understood: ['over $50'],
    });
    expect(q('under 20')).toMatchObject({ amountMax: 1999, text: '' });
    expect(q('between 10 and 30.50')).toMatchObject({ amountMin: 1000, amountMax: 3050 });
    expect(q('lunch $12.50')).toMatchObject({ amountMin: 1250, amountMax: 1250, text: 'lunch' });
  });

  it('does not treat a bare whole number as money (it may be a name or an id)', () => {
    expect(q('invoice 2024')).toMatchObject({ text: 'invoice 2024', understood: [] });
  });

  it('understands dates relative to today', () => {
    expect(q('last month')).toMatchObject({ dateFrom: '2026-09-01', dateTo: '2026-09-30' });
    expect(q('this month')).toMatchObject({ dateFrom: '2026-10-01', dateTo: '2026-10-15' });
    expect(q('yesterday')).toMatchObject({ dateFrom: '2026-10-14', dateTo: '2026-10-14' });
    expect(q('last week')).toMatchObject({ dateFrom: '2026-10-05', dateTo: '2026-10-11' });
    expect(q('last year')).toMatchObject({ dateFrom: '2025-01-01', dateTo: '2025-12-31' });
  });

  it('resolves a month name to its most recent past occurrence', () => {
    expect(q('rent in march')).toMatchObject({ dateFrom: '2026-03-01', dateTo: '2026-03-31' });
    expect(q('december')).toMatchObject({ dateFrom: '2025-12-01', dateTo: '2025-12-31' });
    expect(q('october')).toMatchObject({ dateFrom: '2026-10-01', dateTo: '2026-10-31' });
  });

  it('treats "may" as a word unless it is clearly the month', () => {
    expect(q('may i have a refund').dateFrom).toBeUndefined();
    expect(q('trip in may')).toMatchObject({ dateFrom: '2026-05-01', text: 'trip' });
  });

  it('understands type and category, longest category name first', () => {
    expect(q('expenses in Eating out last month')).toMatchObject({
      type: 'expense',
      categoryIds: ['eat'],
      dateFrom: '2026-09-01',
      understood: ['expenses', 'last month', 'in Eating out'],
      text: '',
    });
    expect(q('income this year')).toMatchObject({ type: 'income', dateFrom: '2026-01-01' });
  });

  it('combines everything and says what it understood', () => {
    const r = q('show me food expenses over $50 last month');
    expect(r).toMatchObject({
      type: 'expense',
      categoryIds: ['food'],
      amountMin: 5001,
      dateFrom: '2026-09-01',
      text: '',
    });
    expect(r.understood).toEqual(['expenses', 'over $50', 'last month', 'in Food']);
  });

  it('is case-insensitive and tolerant of extra spaces', () => {
    expect(q('  EXPENSES   Over   $5  ')).toMatchObject({ type: 'expense', amountMin: 501 });
  });
});
