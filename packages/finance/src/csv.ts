import { addDays, daysInMonth } from './periods';

// ------------------------------------------------------------------ writing

/**
 * Spreadsheet programs run text that starts with = + - @ as a formula. A cell someone else controls (a
 * merchant name from a bank file) must never become one, so such cells are defanged with a leading quote.
 */
export function defuseFormula(value: string): string {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

export function csvCell(value: string | number | boolean | null | undefined, text = true): string {
  if (value === null || value === undefined) return '';
  let s = String(value);
  if (text && typeof value === 'string') s = defuseFormula(s);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(rows: (string | number | boolean | null | undefined)[][]): string {
  return rows.map((r) => r.map((c) => csvCell(c)).join(',')).join('\r\n') + '\r\n';
}

// ------------------------------------------------------------------ reading

export interface ParsedCsv {
  delimiter: ',' | ';' | '\t';
  headers: string[];
  /** Data rows, each padded/trimmed to the header count. Blank lines are dropped. */
  rows: string[][];
  /** 1-based line number in the file for each data row, for error messages. */
  lineNumbers: number[];
}

export class CsvError extends Error {}

function detectDelimiter(firstLine: string): ',' | ';' | '\t' {
  let best: ',' | ';' | '\t' = ',';
  let bestCount = -1;
  for (const d of [',', ';', '\t'] as const) {
    let inQuotes = false;
    let count = 0;
    for (const ch of firstLine) {
      if (ch === '"') inQuotes = !inQuotes;
      else if (ch === d && !inQuotes) count++;
    }
    if (count > bestCount) {
      best = d;
      bestCount = count;
    }
  }
  return best;
}

/** RFC 4180 parsing: quoted fields, escaped quotes, CRLF/LF/CR, embedded newlines, a leading BOM. */
export function parseCsv(input: string): ParsedCsv {
  const text = input.replace(/^\uFEFF/, '');
  const firstLine = text.split(/\r\n|\n|\r/, 1)[0] ?? '';
  const delimiter = detectDelimiter(firstLine);

  const records: { cells: string[]; line: number }[] = [];
  let cells: string[] = [];
  let field = '';
  let inQuotes = false;
  let line = 1;
  let recordLine = 1;
  let fieldWasQuoted = false;

  const endField = () => {
    cells.push(field);
    field = '';
    fieldWasQuoted = false;
  };
  const endRecord = () => {
    endField();
    records.push({ cells, line: recordLine });
    cells = [];
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else {
        if (ch === '\n') line++;
        field += ch;
      }
      continue;
    }
    if (ch === '"' && field === '' && !fieldWasQuoted) {
      inQuotes = true;
      fieldWasQuoted = true;
    } else if (ch === delimiter) endField();
    else if (ch === '\r' || ch === '\n') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      endRecord();
      line++;
      recordLine = line;
    } else field += ch;
  }
  if (inQuotes)
    throw new CsvError('A quoted value is never closed. Check the file for a stray " character.');
  if (field !== '' || cells.length > 0 || fieldWasQuoted) endRecord();

  const nonEmpty = records.filter((r) => r.cells.some((c) => c.trim() !== ''));
  const header = nonEmpty[0];
  if (!header) throw new CsvError('The file is empty.');
  const headers = header.cells.map((h) => h.trim());
  if (headers.every((h) => h === '')) throw new CsvError('The first row has no column names.');
  const body = nonEmpty.slice(1);
  return {
    delimiter,
    headers,
    rows: body.map((r) => headers.map((_, i) => (r.cells[i] ?? '').trim())),
    lineNumbers: body.map((r) => r.line),
  };
}

// ------------------------------------------------------------------ values

export type DateOrder = 'MDY' | 'DMY' | 'YMD';

/** "2026-10-05" always works; slashes/dots/dashes follow `order`. Rejects impossible dates. */
export function parseCsvDate(raw: string, order: DateOrder, today?: string): string | null {
  const s = raw.trim().replace(/[T ]\d{1,2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:?\d{2})?$/, '');
  let y: number, m: number, d: number;
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (iso) {
    [y, m, d] = [Number(iso[1]), Number(iso[2]), Number(iso[3])] as [number, number, number];
  } else {
    const parts = /^(\d{1,4})[./-](\d{1,2})[./-](\d{1,4})$/.exec(s);
    if (!parts) return null;
    const [a, b, c] = [Number(parts[1]), Number(parts[2]), Number(parts[3])] as [
      number,
      number,
      number,
    ];
    if (parts[1]!.length === 4) [y, m, d] = [a, b, c];
    else if (parts[3]!.length === 4 || parts[3]!.length === 2) {
      const year = parts[3]!.length === 2 ? 2000 + c : c;
      if (order === 'DMY') [d, m, y] = [a, b, year];
      else [m, d, y] = [a, b, year];
    } else return null;
  }
  if (m < 1 || m > 12 || d < 1 || d > 31 || y < 1900 || y > 2200) return null;
  const date = `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  // Reject 2026-02-31 rather than silently rolling it into March.
  if (d > daysInMonth(y, m)) return null;
  if (today && date > addDays(today, 366)) return null;
  return date;
}

/**
 * "1,234.56", "1.234,56", "-$12.50", "(12.50)", "12.50-", "€ 12,50" -> signed minor units, exactly (no
 * floats). `decimal` says which character is the decimal mark. Returns null when it is not a number.
 */
export function parseCsvAmount(
  raw: string,
  minorExponent: number,
  decimal: '.' | ',' = '.',
): number | null {
  let s = raw.trim();
  if (s === '') return null;
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  if (s.endsWith('-')) {
    negative = true;
    s = s.slice(0, -1);
  }
  s = s.replace(/[^\d.,+-]/g, '');
  if (s.startsWith('-')) {
    negative = true;
    s = s.slice(1);
  } else if (s.startsWith('+')) s = s.slice(1);
  const thousands = decimal === '.' ? ',' : '.';
  s = s.split(thousands).join('');
  if (decimal === ',') s = s.replace(',', '.');
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const [whole = '0', frac = ''] = s.split('.');
  if (frac.length > minorExponent && /[1-9]/.test(frac.slice(minorExponent))) return null; // would lose precision
  const minor = Number(whole + frac.padEnd(minorExponent, '0').slice(0, minorExponent));
  if (!Number.isSafeInteger(minor)) return null;
  return negative ? -minor : minor;
}

// ------------------------------------------------------------------ guessing columns

export interface ColumnMapping {
  date: number;
  description: number;
  /** One signed column, or leave out and use debit/credit. */
  amount?: number | undefined;
  debit?: number | undefined;
  credit?: number | undefined;
  type?: number | undefined;
  category?: number | undefined;
  merchant?: number | undefined;
  notes?: number | undefined;
}

const HINTS: Record<keyof ColumnMapping, RegExp> = {
  date: /^(date|posted|posting date|transaction date|booking date|datum|buchungstag|fecha|дата)/i,
  description:
    /^(description|details|memo|payee|narrative|name|title|beschreibung|verwendungszweck|descripci|libell|описание|назначение)/i,
  amount: /^(amount|sum|value|betrag|importe|montant|сумма)/i,
  debit: /^(debit|withdrawal|paid out|money out|расход)/i,
  credit: /^(credit|deposit|paid in|money in|приход)/i,
  type: /^(type|kind|тип)/i,
  category: /^(category|kategorie|categor|категория)/i,
  merchant: /^(merchant|vendor|store|мерчант)/i,
  notes: /^(notes?|comment|remarks?|заметк|комментар)/i,
};

/** Best-effort column guess from header names; the person confirms it on screen. */
export function guessMapping(headers: string[]): Partial<ColumnMapping> {
  const out: Partial<ColumnMapping> = {};
  const used = new Set<number>();
  for (const key of Object.keys(HINTS) as (keyof ColumnMapping)[]) {
    const i = headers.findIndex((h, idx) => !used.has(idx) && HINTS[key].test(h));
    if (i >= 0) {
      out[key] = i;
      used.add(i);
    }
  }
  return out;
}
