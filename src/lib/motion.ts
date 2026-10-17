/**
 * motion.ts — whether this viewer asked the system for less motion. Read by
 * every moving thing of the window (the visualizer, the bouncing bars).
 */
export function prefersReducedMotion(): boolean {
  try {
    return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch (err) {
    console.warn('[youtube] reduced-motion preference unreadable, full motion used:', err);
    return false;
  }
}
