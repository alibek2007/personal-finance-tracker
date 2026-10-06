import { useState } from 'react';
import { Download, Upload } from 'lucide-react';
import { Button, toast } from '@pfm/ui';
import { ApiError } from '../../lib/api';
import { downloadTransactionsCsv } from '../../lib/data-transfer';
import { ImportDialog } from './ImportDialog';

/** Settings → your data: take it out as CSV, or bring a bank file in. */
export function DataSection() {
  const [importing, setImporting] = useState(false);
  const [exporting, setExporting] = useState(false);

  async function exportAll() {
    setExporting(true);
    try {
      await downloadTransactionsCsv();
      toast.success('Your export is ready');
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Couldn't export. Try again.");
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="secondary" onClick={() => void exportAll()} loading={exporting}>
          <Download aria-hidden /> Export all transactions
        </Button>
        <Button variant="secondary" onClick={() => setImporting(true)}>
          <Upload aria-hidden /> Import from CSV
        </Button>
      </div>
      <p className="max-w-prose text-[0.8125rem] text-muted">
        Exports open in any spreadsheet and can be imported back. Importing the same file twice is
        safe: transactions already in Ledger are recognised and skipped.
      </p>
      {importing ? <ImportDialog open onOpenChange={setImporting} /> : null}
    </div>
  );
}
