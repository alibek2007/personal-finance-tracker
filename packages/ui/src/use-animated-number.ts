import { useEffect, useRef, useState } from 'react';

const prefersReducedMotion = () =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Eases the displayed number toward `target` when it CHANGES (a balance updating after you save a
 * transaction). The first value shows immediately, and nothing animates under reduced motion.
 * Works on integers (minor units), so intermediate frames are still whole amounts.
 */
export function useAnimatedNumber(target: number, durationMs = 400): number {
  const [shown, setShown] = useState(target);
  const fromRef = useRef(target);
  const shownRef = useRef(target);
  shownRef.current = shown;

  useEffect(() => {
    if (target === shownRef.current) return;
    if (prefersReducedMotion() || typeof requestAnimationFrame !== 'function') {
      setShown(target);
      return;
    }
    fromRef.current = shownRef.current;
    const start = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs);
      const eased = 1 - Math.pow(1 - t, 3); // ease-out cubic
      setShown(Math.round(fromRef.current + (target - fromRef.current) * eased));
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target, durationMs]);

  return shown;
}
