/**
 * Folding and closing (doc 151 §12): the header stays with a real button that
 * says whether it is open, the choice survives a reload, and closing the sound
 * panel never closes the audio graph that a song plays through.
 */
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Section } from './Section';
import { __resetFoldsForTests, FOLDS_KEY, getFolds, parseFolds, setClosed } from '../lib/folds';
import * as graph from '../lib/audioGraph';
import { __resetSoundPrefsForTests } from '../lib/soundPrefs';
import { __resetOutputForTests } from '../lib/outputSpectrum';
import * as player from '../lib/player';
import { __resetScreenForTests } from '../lib/screen';
import App from '../App';

beforeEach(() => {
  window.localStorage.clear();
  __resetFoldsForTests();
  __resetSoundPrefsForTests();
  __resetOutputForTests();
  __resetScreenForTests();
  player.__resetPlayerForTests();
  vi.stubGlobal('requestAnimationFrame', () => 1);
  vi.stubGlobal('cancelAnimationFrame', () => {});
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => null);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('a section folds', () => {
  it('the chevron is a button that says open or folded, the body goes, the header stays, and it is remembered', () => {
    const { unmount } = render(<Section id="queue" title="Up next" actions={<button>extra</button>}><p>body</p></Section>);
    const chevron = screen.getByRole('button', { name: 'Fold' });
    expect(chevron).toHaveAttribute('aria-expanded', 'true');
    expect(document.getElementById(chevron.getAttribute('aria-controls')!)).not.toBeNull();
    fireEvent.click(chevron);
    expect(screen.getByRole('button', { name: 'Unfold' })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('body')).toBeNull();
    expect(screen.getByText('Up next')).toBeInTheDocument();
    expect(screen.getByText('extra')).toBeInTheDocument();
    unmount();
    __resetFoldsForTests();
    render(<Section id="queue" title="Up next"><p>body</p></Section>);
    expect(screen.queryByText('body')).toBeNull();
  });

  it('what is kept under the header stays when folded', () => {
    render(<Section id="player" title="P" keep={<div>frame</div>}><p>controls</p></Section>);
    fireEvent.click(screen.getByRole('button', { name: 'Fold' }));
    expect(screen.getByText('frame')).toBeInTheDocument();
    expect(screen.queryByText('controls')).toBeNull();
  });

  it('a stored value that does not read is « all open »; a storage that throws keeps the fold for the session', () => {
    expect(parseFolds({ folded: { queue: true, 'BAD KEY': true, eq: 'yes' }, closed: ['sound', 'nope', 'sound'] })).toEqual({ folded: { queue: true }, closed: ['sound'] });
    window.localStorage.setItem(FOLDS_KEY, '{nope');
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    __resetFoldsForTests();
    expect(getFolds()).toEqual({ folded: {}, closed: [] });
    vi.spyOn(window.localStorage, 'setItem').mockImplementation(() => { throw new Error('quota'); });
    act(() => setClosed('sound', true));
    expect(getFolds().closed).toEqual(['sound']);
  });
});

describe('the sound panel closes, the sound does not', () => {
  it('✕ closes the panel and an icon brings it back; the audio graph is never closed on the way', () => {
    const close = vi.spyOn(graph, 'closeGraph');
    render(<App />);
    const panel = document.querySelector('[data-section="sound"]') as HTMLElement;
    fireEvent.click(within(panel).getByRole('button', { name: 'Close' }));
    expect(document.querySelector('[data-section="sound"]')).toBeNull();
    expect(close).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Show the sound panel' }));
    expect(document.querySelector('[data-section="sound"]')).not.toBeNull();
    expect(screen.queryByRole('button', { name: 'Show the sound panel' })).toBeNull();
  });

  it('the player never folds its stage: folded, the frame stays and a play button stays in the header', () => {
    player.playQueue([{ kind: 'yt', videoId: 'aaaaaaaaaaa', title: 'A song' }], 0, { kind: 'single' });
    player.pause();
    render(<App />);
    const panel = document.querySelector('[data-section="player"]') as HTMLElement;
    fireEvent.click(within(panel).getByRole('button', { name: 'Fold' }));
    expect(panel.querySelector('iframe')).not.toBeNull();
    expect(within(panel).getAllByRole('button', { name: 'Play' })).toHaveLength(1);
    expect(within(panel).queryByRole('button', { name: 'Next' })).toBeNull();
  });
});
