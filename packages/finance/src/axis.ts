/** Four equal steps between five tick marks: the axis a person would draw by hand. */
export const AXIS_INTERVALS = 4;

const MULTIPLIERS = [1, 1.5, 2, 2.5, 3, 4, 5, 10];

/** Rounds away floating-point dust: 0.30000000000000004 becomes 0.3. */
const clean = (n: number): number => Number(n.toPrecision(12));

/**
 * A chart domain whose five ticks land on round numbers (0, 500, 1,000, 1,500, 2,000 rather than
 * 0, 475, 950, 1,425, 1,900). The step is 1, 1.5, 2, 2.5, 3, 4 or 5 times a power of ten, and the domain always
 * covers the data. Pass `includeZero` for bars and areas, whose baseline must be zero.
 */
export function niceDomain(
  min: number,
  max: number,
  { includeZero = true }: { includeZero?: boolean } = {},
): [number, number] {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [0, 1];
  let lo = Math.min(min, max);
  let hi = Math.max(min, max);
  if (includeZero) {
    lo = Math.min(lo, 0);
    hi = Math.max(hi, 0);
  }
  if (hi === lo) {
    // A flat line (or no data): give it some air so the axis is not a single value.
    const pad = Math.abs(hi) > 0 ? Math.abs(hi) * 0.5 : 1;
    lo -= includeZero && lo === 0 ? 0 : pad;
    hi += pad;
  }
  const raw = (hi - lo) / AXIS_INTERVALS;
  const exponent = Math.floor(Math.log10(raw));
  for (let e = exponent - 1; e <= exponent + 2; e++) {
    for (const m of MULTIPLIERS) {
      const step = clean(m * 10 ** e);
      if (step < raw * (1 - 1e-9)) continue;
      const start = clean(Math.floor(lo / step + 1e-9) * step);
      const end = clean(start + AXIS_INTERVALS * step);
      if (end >= hi * (1 - 1e-12) - 1e-12 || end >= hi) return [start, end];
    }
  }
  return [lo, hi];
}
