import { describe, expect, it } from 'vitest';
import { findNamed, nameWords, type Named } from './agentFind';

const p = (id: string, name: string, alias = ''): Named<string> => ({ item: id, id, names: [name], aliases: alias ? [alias] : [], label: name });
const LIST = [p('p1', 'Jazz'), p('p2', 'Jazz du dimanche'), p('p3', 'Sport'), p('p4', 'Thé et pluie'), p('p5', 'Rock 80'), p('p6', 'Rock 90')];
const kind = { code: 'NO_PLAYLIST', noun: 'playlist' };

describe('a playlist named the way a person says it', () => {
  it('folds case, accents, the app’s own nouns and a plural', () => {
    expect(nameWords('ma playlist Jazz du dimanche')).toEqual(['jazz', 'dimanche']);
    expect(nameWords('mi lista Deporte')).toEqual(['deporte']);
    // A filler is matched BEFORE the accents come off: « thé » is not « the ».
    expect(nameWords('le thé')).toEqual(['the']);
  });

  it('its id, a whole name, or every word of it', () => {
    expect(findNamed(LIST, 'p3', kind)).toBe('p3');
    expect(findNamed(LIST, 'ma playlist sport', kind)).toBe('p3');
    // « Jazz » is a whole name: it wins over the playlist whose name holds the word.
    expect(findNamed(LIST, 'la playlist Jazz', kind)).toBe('p1');
    expect(findNamed(LIST, 'jazz dimanche', kind)).toBe('p2');
    expect(findNamed(LIST, 'thé', kind)).toBe('p4');
  });

  it('several matches are refused with their names, never the first taken', () => {
    expect(() => findNamed(LIST, 'rock', kind)).toThrow('AMBIGUOUS: "rock" names several playlists: Rock 80, Rock 90; say which');
  });

  it('no match lists the names', () => {
    expect(() => findNamed(LIST.slice(0, 2), 'Classique', kind)).toThrow('NO_PLAYLIST: no playlist named "Classique"; playlists: Jazz, Jazz du dimanche');
    expect(() => findNamed(LIST, 'ma playlist', kind)).toThrow(/^NO_PLAYLIST: "ma playlist" names no playlist/);
    expect(() => findNamed(LIST, '  ', kind)).toThrow(/^BAD_ARG/);
    expect(() => findNamed([], 'jazz', kind)).toThrow('playlists: none');
  });
});
