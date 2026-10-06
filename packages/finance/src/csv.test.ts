import { describe, expect, it } from 'vitest';
import {
  CsvError,
  csvCell,
  defuseFormula,
  guessMapping,
  parseCsv,
  parseCsvAmount,
  parseCsvDate,
  toCsv,
} from './csv';

describe('writing', () => {
  it('quotes cells that need it and doubles embedded quotes', () => {
    expect(csvCell('plain')).toBe('plain');
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('two\nlines')).toBe('"two\nlines"');
    expect(csvCell(null)).toBe('');
    expect(csvCell(12.5)).toBe('12.5');
    expect(csvCell(true)).toBe('true');
  });

  it('defuses spreadsheet formulas in text, but not in numbers', () => {
    expect(defuseFormula('=HYPERLINK("http://evil")')).toBe(`'=HYPERLINK("http://evil")`);
    expect(csvCell('+1 555')).toBe(`'+1 555`);
    expect(csvCell('-bad')).toBe(`'-bad`);
    expect(csvCell('@cmd')).toBe(`'@cmd`);
    expect(csvCell(-12.5)).toBe('-12.5');
    expect(csvCell('Fine -- really')).toBe('Fine -- really');
  });

  it('writes rows with CRLF', () => {
    expect(
      toCsv([
        ['a', 'b'],
        [1, 'x,y'],
      ]),
    ).toBe('a,b\r\n1,"x,y"\r\n');
  });
});

describe('parseCsv', () => {
  it('reads headers and rows', () => {
    const r = parseCsv('Date,Amount,Description\n2026-10-01,12.50,Coffee\n2026-10-02,3,Bus\n');
    expect(r.headers).toEqual(['Date', 'Amount', 'Description']);
    expect(r.rows).toEqual([
      ['2026-10-01', '12.50', 'Coffee'],
      ['2026-10-02', '3', 'Bus'],
    ]);
    expect(r.lineNumbers).toEqual([2, 3]);
    expect(r.delimiter).toBe(',');
  });

  it('handles quotes, escaped quotes, embedded newlines and commas', () => {
    const r = parseCsv('a,b\r\n"x, y","say ""hi"""\r\n"two\nlines",z\r\n');
    expect(r.rows).toEqual([
      ['x, y', 'say "hi"'],
      ['two\nlines', 'z'],
    ]);
  });

  it('reports line numbers correctly after a multi-line cell', () => {
    const r = parseCsv('a,b\n"x\ny",1\nlast,2\n');
    expect(r.lineNumbers).toEqual([2, 4]);
  });

  it('detects semicolons and tabs, ignoring delimiters inside quotes', () => {
    expect(parseCsv('a;b;c\n1;2;3').delimiter).toBe(';');
    expect(parseCsv('a\tb\n1\t2').delimiter).toBe('\t');
    expect(parseCsv('"a,b,c";d\n1;2').delimiter).toBe(';');
  });

  it('strips a BOM, skips blank lines, pads short rows and trims cells', () => {
    const r = parseCsv('﻿a,b,c\n\n 1 , 2 \n,,\n');
    expect(r.headers).toEqual(['a', 'b', 'c']);
    expect(r.rows).toEqual([['1', '2', '']]);
  });

  it('works without a trailing newline and with old Mac line endings', () => {
    expect(parseCsv('a,b\r1,2').rows).toEqual([['1', '2']]);
    expect(parseCsv('a,b\n1,2').rows).toEqual([['1', '2']]);
  });

  it('fails clearly on empty files and unclosed quotes', () => {
    expect(() => parseCsv('')).toThrow(CsvError);
    expect(() => parseCsv('   \n  \n')).toThrow(/empty/);
    expect(() => parseCsv('a,b\n"oops,1')).toThrow(/never closed/);
  });
});

describe('parseCsvDate', () => {
  it('reads ISO dates in any order setting', () => {
    expect(parseCsvDate('2026-10-05', 'MDY')).toBe('2026-10-05');
    expect(parseCsvDate('2026-1-5', 'DMY')).toBe('2026-01-05');
    expect(parseCsvDate('2026/10/05', 'MDY')).toBe('2026-10-05');
  });
  it('follows the chosen order for slashes and dots', () => {
    expect(parseCsvDate('03/04/2026', 'MDY')).toBe('2026-03-04');
    expect(parseCsvDate('03/04/2026', 'DMY')).toBe('2026-04-03');
    expect(parseCsvDate('25.12.2026', 'DMY')).toBe('2026-12-25');
    expect(parseCsvDate('12/25/26', 'MDY')).toBe('2026-12-25');
  });
  it('ignores a time of day', () => {
    expect(parseCsvDate('2026-10-05 14:30:00', 'MDY')).toBe('2026-10-05');
    expect(parseCsvDate('2026-10-05T14:30:00Z', 'MDY')).toBe('2026-10-05');
  });
  it('rejects impossible and absurd dates', () => {
    expect(parseCsvDate('2026-02-31', 'MDY')).toBeNull();
    expect(parseCsvDate('13/13/2026', 'MDY')).toBeNull();
    expect(parseCsvDate('25/12/2026', 'MDY')).toBeNull();
    expect(parseCsvDate('hello', 'MDY')).toBeNull();
    expect(parseCsvDate('2026-10-05', 'MDY', '2020-01-01')).toBeNull(); // far in the future
  });
});

describe('parseCsvAmount', () => {
  it('parses plain and decorated numbers exactly', () => {
    expect(parseCsvAmount('12.50', 2)).toBe(1250);
    expect(parseCsvAmount('$1,234.56', 2)).toBe(123456);
    expect(parseCsvAmount('-$12.50', 2)).toBe(-1250);
    expect(parseCsvAmount('(12.50)', 2)).toBe(-1250);
    expect(parseCsvAmount('12.50-', 2)).toBe(-1250);
    expect(parseCsvAmount('+7', 2)).toBe(700);
    expect(parseCsvAmount('0.1', 2)).toBe(10);
    expect(parseCsvAmount('19.99', 2)).toBe(1999);
  });
  it('supports a decimal comma', () => {
    expect(parseCsvAmount('1.234,56', 2, ',')).toBe(123456);
    expect(parseCsvAmount('€ 12,50', 2, ',')).toBe(1250);
  });
  it('handles currencies without minor units', () => {
    expect(parseCsvAmount('1500', 0)).toBe(1500);
    expect(parseCsvAmount('1500.5', 0)).toBeNull();
  });
  it('refuses to lose precision or accept non-numbers', () => {
    expect(parseCsvAmount('1.005', 2)).toBeNull();
    expect(parseCsvAmount('1.500', 2)).toBe(150); // trailing zeros are harmless
    expect(parseCsvAmount('abc', 2)).toBeNull();
    expect(parseCsvAmount('', 2)).toBeNull();
    expect(parseCsvAmount('1.2.3', 2)).toBeNull();
    expect(parseCsvAmount('9'.repeat(30), 2)).toBeNull();
  });
});

describe('guessMapping', () => {
  it('maps common bank headers', () => {
    expect(guessMapping(['Date', 'Description', 'Amount', 'Category'])).toEqual({
      date: 0,
      description: 1,
      amount: 2,
      category: 3,
    });
    expect(guessMapping(['Posted', 'Payee', 'Debit', 'Credit', 'Memo'])).toMatchObject({
      date: 0,
      description: 1,
      debit: 2,
      credit: 3,
    });
  });
  it('never maps one column twice', () => {
    const m = guessMapping(['Date', 'Name', 'Name']);
    expect(new Set(Object.values(m)).size).toBe(Object.values(m).length);
  });
});

describe('guessMapping in other languages', () => {
  it('recognises common German and Spanish headers', () => {
    expect(guessMapping(['Datum', 'Beschreibung', 'Betrag', 'Kategorie'])).toEqual({
      date: 0,
      description: 1,
      amount: 2,
      category: 3,
    });
    expect(guessMapping(['Fecha', 'Descripción', 'Importe'])).toEqual({
      date: 0,
      description: 1,
      amount: 2,
    });
  });
});
