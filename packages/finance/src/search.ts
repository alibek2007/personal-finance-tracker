import { addDays, addMonths, endOfMonth, parseIso, startOfMonth, startOfWeek } from './periods';

/**
 * What a search box means. The structured result is the contract: today a small rule-based interpreter
 * fills it in, and a language model could fill the same shape later without touching the search service
 * or the screens.
 */
export interface InterpretedQuery {
  /** Words left over for plain text matching (description, merchant, notes). */
  text: string;
  type?: 'income' | 'expense';
  /** Absolute amount bounds in minor units, inclusive. */
  amountMin?: number;
  amountMax?: number;
  dateFrom?: string;
  dateTo?: string;
  categoryIds: string[];
  /** Plain-language description of what was understood, e.g. ["expenses", "over $50", "last month"]. */
  understood: string[];
}

export interface InterpretContext {
  today: string;
  /** Minor units per major unit (100 for dollars). */
  minorPerMajor: number;
  currencySymbol: string;
  categories: { id: string; name: string }[];
}

export interface SearchInterpreter {
  interpret(query: string, ctx: InterpretContext): InterpretedQuery;
}

const MONTHS = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
];

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** "50", "$50", "1,250.50" -> minor units, or null. Exact: no floats. */
export function parseAmount(raw: string, minorPerMajor: number): number | null {
  const cleaned = raw.replace(/[^\d.,]/g, '').replace(/,/g, '');
  if (!/^\d+(\.\d+)?$/.test(cleaned)) return null;
  const [whole = '0', frac = ''] = cleaned.split('.');
  const digits = String(minorPerMajor).length - 1;
  const fraction = frac.padEnd(digits, '0').slice(0, digits);
  return Number(whole) * minorPerMajor + (fraction ? Number(fraction) : 0);
}

const NUM = String.raw`([$€£₸₽¥]?\s?\d[\d,]*(?:\.\d+)?)`;

/**
 * Deterministic, forgiving, and honest: anything it does not recognise stays as search text, and what it
 * did recognise is reported in `understood` so the person can see (and undo) the interpretation.
 */
export const ruleBasedInterpreter: SearchInterpreter = {
  interpret(query, ctx) {
    let rest = ` ${query.toLowerCase().trim().replace(/\s+/g, ' ')} `;
    const result: InterpretedQuery = { text: '', categoryIds: [], understood: [] };
    const fmtMajor = (minor: number) =>
      `${ctx.currencySymbol}${(minor / ctx.minorPerMajor).toLocaleString('en-US', {
        maximumFractionDigits: 2,
      })}`;
    const take = (re: RegExp): RegExpExecArray | null => {
      const m = re.exec(rest);
      if (m) rest = rest.replace(m[0], ' ');
      return m;
    };

    // ---- amounts: "over $50", "under 20", "between 10 and 30", "$12.50"
    const between = take(new RegExp(String.raw`\sbetween\s${NUM}\s(?:and|to|-)\s${NUM}\s`));
    if (between) {
      const a = parseAmount(between[1]!, ctx.minorPerMajor);
      const b = parseAmount(between[2]!, ctx.minorPerMajor);
      if (a !== null && b !== null) {
        result.amountMin = Math.min(a, b);
        result.amountMax = Math.max(a, b);
        result.understood.push(
          `between ${fmtMajor(result.amountMin)} and ${fmtMajor(result.amountMax)}`,
        );
      }
    }
    const over = take(new RegExp(String.raw`\s(?:over|above|more than|greater than|>)\s?${NUM}\s`));
    if (over) {
      const v = parseAmount(over[1]!, ctx.minorPerMajor);
      if (v !== null) {
        result.amountMin = v + 1;
        result.understood.push(`over ${fmtMajor(v)}`);
      }
    }
    const under = take(
      new RegExp(String.raw`\s(?:under|below|less than|cheaper than|<)\s?${NUM}\s`),
    );
    if (under) {
      const v = parseAmount(under[1]!, ctx.minorPerMajor);
      if (v !== null && v > 0) {
        result.amountMax = v - 1;
        result.understood.push(`under ${fmtMajor(v)}`);
      }
    }
    // A bare amount only when it is clearly money: a currency symbol or a decimal point.
    const exact = take(
      new RegExp(String.raw`\s((?:[$€£₸₽¥]\s?\d[\d,]*(?:\.\d+)?)|(?:\d[\d,]*\.\d{1,2}))\s`),
    );
    if (exact) {
      const v = parseAmount(exact[1]!, ctx.minorPerMajor);
      if (v !== null) {
        result.amountMin = v;
        result.amountMax = v;
        result.understood.push(`exactly ${fmtMajor(v)}`);
      }
    }

    // ---- dates
    const { y, m } = parseIso(ctx.today);
    const setRange = (from: string, to: string, label: string) => {
      result.dateFrom = from;
      result.dateTo = to;
      result.understood.push(label);
    };
    if (take(/\s(?:last month|previous month)\s/)) {
      const prev = addMonths(startOfMonth(ctx.today), -1);
      setRange(prev, endOfMonth(prev), 'last month');
    } else if (take(/\sthis month\s/)) {
      setRange(startOfMonth(ctx.today), ctx.today, 'this month');
    } else if (take(/\slast week\s/)) {
      const start = addDays(startOfWeek(ctx.today), -7);
      setRange(start, addDays(start, 6), 'last week');
    } else if (take(/\sthis week\s/)) {
      setRange(startOfWeek(ctx.today), ctx.today, 'this week');
    } else if (take(/\slast year\s/)) {
      setRange(`${y - 1}-01-01`, `${y - 1}-12-31`, 'last year');
    } else if (take(/\sthis year\s/)) {
      setRange(`${y}-01-01`, ctx.today, 'this year');
    } else if (take(/\syesterday\s/)) {
      const d = addDays(ctx.today, -1);
      setRange(d, d, 'yesterday');
    } else if (take(/\stoday\s/)) {
      setRange(ctx.today, ctx.today, 'today');
    } else {
      // A month name means its most recent occurrence not in the future ("october" in March = last October).
      for (const [i, name] of MONTHS.entries()) {
        if (name === 'may' && !/\sin may\s/.test(rest)) continue; // "may" is also a word
        const re = new RegExp(String.raw`\s(?:in\s)?${name}\s`);
        if (take(re)) {
          const year = i + 1 > m ? y - 1 : y;
          const start = `${year}-${String(i + 1).padStart(2, '0')}-01`;
          setRange(start, endOfMonth(start), `${name[0]!.toUpperCase()}${name.slice(1)} ${year}`);
          break;
        }
      }
    }

    // ---- type
    if (take(/\s(?:expenses?|spending|spent|purchases?|payments?)\s/)) {
      result.type = 'expense';
      result.understood.unshift('expenses');
    } else if (take(/\s(?:income|earned|earnings|deposits?)\s/)) {
      result.type = 'income';
      result.understood.unshift('income');
    }

    // ---- categories, longest names first so "Eating out" beats "Eating"
    const sorted = [...ctx.categories].sort((a, b) => b.name.length - a.name.length);
    for (const c of sorted) {
      const re = new RegExp(String.raw`\s(?:in\s|on\s)?${escapeRe(c.name.toLowerCase())}\s`);
      if (take(re)) {
        result.categoryIds.push(c.id);
        result.understood.push(`in ${c.name}`);
        break;
      }
    }

    result.text = rest
      .replace(/\s(?:in|on|for|from|the|a|an|of|my|all|show|me|find)\s/g, ' ')
      .replace(/\s(?:in|on|for|from|the|a|an|of|my|all|show|me|find)\s/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    // Nothing understood: the query is just text, exactly as typed.
    if (result.understood.length === 0) result.text = query.trim();
    return result;
  },
};
