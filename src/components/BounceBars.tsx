/**
 * BounceBars — the little bouncing bars (doc 151 §11): under the player, and
 * large as the visualizer's « bounce » look.
 *
 * DOM bars moved by `transform: scaleY` from a frame loop through refs: React
 * renders the row once, the loop never re-renders it.
 *
 * - A song heard through the analyser (or the computer's output sound): the
 *   bars follow the music (bounceBars.ts › foldToBars).
 * - A YouTube video, or a song playing straight: a smooth randomised bounce
 *   from play / pause only, labelled « playing », never « spectrum ».
 * - Paused or nothing: the bars fall to rest, then the loop STOPS.
 * - The loop is cancelled when the window hides and on unmount; under
 *   `prefers-reduced-motion` there is no loop at all, a still row of varied
 *   heights says « playing ».
 */
import { useEffect, useRef, useSyncExternalStore } from 'react';
import { useI18n } from '../i18n/useI18n';
import { getGraphState, readBands, subscribeGraph } from '../lib/audioGraph';
import { BOUNCE_REST, bounceSource, foldToBars, indicatorLevel, stepBars, stillLevel } from '../lib/bounceBars';
import { readOutputBands, useOutput } from '../lib/outputSpectrum';
import { getPeerGraph, readPeerBands, subscribePeer } from '../lib/peerSound';
import * as player from '../lib/player';
import { BAND_COUNT } from '../lib/spectrumBands';
import { prefersReducedMotion } from '../lib/motion';

export function BounceBars({ count, className = '' }: { count: number; className?: string }) {
  const { t } = useI18n();
  const row = useRef<HTMLDivElement | null>(null);
  const levels = useRef(new Float32Array(count).fill(BOUNCE_REST));
  const s = player.usePlayer();
  const out = useOutput();
  const graphState = useSyncExternalStore(subscribeGraph, getGraphState);
  const peerGraph = useSyncExternalStore(subscribePeer, getPeerGraph);
  const kind = player.current(s)?.kind ?? null;
  const source = bounceSource({
    playing: s.playing,
    kind,
    outputOn: out.status === 'on',
    graphLive: graphState === 'live' || peerGraph === 'live',
  });

  useEffect(() => {
    const el = row.current;
    if (!el) return undefined;
    const bars = Array.from(el.children) as HTMLElement[];
    if (levels.current.length !== bars.length) levels.current = new Float32Array(bars.length).fill(BOUNCE_REST);
    const lv = levels.current;
    const paint = () => { bars.forEach((b, i) => { b.style.transform = `scaleY(${(lv[i] ?? BOUNCE_REST).toFixed(3)})`; }); };

    if (prefersReducedMotion()) {
      for (let i = 0; i < lv.length; i++) lv[i] = source === 'idle' ? BOUNCE_REST : stillLevel(i);
      paint();
      return undefined;
    }

    const bands = new Float32Array(BAND_COUNT);
    const target = new Float32Array(lv.length);
    let raf: number | null = null;
    let last = 0;
    let hidden = document.visibilityState === 'hidden';

    const frame = (now: number) => {
      raf = null;
      if (hidden) return;
      const dt = last ? Math.min(100, now - last) : 16.7;
      last = now;
      let want: Float32Array | null = null;
      if (source === 'spectrum' && (readOutputBands(bands) || readBands(bands) || readPeerBands(bands))) {
        foldToBars(bands, target);
        want = target;
      } else if (source !== 'idle') {
        // indicator, or a spectrum that went quiet for a frame: the bounce keeps « playing » honest
        for (let i = 0; i < target.length; i++) target[i] = indicatorLevel(i, target.length, now);
        want = target;
      }
      const away = stepBars(lv, want, dt);
      paint();
      if (source !== 'idle' || away > 0) raf = requestAnimationFrame(frame);
    };
    const kick = () => { if (raf === null && !hidden) { last = 0; raf = requestAnimationFrame(frame); } };
    const onVisibility = () => {
      hidden = document.visibilityState === 'hidden';
      if (hidden && raf !== null) { cancelAnimationFrame(raf); raf = null; } else kick();
    };
    document.addEventListener('visibilitychange', onVisibility);
    paint();
    kick();
    return () => {
      if (raf !== null) cancelAnimationFrame(raf);
      raf = null;
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [source, count]);

  const label = source === 'spectrum' ? t('sound.bars.following') : source === 'indicator' ? t('sound.bars.playing') : t('sound.bars.paused');
  return (
    <div ref={row} className={`yt-bounce ${className}`.trim()} data-source={source} role="img" aria-label={label} title={label}>
      {Array.from({ length: count }, (_, i) => <span key={i} />)}
    </div>
  );
}
