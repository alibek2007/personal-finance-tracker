import { createHash } from 'node:crypto';
import {
  CsvError,
  currencyExponent,
  guessMapping,
  parseCsv,
  parseCsvAmount,
  parseCsvDate,
  toCsv,
  todayInZone,
  toDecimalString,
  money,
  type ColumnMapping,
  type CurrencyCode,
} from '@pfm/finance';
import {
  MAX_IMPORT_ROWS,
  type ImportPreviewDto,
  type ImportRequest,
  type ImportResultDto,
  type TransactionFilter,
} from '@pfm/validation';
import type { Db } from '../../lib/db';
import { AppError } from '../../utils/errors';
import { audit } from '../audit/audit.service';
import type { createTransactionsService } from '../transactions/transactions.service';

const PREVIEW_ROWS = 50;
const PREVIEW_ERRORS = 25;
const EXPORT_PAGE = 1000;
const EXPORT_LIMIT = 200_000;

interface AnalysedRow {
  line: number;
  status: 'ok' | 'duplicate' | 'error';
  errors: string[];
  date: string | null;
  type: 'income' | 'expense' | null;
  /** Positive magnitude in minor units. */
  amount: number | null;
  description: string;
  merchant: string | null;
  notes: string | null;
  categoryName: string | null;
  categoryId: string | null;
  hash: string | null;
}

const INCOME_WORDS = new Set(['income', 'credit', 'deposit', 'in', 'money in', 'inflow', '+']);
const EXPENSE_WORDS = new Set([
  'expense',
  'debit',
  'withdrawal',
  'payment',
  'out',
  'money out',
  '-',
]);

const normalise = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();

export function createImportExportService(
  db: Db,
  now: () => Date,
  transactions: ReturnType<typeof createTransactionsService>,
) {
  async function context(userId: string, accountId: string) {
    const [user, account] = await Promise.all([
      db.user.findUnique({ where: { id: userId } }),
      db.account.findFirst({ where: { id: accountId, userId } }),
    ]);
    if (!user) throw AppError.unauthorized();
    if (!account)
      throw AppError.badRequest('Some fields need attention.', 'validation_failed', {
        accountId: ['Choose one of your accounts.'],
      });
    if (account.isArchived)
      throw AppError.badRequest('Some fields need attention.', 'validation_failed', {
        accountId: ['That account is archived. Restore it or pick another.'],
      });
    return { user, account, currency: account.currency as CurrencyCode };
  }

  async function analyse(userId: string, req: ImportRequest) {
    const { user, account, currency } = await context(userId, req.accountId);
    let parsed;
    try {
      parsed = parseCsv(req.csv);
    } catch (error) {
      if (error instanceof CsvError) throw AppError.badRequest(error.message, 'invalid_csv');
      throw error;
    }
    if (parsed.rows.length > MAX_IMPORT_ROWS) {
      throw AppError.badRequest(
        `That file has ${parsed.rows.length} rows. Import up to ${MAX_IMPORT_ROWS} at a time.`,
        'too_many_rows',
      );
    }

    const guessed = guessMapping(parsed.headers);
    const usable = (m: Partial<ColumnMapping>): m is ColumnMapping =>
      m.date !== undefined &&
      m.description !== undefined &&
      (m.amount !== undefined || (m.debit !== undefined && m.credit !== undefined));
    const candidate = req.mapping ?? guessed;
    const mapping = usable(candidate) ? candidate : null;
    if (mapping) {
      for (const [field, index] of Object.entries(mapping)) {
        if (index !== undefined && index >= parsed.headers.length) {
          throw AppError.badRequest(
            `The ${field} column does not exist in this file.`,
            'validation_failed',
            { mapping: [`The ${field} column does not exist in this file.`] },
          );
        }
      }
    }

    const exponent = currencyExponent(currency);
    const today = todayInZone(now(), user.timezone);
    const categories = await db.category.findMany({ where: { userId, isArchived: false } });
    const categoryIndex = new Map<string, string>();
    for (const c of categories) {
      const key = `${c.type}:${normalise(c.name)}`;
      if (!categoryIndex.has(key) || !c.parentId) categoryIndex.set(key, c.id);
    }

    const rows: AnalysedRow[] = [];
    const unmatched = new Set<string>();
    const seen = new Map<string, number>();

    if (mapping) {
      for (const [i, cells] of parsed.rows.entries()) {
        const cell = (index: number | undefined) =>
          index === undefined ? '' : (cells[index] ?? '');
        const errors: string[] = [];
        const line = parsed.lineNumbers[i]!;

        const date = parseCsvDate(cell(mapping.date), req.dateOrder, today);
        if (!date) errors.push(`"${cell(mapping.date)}" is not a valid date.`);

        let signed: number | null = null;
        let type: 'income' | 'expense' | null = null;
        if (mapping.amount !== undefined) {
          signed = parseCsvAmount(cell(mapping.amount), exponent, req.decimal);
          if (signed === null) errors.push(`"${cell(mapping.amount)}" is not a valid amount.`);
        } else {
          const debit = parseCsvAmount(cell(mapping.debit), exponent, req.decimal);
          const credit = parseCsvAmount(cell(mapping.credit), exponent, req.decimal);
          const hasDebit = cell(mapping.debit) !== '' && debit !== null && debit !== 0;
          const hasCredit = cell(mapping.credit) !== '' && credit !== null && credit !== 0;
          if (hasDebit && hasCredit) errors.push('Both debit and credit have an amount.');
          else if (hasDebit) {
            signed = -Math.abs(debit!);
          } else if (hasCredit) signed = Math.abs(credit!);
          else if (
            (cell(mapping.debit) !== '' && debit === null) ||
            (cell(mapping.credit) !== '' && credit === null)
          )
            errors.push('The debit or credit amount is not a valid number.');
          else errors.push('Neither debit nor credit has an amount.');
        }

        if (signed !== null) {
          if (signed === 0) errors.push("The amount can't be zero.");
          else if (mapping.type !== undefined && cell(mapping.type) !== '') {
            const word = normalise(cell(mapping.type));
            if (INCOME_WORDS.has(word)) type = 'income';
            else if (EXPENSE_WORDS.has(word)) type = 'expense';
            else if (word === 'transfer')
              errors.push("Transfers can't be imported. Add them in Ledger.");
            else errors.push(`"${cell(mapping.type)}" is not income or expense.`);
          } else type = signed < 0 ? 'expense' : 'income';
        }

        const merchant = cell(mapping.merchant) || null;
        const description = cell(mapping.description) || merchant || '';
        if (!description) errors.push('There is no description.');
        if (description.length > 200) errors.push('The description is longer than 200 characters.');
        if (merchant && merchant.length > 80)
          errors.push('The merchant is longer than 80 characters.');
        const notes = cell(mapping.notes) || null;
        if (notes && notes.length > 1000) errors.push('The notes are longer than 1000 characters.');

        const categoryName = cell(mapping.category) || null;
        let categoryId: string | null = null;
        if (categoryName && type) {
          categoryId = categoryIndex.get(`${type}:${normalise(categoryName)}`) ?? null;
          if (!categoryId) unmatched.add(categoryName);
        }

        let hash: string | null = null;
        if (errors.length === 0 && date && type && signed !== null) {
          const base = [userId, req.accountId, date, signed, normalise(description)].join('|');
          const n = (seen.get(base) ?? 0) + 1;
          seen.set(base, n);
          // The nth identical row in a file is a different purchase from the first: two coffees, same price.
          hash = createHash('sha256').update(`${base}|${n}`).digest('hex');
        }

        rows.push({
          line,
          status: errors.length ? 'error' : 'ok',
          errors,
          date,
          type,
          amount: signed === null ? null : Math.abs(signed),
          description,
          merchant,
          notes,
          categoryName,
          categoryId,
          hash,
        });
      }

      const hashes = rows.flatMap((r) => (r.hash ? [r.hash] : []));
      if (hashes.length > 0) {
        const existing = new Set(
          (
            await db.transaction.findMany({
              where: { userId, importHash: { in: hashes } },
              select: { importHash: true },
            })
          ).map((t) => t.importHash),
        );
        for (const r of rows) if (r.hash && existing.has(r.hash)) r.status = 'duplicate';
      }
    }

    return { account, currency, parsed, guessed, mapping, rows, unmatched: [...unmatched] };
  }

  const CSV_HEADER = [
    'Date',
    'Type',
    'Description',
    'Merchant',
    'Amount',
    'Currency',
    'Category',
    'Account',
    'Transfer to',
    'Transfer amount',
    'Refund',
    'Recurring',
    'Notes',
  ];

  return {
    async preview(userId: string, req: ImportRequest): Promise<ImportPreviewDto> {
      const a = await analyse(userId, req);
      const counts = { ok: 0, duplicate: 0, error: 0 };
      const totals = { income: 0, expense: 0 };
      for (const r of a.rows) {
        counts[r.status === 'error' ? 'error' : r.status === 'duplicate' ? 'duplicate' : 'ok']++;
        if (r.status === 'ok' && r.amount !== null) totals[r.type!] += r.amount;
      }
      const errorRows = a.rows.filter((r) => r.status === 'error').slice(0, PREVIEW_ERRORS);
      const others = a.rows
        .filter((r) => r.status !== 'error')
        .slice(0, PREVIEW_ROWS - errorRows.length);
      const shown = [...errorRows, ...others].sort((x, y) => x.line - y.line);
      return {
        headers: a.parsed.headers,
        delimiter: a.parsed.delimiter,
        guessedMapping: a.guessed,
        mapping: a.mapping,
        currency: a.currency,
        rowCount: a.rows.length,
        counts,
        totals,
        unmatchedCategories: a.unmatched,
        rows: shown.map((r) => ({
          line: r.line,
          status: r.status,
          errors: r.errors,
          date: r.date,
          type: r.type,
          amount: r.amount,
          description: r.description,
          category: r.categoryName,
        })),
      };
    },

    /**
     * Imports every valid row. Safe to repeat: each row carries a fingerprint, so running the same file
     * again (say after a connection drop) skips what already arrived instead of doubling it.
     */
    async commit(
      userId: string,
      req: ImportRequest,
      meta: { ip?: string | undefined; userAgent?: string | undefined } = {},
    ): Promise<ImportResultDto> {
      const a = await analyse(userId, req);
      if (!a.mapping) {
        throw AppError.badRequest(
          'Choose which columns hold the date, description and amount.',
          'validation_failed',
          { mapping: ['Choose which columns hold the date, description and amount.'] },
        );
      }
      let imported = 0;
      let skippedErrors = a.rows.filter((r) => r.status === 'error').length;
      const skippedDuplicates = req.skipDuplicates
        ? a.rows.filter((r) => r.status === 'duplicate').length
        : 0;
      for (const r of a.rows) {
        if (r.status === 'error' || (r.status === 'duplicate' && req.skipDuplicates)) continue;
        try {
          await transactions.create(
            userId,
            {
              type: r.type!,
              accountId: req.accountId,
              categoryId: r.categoryId,
              amount: r.amount!,
              description: r.description,
              merchant: r.merchant,
              date: r.date!,
              notes: r.notes,
              transferAccountId: null,
              transferAmount: null,
              isRefund: false,
            },
            { importHash: r.hash! },
          );
          imported++;
        } catch (error) {
          if (!(error instanceof AppError)) throw error;
          skippedErrors++;
        }
      }
      await audit(db, {
        userId,
        action: 'import.transactions',
        entity: 'account',
        entityId: req.accountId,
        ip: meta.ip,
        userAgent: meta.userAgent,
        metadata: { imported, skippedDuplicates, skippedErrors },
      });
      return { imported, skippedDuplicates, skippedErrors };
    },

    /** Every transaction matching the filter as CSV (all pages), amounts exact, formulas defused. */
    async exportCsv(
      userId: string,
      filter: TransactionFilter,
      meta: { ip?: string | undefined; userAgent?: string | undefined } = {},
    ): Promise<{ csv: string; count: number }> {
      const [accounts, categories] = await Promise.all([
        db.account.findMany({ where: { userId } }),
        db.category.findMany({ where: { userId } }),
      ]);
      const accountName = new Map(accounts.map((a) => [a.id, a.name]));
      const categoryName = new Map(categories.map((c) => [c.id, c.name]));
      const lines: (string | number | boolean | null)[][] = [CSV_HEADER];
      let total = 0;
      for (let page = 1; ; page++) {
        const res = await transactions.list(userId, {
          ...filter,
          sort: 'date',
          dir: 'asc',
          page,
          pageSize: EXPORT_PAGE,
        });
        for (const t of res.items) {
          lines.push([
            t.date,
            t.type,
            t.description,
            t.merchant,
            toDecimalString(money(t.amount, t.currency)),
            t.currency,
            t.categoryId ? (categoryName.get(t.categoryId) ?? '') : '',
            accountName.get(t.accountId) ?? '',
            t.transferAccountId ? (accountName.get(t.transferAccountId) ?? '') : '',
            t.transferAmount !== null
              ? toDecimalString(
                  money(
                    t.transferAmount,
                    (accounts.find((a) => a.id === t.transferAccountId)?.currency ??
                      t.currency) as CurrencyCode,
                  ),
                )
              : '',
            t.isRefund,
            t.isRecurring,
            t.notes,
          ]);
        }
        total += res.items.length;
        if (res.items.length < EXPORT_PAGE || total >= EXPORT_LIMIT) break;
      }
      await audit(db, {
        userId,
        action: 'export.transactions',
        ip: meta.ip,
        userAgent: meta.userAgent,
        metadata: { rows: total },
      });
      return { csv: '\uFEFF' + toCsv(lines), count: total };
    },
  };
}
export type ImportExportService = ReturnType<typeof createImportExportService>;
