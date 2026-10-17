/**
 * MusicTab — the person's own music folder (doc 151 §3): picked once in the
 * system dialog, listed two levels deep, played by the visible player.
 */
import { useEffect, useState } from 'react';
import { useI18n } from '../i18n/useI18n';
import { codeOf } from '../lib/host';
import { updateLibrary, useLibrary } from '../lib/libraryStore';
import { loadMusic, MAX_TRACKS, pickMusicFolder, useMusic } from '../lib/music';
import * as player from '../lib/player';
import { ItemRow } from './ItemRow';
import { Section } from './Section';

export function MusicTab() {
  const { t } = useI18n();
  const lib = useLibrary();
  const music = useMusic();
  const now = player.usePlayer();
  const [error, setError] = useState<string | null>(null);
  const folder = lib.status === 'ready' ? lib.library.musicFolder : null;

  useEffect(() => {
    // Read once when the tab opens on a folder not read yet.
    if (folder && music.status === 'idle') void loadMusic(folder);
  }, [folder, music.status]);

  const pick = async () => {
    try {
      const path = await pickMusicFolder();
      if (!path) return;
      const r = await updateLibrary((cur) => ({ ok: true, library: { ...cur, musicFolder: path } }));
      if (!r.ok) { setError(r.code); return; }
      setError(null);
      await loadMusic(path);
    } catch (err) {
      setError(codeOf(err));
    }
  };

  const current = player.current(now);
  const name = folder ? folder.split(/[\\/]/).filter(Boolean).pop() : null;

  return (
    <Section
      id="music"
      className="full"
      title={name ?? t('music.title')}
      actions={folder ? <button className="icon-btn" title={t('music.reload')} aria-label={t('music.reload')} onClick={() => void loadMusic(folder)}>↻</button> : null}
    >
      <div className="yt-row">
        <button onClick={() => void pick()}>{folder ? t('music.change') : t('music.pick')}</button>
        <button className="primary" disabled={!music.tracks.length} onClick={() => player.playQueue(music.tracks, 0, { kind: 'music' })}>▶ {t('music.playAll')}</button>
      </div>
      {!folder && <div className="yt-muted">{t('music.none')}</div>}
      {music.status === 'loading' && <div className="yt-muted">{t('common.loading')}</div>}
      {(error ?? music.error) && <div className="yt-error">{t(`code.${error ?? music.error}`)}</div>}
      {music.status === 'ready' && !music.tracks.length && <div className="yt-muted">{t('music.empty')}</div>}
      {music.capped && <div className="yt-note">{t('music.capped', { count: MAX_TRACKS })}</div>}
      <div className="yt-list">
        {music.tracks.map((it, i) => (
          <ItemRow
            key={it.kind === 'local' ? it.path : i}
            item={it}
            playing={current?.kind === 'local' && it.kind === 'local' && current.path === it.path}
            onPlay={() => player.playQueue(music.tracks, i, { kind: 'music' })}
          />
        ))}
      </div>
    </Section>
  );
}
