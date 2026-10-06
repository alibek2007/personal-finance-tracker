import { MoneyError } from '@pfm/finance';

/** DB BIGINT -> JS number, refusing anything that could silently lose precision. */
export function toMinor(value: bigint): number {
  if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < BigInt(Number.MIN_SAFE_INTEGER)) {
    throw new MoneyError('Stored amount exceeds the safe integer range');
  }
  return Number(value);
}

export function toMinorOrNull(value: bigint | null): number | null {
  return value === null ? null : toMinor(value);
}

export const fromMinor = (value: number): bigint => BigInt(value);

/** Postgres DATE (read as UTC midnight) -> "YYYY-MM-DD". */
export function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** "YYYY-MM-DD" -> Date at UTC midnight, which Prisma stores in a DATE column without drift. */
export function fromIsoDate(iso: string): Date {
  return new Date(`${iso}T00:00:00.000Z`);
}
