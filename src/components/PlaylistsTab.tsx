/**
 * PlaylistsTab — the person's own playlists (doc 151 §3): make one, open one,
 * play it, add a YouTube link to it, take an item out, rename or delete it.
 * Deleting is a click here only, never an action of the voice.
 */
import { useState } from 'react';
import { useI18n } from '../i18n/useI18n';
import { addItem, createPlaylist, removeItem, removePlaylist, renamePlaylist, videoIdFrom } from '../lib/library';
import { updateLibrary, useLibrary, type WriteResult } from '../lib/libraryStore';
import * as player from '../lib/player';
import { ItemRow } from './ItemRow';
import { Section } from './Section';

const newId = () => (crypto.randomUUID ? crypto.randomUUID().slice(0, 12) : String(Date.now()));

export function PlaylistsTab() {
  const { t } = useI18n();
  const lib = useLibrary();
  const now = player.usePlayer();
  const [openId, setOpenId] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [link, setLink] = useState('');
  const [rename, setRename] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (lib.status === 'loading') return <div className="yt-panel glass full yt-muted">{t('common.loading')}</div>;
  if (lib.status === 'error') return <div className="yt-panel glass full yt-error">{t('code.LIBRARY_UNREADABLE')}</div>;

  const playlists = lib.library.playlists;
  const open = playlists.find((p) => p.id === openId) ?? null;
  const said = (r: WriteResult) => setError(r.ok ? null : r.code);
  const current = player.current(now);

  const create = async () => {
    const id = newId();
    const r = await updateLibrary((cur) => createPlaylist(cur, newName, id, new Date().toISOString()));
    said(r);
    if (r.ok) { setNewName(''); setOpenId(id); }
  };

  const addLink = async () => {
    if (!open) return;
    const id = videoIdFrom(link);
    if (!id) { setError('NOT_A_YOUTUBE_LINK'); return; }
    const r = await updateLibrary((cur) => addItem(cur, open.id, { kind: 'yt', videoId: id, title: `YouTube · ${id}` }));
    said(r);
    if (r.ok) setLink('');
  };

  return (
    <>
      <Section id="playlists" title={t('playlists.title')}>
        <div className="yt-row">
          <input type="text" value={newName} placeholder={t('playlists.newName')} aria-label={t('playlists.newName')} onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void create(); }} />
          <button className="primary" disabled={!newName.trim()} onClick={() => void create()}>{t('playlists.create')}</button>
        </div>
        {!playlists.length && <div className="yt-muted">{t('playlists.none')}</div>}
        <div className="yt-chips">
          {playlists.map((p) => (
            <button key={p.id} className={`chip-tile glass${p.id === openId ? ' chosen' : ''}`} onClick={() => { setOpenId(p.id); setConfirmDelete(false); setRename(null); }}>
              <span>{p.name}</span>
              <span className="yt-muted">{t('playlists.count', { count: p.items.length })}</span>
            </button>
          ))}
        </div>
        {error && <div className="yt-error">{t(`code.${error}`)}</div>}
      </Section>

      {open && (
        <Section id="playlist-open" title={open.name}>
          <div className="yt-row">
            {rename !== null && <input type="text" value={rename} aria-label={t('playlists.rename')} onChange={(e) => setRename(e.target.value)} />}
            {rename === null
              ? <button className="icon-btn" title={t('playlists.rename')} aria-label={t('playlists.rename')} onClick={() => setRename(open.name)}>✎</button>
              : <button className="primary" onClick={async () => { const r = await updateLibrary((cur) => renamePlaylist(cur, open.id, rename)); said(r); if (r.ok) setRename(null); }}>{t('common.save')}</button>}
            <button className="primary" disabled={!open.items.length} onClick={() => player.playQueue(open.items, 0, { kind: 'playlist', name: open.name })}>▶ {t('playlists.playAll')}</button>
          </div>
          <div className="yt-row">
            <input type="text" value={link} placeholder={t('playlists.pasteLink')} aria-label={t('playlists.pasteLink')} onChange={(e) => setLink(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void addLink(); }} />
            <button disabled={!link.trim()} onClick={() => void addLink()}>{t('playlists.addLink')}</button>
          </div>
          {!open.items.length && <div className="yt-muted">{t('playlists.empty')}</div>}
          <div className="yt-list">
            {open.items.map((it, i) => (
              <ItemRow
                key={`${i}:${it.kind === 'yt' ? it.videoId : it.path}`}
                item={it}
                thumbnail={it.kind === 'yt' ? `https://i.ytimg.com/vi/${it.videoId}/mqdefault.jpg` : null}
                {...(it.kind === 'yt' && it.channel ? { sub: it.channel } : {})}
                playing={!!current && (current.kind === 'yt' ? it.kind === 'yt' && it.videoId === current.videoId : it.kind === 'local' && it.path === current.path)}
                onPlay={() => player.playQueue(open.items, i, { kind: 'playlist', name: open.name })}
                onRemove={() => { void updateLibrary((cur) => removeItem(cur, open.id, i)).then(said); }}
              />
            ))}
          </div>
          <div className="yt-row">
            {!confirmDelete
              ? <button onClick={() => setConfirmDelete(true)}>{t('playlists.delete')}</button>
              : <>
                <span className="yt-error">{t('playlists.deleteConfirm', { name: open.name, count: open.items.length })}</span>
                <button onClick={async () => { const r = await updateLibrary((cur) => removePlaylist(cur, open.id)); said(r); if (r.ok) setOpenId(null); setConfirmDelete(false); }}>{t('playlists.deleteYes')}</button>
                <button onClick={() => setConfirmDelete(false)}>{t('common.cancel')}</button>
              </>}
          </div>
        </Section>
      )}
    </>
  );
}
