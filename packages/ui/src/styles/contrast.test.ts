// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('./tokens.css', import.meta.url), 'utf8');

function block(selector: RegExp): Record<string, string> {
  const m = selector.exec(css);
  if (!m) throw new Error(`No token block for ${selector}`);
  const body = css.slice(m.index + m[0].length, css.indexOf('\n}', m.index));
  const out: Record<string, string> = {};
  for (const [, name, value] of body.matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)) {
    out[name!] = value!;
  }
  return out;
}

const light = block(/:root\s*\{/);
const themes = {
  light,
  dark: { ...light, ...block(/:root\[data-theme='dark'\]\s*\{/) },
} as const;

function luminance(hex: string): number {
  const channel = (i: number) => {
    const c = parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(0) + 0.7152 * channel(1) + 0.0722 * channel(2);
}
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** Text token on the surface token it actually appears on. WCAG AA: 4.5 for text. */
const TEXT_PAIRS: [fg: string, bg: string][] = [
  ['ink', 'bg'],
  ['ink', 'surface'],
  ['ink', 'sunk'],
  ['muted', 'bg'],
  ['muted', 'surface'],
  ['muted', 'sunk'],
  ['muted', 'accent-wash'],
  ['accent', 'bg'],
  ['accent', 'surface'],
  ['accent', 'accent-wash'],
  ['accent-ink', 'accent'],
  ['accent-ink', 'accent-hover'],
  ['gain', 'bg'],
  ['gain', 'surface'],
  ['gain', 'gain-wash'],
  ['loss', 'bg'],
  ['loss', 'surface'],
  ['loss', 'loss-wash'],
  ['warn-text', 'bg'],
  ['warn-text', 'surface'],
  ['warn-text', 'warn-wash'],
];

describe.each(Object.entries(themes))('%s theme', (_name, tokens) => {
  it.each(TEXT_PAIRS)('%s on %s meets WCAG AA for text (4.5:1)', (fg, bg) => {
    expect(tokens[fg], `--${fg} is defined`).toBeDefined();
    expect(tokens[bg], `--${bg} is defined`).toBeDefined();
    expect(contrast(tokens[fg]!, tokens[bg]!)).toBeGreaterThanOrEqual(4.5);
  });

  it('keeps the strong rule visible enough to see a control edge (3:1 on the page)', () => {
    expect(contrast(tokens['rule-strong']!, tokens['bg']!)).toBeGreaterThanOrEqual(1.8);
  });
});

describe('contrast maths', () => {
  it('matches known values', () => {
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 1);
    expect(contrast('#777777', '#ffffff')).toBeCloseTo(4.48, 1);
    expect(contrast('#ffffff', '#ffffff')).toBe(1);
  });
});
