/**
 * ItemRow — one video or song in a list: its picture, its title, and what can
 * be done with it here (play, keep in a playlist, take out).
 */
import { useState } from 'react';
import { useI18n } from '../i18n/useI18n';
import { addItem, type Item } from '../lib/library';
import { updateLibrary, useLibrary } from '../lib/libraryStore';
import * as player from '../lib/player';

export function AddToPlaylist({ item }: { item: Item }) {
  const { t } = useI18n();
  const lib = useLibrary();
  const [said, setSaid] = useState<{ ok: boolean; text: string } | null>(null);
  if (lib.status !== 'ready' || !lib.library.playlists.length) return null;
  const add = async (id: string) => {
    if (!id) return;
    const name = lib.library.playlists.find((p) => p.id === id)?.name ?? '';
    const res = await updateLibrary((cur) => addItem(cur, id, item));
    setSaid(res.ok ? { ok: true, text: t('playlists.added', { name }) } : { ok: false, text: t(`code.${res.code}`) });
  };
  return (
    <>
      <select aria-label={t('playlists.addTo')} title={t('playlists.addTo')} value="" onChange={(e) => { void add(e.target.value); }}>
        <option value="">＋</option>
        {lib.library.playlists.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>
      {said && <span className={said.ok ? 'yt-ok' : 'yt-error'}>{said.text}</span>}
    </>
  );
}

/**
 * The tiny bouncing bars on the row that plays (doc 151 §11): CSS keyframes,
 * no frame loop; they stand still when the player is paused and under
 * prefers-reduced-motion (sound.css). Its own component, so only THIS row
 * re-renders as the player moves, never a list of 500.
 */
function NowBadge() {
  const { t } = useI18n();
  const s = player.usePlayer();
  const label = s.playing ? t('sound.bars.playing') : t('sound.bars.paused');
  return (
    <span className={`yt-eqbars${s.playing ? ' on' : ''}`} role="img" aria-label={label} title={label}>
      <i /><i /><i /><i />
    </span>
  );
}

export function ItemRow({ item, thumbnail, sub, live, playing, onPlay, onRemove }: {
  item: Item;
  thumbnail?: string | null;
  sub?: string;
  live?: boolean;
  playing?: boolean;
  onPlay: () => void;
  onRemove?: () => void;
}) {
  const { t } = useI18n();
  return (
    <div className={`yt-item glass${playing ? ' playing' : ''}`}>
      {thumbnail ? <img src={thumbnail} alt="" loading="lazy" /> : <div className="yt-thumb-none" aria-hidden>{item.kind === 'local' ? '♪' : '▶'}</div>}
      <div className="yt-meta">
        <div className="yt-title" title={item.title}>{playing && <NowBadge />}{item.title}</div>
        <div className="yt-muted">
          {live && <span className="yt-badge live">{t('search.live')}</span>} {sub}
        </div>
      </div>
      <div className="yt-actions">
        <button className="icon-btn" title={t('player.play')} aria-label={t('player.play')} onClick={onPlay}>▶</button>
        <AddToPlaylist item={item} />
        {onRemove && <button className="icon-btn" title={t('playlists.removeItem')} aria-label={t('playlists.removeItem')} onClick={onRemove}>✕</button>}
      </div>
    </div>
  );
}
