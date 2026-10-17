/**
 * agentFind — a playlist, a video, a song or a comment named the way a person
 * says it (doc 149, doc 151 §7). The orb plans a spoken sentence in ONE model
 * call and never reads MnemoPlayer first, so « mets ma playlist du dimanche »
 * reaches an action with the words « playlist du dimanche », never an id. The
 * exact id still works (other agents read first).
 *
 * 🚨 Several matches are REFUSED with their names (AMBIGUOUS), never the first
 *    one taken: the refusal is what the orb's second planner call reads to
 *    pick the right one. No match is refused with the names that exist, or,
 *    for a list too long to say, with where to look.
 *
 * Copied from MnemoBreach's lib/agentFind (cartridges never import each
 * other); the filler words are this app's.
 */

/** Lower case, accents off, œ/æ spelled out. */
export function fold(s: string): string {
  return s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/œ/g, 'oe').replace(/æ/g, 'ae');
}

/**
 * Words that carry no name: articles, the words a sentence wraps a name in,
 * and this app's own nouns (« ma playlist Jazz » is Jazz, « la vidéo de Léa »
 * is Léa's).
 * 🪤 Matched BEFORE the accents come off: folded, « thé » would be « the ».
 */
const FILLER = new Set([
  'le', 'la', 'les', 'l', 'un', 'une', 'des', 'de', 'du', 'd', 'mon', 'ma', 'mes', 'ton', 'ta', 'tes', 'son', 'sa', 'ses', 'ce', 'cette', 'ces', 'et', 'en', 'au', 'aux', 'à', 'sur', 'celle', 'celui', 'pour', 'dans',
  'the', 'a', 'an', 'of', 'my', 'your', 'and', 'on', 'at', 'for', 'in', 'to', 'el', 'los', 'las', 'del', 'mi', 'mis', 'tu', 'y', 'para', 'por', 'en', 'al',
  'playlist', 'playlists', 'liste', 'sélection', 'vidéo', 'vidéos', 'chanson', 'chansons', 'morceau', 'morceaux', 'musique', 'titre', 'commentaire', 'commentaires', 'chaîne',
  'video', 'videos', 'song', 'songs', 'track', 'tracks', 'music', 'list', 'comment', 'comments', 'channel',
  'lista', 'canción', 'canciones', 'tema', 'música', 'comentario', 'comentarios', 'canal',
]);

/** The words of a name, folded, fillers out, a plural « s »/« x » off so « jazz du dimanches » finds it. */
export function nameWords(s: string): string[] {
  return s.normalize('NFC').toLowerCase().split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w && !FILLER.has(w))
    .map((w) => fold(w))
    .map((w) => (w.length > 3 ? w.replace(/[sx]$/, '') : w));
}

export interface Named<T> {
  item: T;
  id: string;
  names: string[];
  /** Matched after `names` (a channel name, a comment's author). */
  aliases?: string[];
  label: string;
}

const LIST_MAX = 12;
const listed = (labels: string[]) => {
  const unique = [...new Set(labels)];
  return unique.length > LIST_MAX ? `${unique.slice(0, LIST_MAX).join(', ')} (+${unique.length - LIST_MAX})` : unique.join(', ');
};

export interface FindKind {
  /** The refusal code when nothing matches: NO_PLAYLIST… */
  code: string;
  /** The thing, said in the refusals: « playlist ». */
  noun: string;
  /** Its plural when it is not noun + « s ». */
  plural?: string;
  /**
   * Said instead of the list of names when nothing matches: a long list cut
   * to 12 tells the repair call nothing.
   */
  whereToLook?: string;
}

/**
 * The one item `ref` names: its id (case aside); else the item one of whose
 * names is said whole; else the item whose words hold every word of `ref`.
 */
export function findNamed<T>(entries: ReadonlyArray<Named<T>>, ref: string, kind: FindKind): T {
  const raw = ref.trim();
  if (!raw) throw new Error(`BAD_ARG: name the ${kind.noun}`);
  const byId = entries.find((e) => e.id === raw) ?? entries.find((e) => e.id.toLowerCase() === raw.toLowerCase());
  if (byId) return byId.item;
  const plural = kind.plural ?? `${kind.noun}s`;
  const asked = nameWords(raw);
  const none = () => kind.whereToLook ?? `${plural}: ${listed(entries.map((e) => e.label)) || 'none'}`;
  if (!asked.length) throw new Error(`${kind.code}: "${raw}" names no ${kind.noun}; ${none()}`);
  // A whole name said as written wins over a partial match (« Jazz » against
  // « Jazz du dimanche »), then a whole alias, then every word said.
  const said = asked.join(' ');
  const saidWhole = (list: readonly string[] | undefined) => (list ?? []).some((n) => nameWords(n).join(' ') === said);
  let hits = entries.filter((e) => saidWhole(e.names));
  if (!hits.length) hits = entries.filter((e) => saidWhole(e.aliases));
  if (!hits.length) {
    hits = entries.filter((e) => {
      const have = new Set([...e.names, ...(e.aliases ?? [])].flatMap(nameWords));
      return asked.every((w) => have.has(w));
    });
  }
  if (hits.length === 1) return hits[0]!.item;
  if (hits.length > 1) throw new Error(`AMBIGUOUS: "${raw}" names several ${plural}: ${listed(hits.map((e) => e.label))}; say which`);
  throw new Error(`${kind.code}: no ${kind.noun} named "${raw}"; ${none()}`);
}
