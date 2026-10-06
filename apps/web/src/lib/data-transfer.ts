import { useMutation, useQueryClient } from '@tanstack/react-query';
import { importPreviewSchema, importResultSchema, type ImportRequest } from '@pfm/validation';
import { api, ApiError } from './api';

type ImportInput = Omit<ImportRequest, 'skipDuplicates' | 'dateOrder' | 'decimal'> &
  Partial<Pick<ImportRequest, 'skipDuplicates' | 'dateOrder' | 'decimal'>>;

export function usePreviewImport() {
  return useMutation({
    mutationFn: (input: ImportInput) =>
      api('/import/transactions/preview', importPreviewSchema, { method: 'POST', body: input }),
  });
}

export function useCommitImport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: ImportInput) =>
      api('/import/transactions', importResultSchema, { method: 'POST', body: input }),
    // Balances, lists, budgets and charts all change with new transactions.
    onSuccess: () =>
      Promise.all(
        ['accounts', 'transactions', 'budgets', 'notifications'].map((key) =>
          qc.invalidateQueries({ queryKey: [key] }),
        ),
      ),
  });
}

/** Downloads the CSV the server builds, keeping the session cookie and the server's file name. */
export async function downloadTransactionsCsv(query = ''): Promise<void> {
  let response: Response;
  try {
    response = await fetch(`/api/export/transactions${query ? `?${query}` : ''}`, {
      credentials: 'include',
    });
  } catch {
    throw new ApiError(
      0,
      'network',
      'Could not reach the server. Check your connection and try again.',
    );
  }
  if (!response.ok) {
    throw new ApiError(
      response.status,
      'export_failed',
      response.status === 429
        ? 'You have exported a lot recently. Try again in a little while.'
        : "Couldn't prepare your export. Try again in a moment.",
    );
  }
  const name =
    /filename="([^"]+)"/.exec(response.headers.get('content-disposition') ?? '')?.[1] ??
    'ledger-transactions.csv';
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
