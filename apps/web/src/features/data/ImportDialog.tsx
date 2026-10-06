import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button, Dialog, DialogContent, Field, Input, Select, cn } from '@pfm/ui';
import {
  MAX_IMPORT_CHARS,
  type ColumnMappingInput,
  type ImportPreviewDto,
  type ImportResultDto,
} from '@pfm/validation';
import { AmountText } from '../../components/LedgerBits';
import { ApiError } from '../../lib/api';
import { useCommitImport, usePreviewImport } from '../../lib/data-transfer';
import { useAccounts } from '../../lib/ledger';

type Mapping = Partial<ColumnMappingInput>;

const FIELDS: { key: keyof ColumnMappingInput; label: string; hint?: string }[] = [
  { key: 'date', label: 'Date' },
  { key: 'description', label: 'Description' },
  {
    key: 'amount',
    label: 'Amount',
    hint: 'Negative numbers are spending, unless there is a Type column.',
  },
  {
    key: 'debit',
    label: 'Debit (money out)',
    hint: 'Only if the file has separate debit and credit columns.',
  },
  { key: 'credit', label: 'Credit (money in)' },
  { key: 'type', label: 'Type (income / expense)' },
  { key: 'category', label: 'Category', hint: 'Matched to your categories by name.' },
  { key: 'merchant', label: 'Merchant' },
  { key: 'notes', label: 'Notes' },
];

const STATUS_LABEL = {
  ok: 'Will import',
  duplicate: 'Already imported',
  error: 'Problem',
} as const;

export function ImportDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const accountsQuery = useAccounts();
  const accounts = (accountsQuery.data?.accounts ?? []).filter((a) => !a.isArchived);
  const preview = usePreviewImport();
  const commit = useCommitImport();

  const [csv, setCsv] = useState<string | null>(null);
  const [fileName, setFileName] = useState('');
  const [fileError, setFileError] = useState<string | null>(null);
  const [accountId, setAccountId] = useState('');
  const [mapping, setMapping] = useState<Mapping | null>(null);
  const [dateOrder, setDateOrder] = useState<'MDY' | 'DMY' | 'YMD'>('MDY');
  const [decimal, setDecimal] = useState<'.' | ','>('.');
  const [skipDuplicates, setSkipDuplicates] = useState(true);
  const [result, setResult] = useState<ImportResultDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The last preview stays on screen while the next one loads, so the form does not vanish mid-edit.
  const [data, setData] = useState<ImportPreviewDto | undefined>(undefined);

  const accountIdEffective = accountId || accounts[0]?.id || '';

  // Re-read the file whenever something that changes its meaning changes.
  const { mutate: runPreview } = preview;
  useEffect(() => {
    if (!csv || !accountIdEffective) return;
    setError(null);
    runPreview(
      {
        csv,
        accountId: accountIdEffective,
        dateOrder,
        decimal,
        ...(mapping ? { mapping: mapping as ColumnMappingInput } : {}),
      },
      {
        onSuccess: setData,
        onError: (e) => setError(e instanceof ApiError ? e.message : 'Could not read that file.'),
      },
    );
  }, [csv, accountIdEffective, dateOrder, decimal, mapping, runPreview]);

  // The first preview tells us what was guessed; from then on the person owns the mapping.
  const shownMapping: Mapping = mapping ?? data?.mapping ?? data?.guessedMapping ?? {};
  const fileInput = useRef<HTMLInputElement>(null);

  async function onFile(file: File | undefined) {
    setResult(null);
    setMapping(null);
    setData(undefined);
    if (!file) return;
    if (file.size > MAX_IMPORT_CHARS) {
      setFileError('That file is too large. Import up to 2 MB at a time.');
      setCsv(null);
      return;
    }
    setFileError(null);
    setFileName(file.name);
    setCsv(await file.text());
  }

  function setField(key: keyof ColumnMappingInput, value: string) {
    const next: Mapping = { ...shownMapping };
    if (value === '') delete next[key];
    else next[key] = Number(value);
    setMapping(next);
  }

  async function doImport() {
    if (!csv || !data?.mapping) return;
    setError(null);
    try {
      setResult(
        await commit.mutateAsync({
          csv,
          accountId: accountIdEffective,
          dateOrder,
          decimal,
          skipDuplicates,
          mapping: data.mapping as ColumnMappingInput,
        }),
      );
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't import that file. Try again.");
    }
  }

  function reset(next: boolean) {
    if (!next) {
      setCsv(null);
      setFileName('');
      setMapping(null);
      setResult(null);
      setError(null);
      setFileError(null);
      preview.reset();
      setData(undefined);
    }
    onOpenChange(next);
  }

  const importable = (data?.counts.ok ?? 0) + (skipDuplicates ? 0 : (data?.counts.duplicate ?? 0));

  return (
    <Dialog open={open} onOpenChange={reset}>
      <DialogContent
        title="Import transactions"
        description="From a CSV file exported by your bank or spreadsheet. Nothing changes until you confirm."
        className="md:w-[min(52rem,calc(100vw-2rem))]"
      >
        {result ? (
          <div className="flex flex-col gap-4" role="status">
            <p className="text-lg">
              Imported <strong>{result.imported}</strong>{' '}
              {result.imported === 1 ? 'transaction' : 'transactions'}.
            </p>
            {result.skippedDuplicates > 0 ? (
              <p className="text-muted">
                {result.skippedDuplicates} already in Ledger, so they were left alone.
              </p>
            ) : null}
            {result.skippedErrors > 0 ? (
              <p className="text-muted">
                {result.skippedErrors} rows had problems and were skipped.
              </p>
            ) : null}
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => reset(false)}>
                Close
              </Button>
              <Link
                to="/transactions"
                onClick={() => reset(false)}
                className="inline-flex h-10 items-center rounded-md bg-accent px-4 font-medium text-accent-ink"
              >
                View transactions
              </Link>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-5">
            <div className="grid gap-5 sm:grid-cols-2">
              <Field label="Import into" hint="Amounts are read in this account's currency.">
                <Select
                  value={accountIdEffective}
                  onChange={(e) => {
                    setAccountId(e.target.value);
                    setResult(null);
                  }}
                >
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name} ({a.currency})
                    </option>
                  ))}
                </Select>
              </Field>
              <Field
                label="CSV file"
                error={fileError ?? undefined}
                hint={fileName || 'Up to 2 MB or 5,000 rows.'}
              >
                <Input
                  ref={fileInput}
                  type="file"
                  accept=".csv,text/csv,text/plain"
                  onChange={(e) => void onFile(e.target.files?.[0])}
                />
              </Field>
            </div>

            {error ? (
              <p
                role="alert"
                className="rounded-md bg-loss-wash px-3 py-2 text-[0.875rem] text-loss"
              >
                {error}
              </p>
            ) : null}

            {csv && data ? (
              <>
                <details open={data.mapping === null} className="rounded-md border border-rule">
                  <summary className="cursor-pointer px-3 py-2 text-[0.875rem] font-medium">
                    {data.mapping
                      ? 'Check how the columns were read'
                      : 'Tell Ledger which column is which'}
                  </summary>
                  <div className="grid gap-4 border-t border-rule p-3 sm:grid-cols-3">
                    {FIELDS.map((f) => (
                      <Field key={f.key} label={f.label} {...(f.hint ? { hint: f.hint } : {})}>
                        <Select
                          value={
                            shownMapping[f.key] === undefined ? '' : String(shownMapping[f.key])
                          }
                          onChange={(e) => setField(f.key, e.target.value)}
                        >
                          <option value="">Not in this file</option>
                          {data.headers.map((h, i) => (
                            <option key={i} value={i}>
                              {h || `Column ${i + 1}`}
                            </option>
                          ))}
                        </Select>
                      </Field>
                    ))}
                    <Field label="Dates look like">
                      <Select
                        value={dateOrder}
                        onChange={(e) => setDateOrder(e.target.value as typeof dateOrder)}
                      >
                        <option value="MDY">Month/Day/Year (10/25/2026)</option>
                        <option value="DMY">Day/Month/Year (25.10.2026)</option>
                        <option value="YMD">Year-Month-Day (2026-10-25)</option>
                      </Select>
                    </Field>
                    <Field label="Decimal mark">
                      <Select
                        value={decimal}
                        onChange={(e) => setDecimal(e.target.value as typeof decimal)}
                      >
                        <option value=".">Point (1,234.56)</option>
                        <option value=",">Comma (1.234,56)</option>
                      </Select>
                    </Field>
                  </div>
                </details>

                {data.mapping ? (
                  <>
                    <p aria-live="polite" className="text-[0.9375rem]">
                      <strong>{data.counts.ok}</strong> will be imported
                      {data.counts.duplicate > 0 ? (
                        <>, {data.counts.duplicate} already in Ledger</>
                      ) : null}
                      {data.counts.error > 0 ? <>, {data.counts.error} with problems</> : null}.
                      Money in{' '}
                      <AmountText
                        minor={data.totals.income}
                        currency={data.currency}
                        kind="income"
                      />
                      , money out{' '}
                      <AmountText
                        minor={data.totals.expense}
                        currency={data.currency}
                        kind="expense"
                      />
                      .
                    </p>
                    {data.unmatchedCategories.length > 0 ? (
                      <p className="text-[0.8125rem] text-muted">
                        No matching category for: {data.unmatchedCategories.join(', ')}. Those rows
                        will be uncategorised.
                      </p>
                    ) : null}
                    <div className="max-h-64 overflow-auto rounded-md border border-rule">
                      <table className="w-full text-left text-[0.8125rem]">
                        <caption className="sr-only">
                          Preview of the first rows, problems first
                        </caption>
                        <thead className="sticky top-0 bg-surface text-muted">
                          <tr>
                            <th className="px-3 py-2 font-normal">Line</th>
                            <th className="px-3 py-2 font-normal">Date</th>
                            <th className="px-3 py-2 font-normal">Description</th>
                            <th className="px-3 py-2 text-right font-normal">Amount</th>
                            <th className="px-3 py-2 font-normal">Result</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-rule">
                          {data.rows.map((r) => (
                            <tr key={r.line} className={cn(r.status === 'error' && 'bg-loss-wash')}>
                              <td className="px-3 py-2 text-muted">{r.line}</td>
                              <td className="px-3 py-2">{r.date ?? '—'}</td>
                              <td className="max-w-48 truncate px-3 py-2">
                                {r.description || '—'}
                              </td>
                              <td className="px-3 py-2 text-right">
                                {r.amount !== null && r.type ? (
                                  <AmountText
                                    minor={r.amount}
                                    currency={data.currency}
                                    kind={r.type}
                                  />
                                ) : (
                                  '—'
                                )}
                              </td>
                              <td className="px-3 py-2">
                                {STATUS_LABEL[r.status]}
                                {r.errors.length > 0 ? (
                                  <span className="block text-loss">{r.errors.join(' ')}</span>
                                ) : null}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    {data.rowCount > data.rows.length ? (
                      <p className="text-[0.75rem] text-muted">
                        Showing {data.rows.length} of {data.rowCount} rows.
                      </p>
                    ) : null}
                    {data.counts.duplicate > 0 ? (
                      <label className="flex items-center gap-2 text-[0.875rem]">
                        <input
                          type="checkbox"
                          checked={skipDuplicates}
                          onChange={(e) => setSkipDuplicates(e.target.checked)}
                        />
                        Skip the {data.counts.duplicate} that are already in Ledger
                      </label>
                    ) : null}
                  </>
                ) : null}
              </>
            ) : null}

            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => reset(false)}>
                Cancel
              </Button>
              <Button
                onClick={() => void doImport()}
                loading={commit.isPending}
                disabled={!data?.mapping || importable === 0 || preview.isPending}
              >
                {importable > 0
                  ? `Import ${importable} ${importable === 1 ? 'transaction' : 'transactions'}`
                  : 'Import'}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
