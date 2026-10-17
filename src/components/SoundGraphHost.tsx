/**
 * SoundGraphHost — the audio graph's owner (doc 151 §10.5), headless.
 *
 * Split out of the sound panel (doc 151 §12) because the panel can now be
 * closed, folded, or live in another window: the graph must not. It is
 * mounted for the life of the window that PLAYS (the single window, or the
 * Player window of the exploded view), and closes the graph only when that
 * window goes (a closed context does not give a routed song back to the
 * speakers).
 *
 * It hooks into the music folder's <audio> without touching the player: a
 * `play` listener in the capture phase on the document (media events do not
 * bubble, capture still reaches them) routes whatever <audio> starts, and a
 * click anywhere in the window retries a song that started before the
 * autoplay policy allowed sound processing (a song started by voice).
 * The curve follows the prefs, including a change made in another window.
 */
import { useEffect } from 'react';
import { attach, closeGraph, retryPending, setGains } from '../lib/audioGraph';
import { probeOutput, stopOutput } from '../lib/outputSpectrum';
import { getSoundPrefs, subscribeSoundPrefs } from '../lib/soundPrefs';

export function SoundGraphHost() {
  useEffect(() => {
    const onPlay = (e: Event) => {
      if (e.target instanceof HTMLAudioElement) {
        attach(e.target).catch((err: unknown) => console.warn('[youtube] equalizer not attached:', err));
      }
    };
    const onGesture = () => {
      retryPending().catch((err: unknown) => console.warn('[youtube] equalizer retry failed:', err));
    };
    let lastGains = getSoundPrefs().gains;
    setGains(lastGains);
    const offPrefs = subscribeSoundPrefs(() => {
      const g = getSoundPrefs().gains;
      if (g !== lastGains) { lastGains = g; setGains(g); }
    });
    document.addEventListener('play', onPlay, true);
    document.addEventListener('pointerdown', onGesture, true);
    document.addEventListener('keydown', onGesture, true);
    void probeOutput();
    return () => {
      offPrefs();
      document.removeEventListener('play', onPlay, true);
      document.removeEventListener('pointerdown', onGesture, true);
      document.removeEventListener('keydown', onGesture, true);
      void stopOutput();
      closeGraph();
    };
  }, []);
  return null;
}
